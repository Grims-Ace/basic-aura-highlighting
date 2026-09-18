// =============================================================================
// =============================================================================
// Application orchestrator, lifecycle hooks, and highlight refresh scheduler.
// =============================================================================
// =============================================================================

import {
    MODULE_ID,
    THICKNESS_SETTING,
    REFRESH_DURING_MOVE_SETTING,
    AURAS_FLAG_PATH,
} from "./constants.js";
import { localize, getPixelsPerSceneUnit } from "./utils.js";
import { getTokenAuras, parseAurasInChanges } from "./models/aura.js";
import { isTokenInAuraCached, measureBoundsGapSquared } from "./geometry/distance.js";
import { clearAlphaShapeCache } from "./geometry/sampling.js";
import {
    syncTargetHighlights,
    clearAllHighlights,
    clearFallbackGraphics,
} from "./rendering/highlight-renderer.js";
import { injectAurasTab } from "./ui/auras-tab.js";

// =============================================================================
// Internal State Fields: Encapsulated animation frame refresh handle.
// =============================================================================

let _pendingHighlightRefresh = null;

// =============================================================================
// Constructors and Initializers: Settings setup and Foundry hook bindings.
// =============================================================================

// Register module settings in the Foundry configuration repository.
function registerSettings() {
    game.settings.register(MODULE_ID, REFRESH_DURING_MOVE_SETTING, {
        name: localize("settings.refreshDuringMove.name"),
        hint: localize("settings.refreshDuringMove.hint"),
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: scheduleAuraHighlightRefresh,
    });

    game.settings.register(MODULE_ID, THICKNESS_SETTING, {
        name: localize("settings.thickness.name"),
        hint: localize("settings.thickness.hint"),
        scope: "client",
        config: true,
        type: Number,
        range: {
            min: 1,
            max: 100,
            step: 1,
        },
        default: 4,
        onChange: scheduleAuraHighlightRefresh,
    });
}

// Refresh highlights during token movement if configured by user settings.
function handleTokenMovement() {
    if (game.settings.get(MODULE_ID, REFRESH_DURING_MOVE_SETTING)) {
        scheduleAuraHighlightRefresh();
    }
}

// Refresh highlights when token animations complete or during real-time movement.
function handleTokenRefresh(token) {
    const isAnimating = Boolean(token.animationContexts?.size || token._animation);
    if (game.settings.get(MODULE_ID, REFRESH_DURING_MOVE_SETTING) || !isAnimating) {
        scheduleAuraHighlightRefresh();
    }
}

// Clear all active highlights and evict cached texture geometry on canvas teardown.
function handleCanvasTearDown() {
    clearAuraHighlights();
    clearAlphaShapeCache();
}

// Register all lifecycle and canvas event hooks for the module.
function registerHooks() {
    Hooks.once("init", registerSettings);
    Hooks.on("renderTokenConfig", injectAurasTab);
    Hooks.on("renderPrototypeTokenConfig", injectAurasTab);
    Hooks.on("preUpdateToken", (_token, changes) => parseAurasInChanges(changes, AURAS_FLAG_PATH));
    Hooks.on("preUpdateActor", (_actor, changes) => parseAurasInChanges(changes, `prototypeToken.${AURAS_FLAG_PATH}`));
    Hooks.on("canvasReady", scheduleAuraHighlightRefresh);
    Hooks.on("canvasTearDown", handleCanvasTearDown);
    Hooks.on("controlToken", scheduleAuraHighlightRefresh);
    Hooks.on("updateToken", scheduleAuraHighlightRefresh);
    Hooks.on("moveToken", handleTokenMovement);
    Hooks.on("stopToken", scheduleAuraHighlightRefresh);
    Hooks.on("refreshToken", handleTokenRefresh);
    Hooks.on("createToken", scheduleAuraHighlightRefresh);
    Hooks.on("deleteToken", scheduleAuraHighlightRefresh);
}

registerHooks();

// =============================================================================
// Primary Operations: Highlight scheduling and collection pipeline.
// =============================================================================

// Defer highlight recalculation to the next animation frame.
export function scheduleAuraHighlightRefresh() {
    if (_pendingHighlightRefresh !== null) return;

    _pendingHighlightRefresh = requestAnimationFrame(() => {
        _pendingHighlightRefresh = null;
        refreshAuraHighlights();
    });
}

// Recompute and apply all active aura highlights on the canvas.
export function refreshAuraHighlights() {
    // 0. Validate active canvas state
    const activeCanvas = globalThis.canvas;
    if (!activeCanvas?.ready || !activeCanvas.tokens) return;

    // 1. Clear vector fallback overlays while retaining reusable filters
    clearFallbackGraphics();

    // 2. Identify active source tokens with enabled auras
    const sourceTokens = activeCanvas.tokens.controlled.filter(
        (token) => getTokenAuras(token).some((aura) => aura.enabled),
    );

    // 3. Collect active highlights per target token
    const highlights = sourceTokens.length > 0 ? collectAuraHighlights(sourceTokens) : new Map();

    // 4. Synchronize highlight filters across active targets
    syncTargetHighlights(highlights, activeCanvas);
}

// Remove all active aura highlight filters and graphic overlays.
export function clearAuraHighlights() {
    if (_pendingHighlightRefresh !== null) {
        cancelAnimationFrame(_pendingHighlightRefresh);
        _pendingHighlightRefresh = null;
    }

    clearAllHighlights();
}

// Collect all active highlights across all controlled source tokens.
export function collectAuraHighlights(sourceTokens) {
    const highlights = new Map();
    const pixelsPerUnit = getPixelsPerSceneUnit();
    const tokenCache = new Map();

    for (const source of sourceTokens) {
        evaluateSourceTokenAuras(source, tokenCache, pixelsPerUnit, highlights);
    }

    return highlights;
}

// =============================================================================
// Helper Functions: Spatial partitioning and target evaluation.
// =============================================================================

// Query spatial partition to locate candidate targets within maximum aura range.
export function getCandidateTargets(source, maxRangePixels) {
    const activeCanvas = globalThis.canvas;
    const quadtree = activeCanvas?.tokens?.quadtree;

    if (quadtree?.getObjects) {
        const bounds = source.bounds;
        const rect = new PIXI.Rectangle(
            bounds.x - maxRangePixels,
            bounds.y - maxRangePixels,
            bounds.width + maxRangePixels * 2,
            bounds.height + maxRangePixels * 2,
        );
        return quadtree.getObjects(rect);
    }

    return activeCanvas.tokens.placeables;
}

// Evaluate aura targets for a single source token.
export function evaluateSourceTokenAuras(source, tokenCache, pixelsPerUnit, highlights) {
    const auras = getTokenAuras(source).filter((aura) => aura.enabled);
    if (auras.length === 0) return;

    // 0. Compute maximum aura range to prune distant targets rapidly
    let maxRange = 0;
    for (let i = 0; i < auras.length; i++) {
        if (auras[i].range > maxRange) maxRange = auras[i].range;
    }
    const maxRangePixels = maxRange * pixelsPerUnit;
    const maxRangePixels2 = maxRangePixels * maxRangePixels;

    // 1. Query candidate targets within bounding distance
    const candidates = getCandidateTargets(source, maxRangePixels);
    const sourceData = getCachedTokenData(source, tokenCache, pixelsPerUnit);

    // 2. Evaluate candidate target tokens
    for (const target of candidates) {
        if (target === source || target.document.hidden) continue;
        evaluateTargetCandidate(source, target, auras, sourceData, tokenCache, pixelsPerUnit, maxRangePixels2, highlights);
    }
}

// Evaluate a candidate target token against all active source auras.
export function evaluateTargetCandidate(source, target, auras, sourceData, tokenCache, pixelsPerUnit, maxRangePixels2, highlights) {
    const targetData = getCachedTokenData(target, tokenCache, pixelsPerUnit);
    const dz = Math.abs(sourceData.elevation - targetData.elevation);
    const dz2 = dz * dz;

    // Reject target early if 3D bounding box distance exceeds maximum possible aura range
    if (measureBoundsGapSquared(sourceData.bounds, targetData.bounds) + dz2 > maxRangePixels2) {
        return;
    }

    for (const aura of auras) {
        evaluateSingleAura(source, target, aura, sourceData, targetData, dz2, pixelsPerUnit, highlights);
    }
}

// Check an individual aura and record matching highlights.
function evaluateSingleAura(source, target, aura, sourceData, targetData, dz2, pixelsPerUnit, highlights) {
    const rangePixels = aura.range * pixelsPerUnit;
    const rangePixels2 = rangePixels * rangePixels;
    if (dz2 > rangePixels2) return;

    const isInAura = isTokenInAuraCached(source, target, aura, sourceData, targetData, dz2, rangePixels2);
    if (!isInAura) return;

    const targetHighlights = highlights.get(target.id) ?? [];
    targetHighlights.push(aura);
    highlights.set(target.id, targetHighlights);
}

// Retrieve or initialize cached geometry and elevation data for a token.
export function getCachedTokenData(token, cache, pixelsPerUnit) {
    let data = cache.get(token.id);
    if (data) return data;

    data = {
        center: token.center,
        bounds: token.bounds,
        elevation: (token.document?.elevation ?? 0) * pixelsPerUnit,
        alphaPoints: null,
    };
    cache.set(token.id, data);
    return data;
}
