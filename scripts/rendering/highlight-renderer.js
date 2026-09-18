// =============================================================================
// =============================================================================
// Shader filter creation, target filter diffing/synchronization, and fallback overlays.
// =============================================================================
// =============================================================================

import {
    HIGHLIGHT_CONTAINER_NAME,
    HIGHLIGHT_RING_SPACING,
    HIGHLIGHT_ALPHA_THRESHOLD,
    HIGHLIGHT_FILTER_MARKER,
    ALPHA_OUTLINE_FRAGMENT_SHADER,
} from "../constants.js";
import {
    colorToNumber,
    colorToRgbArray,
    getHighlightThickness,
} from "../utils.js";
import { getTokenFilterTarget } from "../geometry/sampling.js";

// =============================================================================
// Internal State Fields: Filter target sets and signature caches.
// =============================================================================

let _highlightedFilterTargets = new Set();
const _targetFilterSignatures = new WeakMap();

// =============================================================================
// Primary Operations: Highlight synchronization and container management.
// =============================================================================

// Synchronize highlight filters across all canvas targets.
export function syncTargetHighlights(highlights, activeCanvas) {
    const nextTargets = new Set();

    for (const [targetId, targetHighlights] of highlights) {
        const target = activeCanvas.tokens.placeables.find((token) => token.id === targetId);
        if (!target) continue;

        const displayTarget = highlightToken(target, targetHighlights);
        if (displayTarget) nextTargets.add(displayTarget);
    }

    // Remove filters from targets no longer inside any aura
    for (const target of _highlightedFilterTargets) {
        if (!nextTargets.has(target)) {
            removeHighlightFilters(target);
        }
    }

    _highlightedFilterTargets = nextTargets;
}

// Remove all active aura highlight filters and graphic overlays.
export function clearAllHighlights() {
    for (const target of _highlightedFilterTargets) {
        removeHighlightFilters(target);
    }
    _highlightedFilterTargets.clear();

    clearFallbackGraphics();
}

// Destroy vector fallback graphics from the canvas highlight container.
export function clearFallbackGraphics() {
    const container = findHighlightContainer();
    if (container) clearHighlightContainer(container);
}

// Apply shader outline filters or vector graphic overlays to a highlighted token.
export function highlightToken(token, highlights) {
    const target = getTokenFilterTarget(token);

    if (target) {
        applyHighlightFilters(target, highlights);
        return target;
    }

    drawFallbackTokenHighlights(getHighlightContainer(), token, highlights);
    return null;
}

// =============================================================================
// Helper Functions: Filter lifecycle, GLSL compilation, and vector overlays.
// =============================================================================

// Apply highlight filters to a display target while preserving existing unchanged filters.
function applyHighlightFilters(target, highlights) {
    const thickness = getHighlightThickness();
    const colors = highlights.map((aura) => aura.color);
    const signature = `${thickness}:${colors.join(",")}`;

    // Skip filter reconstruction if existing filters match the required configuration
    if (_targetFilterSignatures.get(target) === signature) return;

    removeHighlightFilters(target);

    const filters = highlights
        .map((aura) => createOutlineFilter(aura.color, thickness))
        .filter(Boolean);

    if (filters.length === 0) return;

    for (const filter of filters) {
        filter[HIGHLIGHT_FILTER_MARKER] = true;
    }

    target.filters = [...(target.filters ?? []), ...filters];
    _targetFilterSignatures.set(target, signature);
}

// Remove all module highlight filters from a display object.
function removeHighlightFilters(target) {
    _targetFilterSignatures.delete(target);
    const filters = target.filters ?? [];
    const remainingFilters = filters.filter((filter) => !filter?.[HIGHLIGHT_FILTER_MARKER]);
    target.filters = remainingFilters.length > 0 ? remainingFilters : null;
}

// Construct an outline filter compatible with the current Foundry engine version.
function createOutlineFilter(color, thickness = getHighlightThickness()) {
    const colorNumber = colorToNumber(color);
    const pixiOutlineFilter = globalThis.PIXI?.filters?.OutlineFilter;
    if (pixiOutlineFilter) {
        return new pixiOutlineFilter(thickness, colorNumber, 0.2);
    }

    const outlineOverlayFilter =
        globalThis.OutlineOverlayFilter ??
        globalThis.foundry?.canvas?.rendering?.filters?.OutlineOverlayFilter;
    if (outlineOverlayFilter?.create) {
        const filter = outlineOverlayFilter.create({
            outlineColor: colorToRgbArray(colorNumber),
            thickness: [thickness, thickness],
            alphaThreshold: HIGHLIGHT_ALPHA_THRESHOLD,
            knockout: false,
            wave: false,
        });
        filter.animate = false;
        filter.animated = false;
        return filter;
    }

    const alphaOutlineFilter = createAlphaOutlineFilter(colorNumber, thickness);
    if (alphaOutlineFilter) return alphaOutlineFilter;

    const glowOverlayFilter =
        globalThis.GlowOverlayFilter ??
        globalThis.foundry?.canvas?.rendering?.filters?.GlowOverlayFilter;
    if (glowOverlayFilter?.create) {
        const filter = glowOverlayFilter.create({
            glowColor: colorToRgbArray(colorNumber),
            distance: thickness,
            outerStrength: 3,
            innerStrength: 0,
            alpha: 1,
            knockout: false,
        });
        filter.animated = false;
        return filter;
    }

    return null;
}

// Instantiate custom GLSL alpha outline filter using available base class.
function createAlphaOutlineFilter(color, thickness = getHighlightThickness()) {
    const uniforms = {
        outlineColor: colorToRgbArray(color),
        thickness,
        alphaThreshold: HIGHLIGHT_ALPHA_THRESHOLD,
    };
    const baseFilter =
        globalThis.foundry?.canvas?.rendering?.filters?.AbstractBaseFilter ??
        globalThis.PIXI?.Filter;
    if (!baseFilter) return null;

    try {
        const filter = new baseFilter(undefined, ALPHA_OUTLINE_FRAGMENT_SHADER, uniforms);
        filter.padding = thickness;
        return filter;
    } catch (_error) {
        return null;
    }
}

// Find the highlight container if it exists in the canvas.
function findHighlightContainer() {
    const activeCanvas = globalThis.canvas;
    const parent = activeCanvas?.interface ?? activeCanvas?.tokens;
    return parent?.getChildByName?.(HIGHLIGHT_CONTAINER_NAME) ??
        parent?.children?.find((child) => child.name === HIGHLIGHT_CONTAINER_NAME) ??
        null;
}

// Retrieve or create the highlight container for vector overlays.
function getHighlightContainer() {
    const existing = findHighlightContainer();
    if (existing) return existing;

    const activeCanvas = globalThis.canvas;
    const parent = activeCanvas.interface ?? activeCanvas.tokens;
    const container = new PIXI.Container();
    container.name = HIGHLIGHT_CONTAINER_NAME;
    container.eventMode = "none";
    container.interactiveChildren = false;
    parent.addChild(container);
    return container;
}

// Destroy all child graphics in the highlight container.
function clearHighlightContainer(container) {
    for (const child of container.removeChildren()) {
        child.destroy();
    }
}

// Render geometric outline boxes when shader filters are not supported.
function drawFallbackTokenHighlights(container, token, highlights) {
    const thickness = getHighlightThickness();
    highlights.forEach((aura, index) => {
        const bounds = token.bounds.clone().pad(index * HIGHLIGHT_RING_SPACING);
        const graphic = new PIXI.Graphics();

        graphic.lineStyle(thickness, colorToNumber(aura.color), 0.9);
        graphic.drawRoundedRect(
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            6 + index * 2,
        );
        container.addChild(graphic);
    });
}
