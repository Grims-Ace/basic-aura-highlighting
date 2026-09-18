// =============================================================================
// Constants and Configuration Limits: Immutable values and shader code.
// =============================================================================

const MODULE_ID = "basic_aura_highlighting";
const AURAS_TAB = "basic-aura-highlighting-auras";
const AURAS_FLAG_PATH = `flags.${MODULE_ID}.auras`;
const HIGHLIGHT_CONTAINER_NAME = `${MODULE_ID}.highlights`;
const HIGHLIGHT_RING_SPACING = 5;
const HIGHLIGHT_ALPHA_THRESHOLD = 0.2;
const ALPHA_SAMPLE_SIZE = 48;
const MAX_ALPHA_EDGE_POINTS = 36;
const MAX_CACHE_ENTRIES = 128;
const HIGHLIGHT_FILTER_MARKER = Symbol(MODULE_ID);
const THICKNESS_SETTING = "thickness";
const REFRESH_DURING_MOVE_SETTING = "refreshDuringMove";

// WebGL fragment shader to generate outline highlights around opaque texture pixels.
const ALPHA_OUTLINE_FRAGMENT_SHADER = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outlineColor;
uniform float thickness;
uniform float alphaThreshold;

void main() {
    vec4 currentColor = texture2D(uSampler, vTextureCoord);
    if (currentColor.a > alphaThreshold) {
        gl_FragColor = currentColor;
        return;
    }

    vec2 pixel = vec2(1.0 / inputSize.x, 1.0 / inputSize.y) * thickness;
    float alpha = 0.0;
    alpha = max(alpha, texture2D(uSampler, vTextureCoord + vec2(pixel.x, 0.0)).a);
    alpha = max(alpha, texture2D(uSampler, vTextureCoord + vec2(-pixel.x, 0.0)).a);
    alpha = max(alpha, texture2D(uSampler, vTextureCoord + vec2(0.0, pixel.y)).a);
    alpha = max(alpha, texture2D(uSampler, vTextureCoord + vec2(0.0, -pixel.y)).a);
    alpha = max(alpha, texture2D(uSampler, vTextureCoord + vec2(pixel.x, pixel.y)).a);
    alpha = max(alpha, texture2D(uSampler, vTextureCoord + vec2(-pixel.x, pixel.y)).a);
    alpha = max(alpha, texture2D(uSampler, vTextureCoord + vec2(pixel.x, -pixel.y)).a);
    alpha = max(alpha, texture2D(uSampler, vTextureCoord + vec2(-pixel.x, -pixel.y)).a);

    if (alpha > alphaThreshold) {
        gl_FragColor = outlineColor;
        return;
    }

    gl_FragColor = currentColor;
}
`;

// =============================================================================
// Internal State Fields: Backing caches and active rendering state.
// =============================================================================

let _highlightedFilterTargets = new Set();
let _pendingHighlightRefresh = null;
const _alphaShapeCache = new Map();
const _targetFilterSignatures = new WeakMap();

// =============================================================================
// Public Accessors and Queries: Configuration getters and token queries.
// =============================================================================

// Retrieve the highlight outline thickness configured in module settings.
function getHighlightThickness() {
    return game.settings.get(MODULE_ID, THICKNESS_SETTING) ?? 4;
}

// Compute the pixel conversion factor for current scene distance units.
function getPixelsPerSceneUnit() {
    const activeCanvas = globalThis.canvas;
    const gridSize = activeCanvas.grid?.size ?? activeCanvas.dimensions?.size ?? 100;
    const gridDistance = Number(activeCanvas.scene?.grid?.distance ?? activeCanvas.dimensions?.distance ?? 1) || 1;
    return gridSize / gridDistance;
}

// Retrieve and normalize all aura definitions on a token.
function getTokenAuras(token) {
    return normalizeAuras(parseAuras(token.document?.getFlag?.(MODULE_ID, "auras")));
}

// Read stored aura definitions from token or prototype actor documents.
function getSavedAuras(app) {
    const doc = app.document ?? app.object ?? app.token ?? app.actor?.prototypeToken;
    return normalizeAuras(parseAuras(doc?.getFlag?.(MODULE_ID, "auras")));
}

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
    _alphaShapeCache.clear();
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
// Primary Operations: Core highlight collection and rendering pipeline.
// =============================================================================

// Defer highlight recalculation to the next animation frame.
function scheduleAuraHighlightRefresh() {
    if (_pendingHighlightRefresh !== null) return;

    _pendingHighlightRefresh = requestAnimationFrame(() => {
        _pendingHighlightRefresh = null;
        refreshAuraHighlights();
    });
}

// Recompute and apply all active aura highlights on the canvas.
function refreshAuraHighlights() {
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

// Synchronize highlight filters across all canvas targets.
function syncTargetHighlights(highlights, activeCanvas) {
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
function clearAuraHighlights() {
    if (_pendingHighlightRefresh !== null) {
        cancelAnimationFrame(_pendingHighlightRefresh);
        _pendingHighlightRefresh = null;
    }

    for (const target of _highlightedFilterTargets) {
        removeHighlightFilters(target);
    }
    _highlightedFilterTargets.clear();

    clearFallbackGraphics();
}

// Destroy vector fallback graphics from the canvas highlight container.
function clearFallbackGraphics() {
    const container = findHighlightContainer();
    if (container) clearHighlightContainer(container);
}

// Collect all active highlights across all controlled source tokens.
function collectAuraHighlights(sourceTokens) {
    const highlights = new Map();
    const pixelsPerUnit = getPixelsPerSceneUnit();
    const tokenCache = new Map();

    for (const source of sourceTokens) {
        evaluateSourceTokenAuras(source, tokenCache, pixelsPerUnit, highlights);
    }

    return highlights;
}

// Query spatial partition to locate candidate targets within maximum aura range.
function getCandidateTargets(source, maxRangePixels) {
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
function evaluateSourceTokenAuras(source, tokenCache, pixelsPerUnit, highlights) {
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
function evaluateTargetCandidate(source, target, auras, sourceData, tokenCache, pixelsPerUnit, maxRangePixels2, highlights) {
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

// Apply shader outline filters or vector graphic overlays to a highlighted token.
function highlightToken(token, highlights) {
    const target = getTokenFilterTarget(token);

    if (target) {
        applyHighlightFilters(target, highlights);
        return target;
    }

    drawFallbackTokenHighlights(getHighlightContainer(), token, highlights);
    return null;
}

// Inject the Auras management tab into the token configuration sheet.
function injectAurasTab(app, element) {
    const root = getRootElement(element);
    if (!root || root.querySelector(`[data-tab="${AURAS_TAB}"]`)) return;

    const tabsNav = findTabsNav(root);
    const existingTab = findExistingTab(root, tabsNav);
    if (!tabsNav || !existingTab) {
        console.warn(`${MODULE_ID} | Could not find token config tabs to add Auras tab.`);
        return;
    }

    const group = tabsNav.dataset.group || existingTab.dataset.group || "sheet";
    const aurasTabButton = createAurasTabButton(group);
    const aurasPanel = createAurasTabPanel(group, getSavedAuras(app));

    tabsNav.append(aurasTabButton);
    existingTab.after(aurasPanel);
    activateAurasControls(root, group, aurasPanel);
}

// Bind DOM event listeners to controls in the Auras tab.
function activateAurasControls(root, group, panel) {
    const form = root.querySelector("form");
    const aurasTabButton = root.querySelector(`[data-tab="${AURAS_TAB}"][data-group="${group}"]`);

    aurasTabButton?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        activateAurasTab(root, group);
    });

    panel.querySelector("[data-action='add-aura']")?.addEventListener("click", () => {
        const auras = readAuras(panel);
        auras.push(createDefaultAura(auras.length));
        renderAuras(panel, auras);
    });

    panel.addEventListener("input", () => syncAurasField(panel));
    panel.addEventListener("change", () => syncAurasField(panel));
    panel.addEventListener("click", (event) => handleAuraListClick(event, panel));

    form?.addEventListener("submit", () => syncAurasField(panel), { capture: true });
}

// Handle deletion click events on individual aura rows.
function handleAuraListClick(event, panel) {
    if (!(event.target instanceof Element)) return;

    const deleteButton = event.target.closest("[data-action='delete-aura']");
    if (!deleteButton) return;

    const auraItem = deleteButton.closest("[data-aura-id]");
    const id = auraItem?.dataset.auraId;
    if (!id) return;

    const remainingAuras = readAuras(panel).filter((aura) => aura.id !== id);
    renderAuras(panel, remainingAuras);
}

// Populate the HTML panel with rendered aura item rows.
function renderAuras(panel, auras) {
    const normalizedAuras = normalizeAuras(auras);
    const list = panel.querySelector("[data-auras-list]");
    const empty = panel.querySelector("[data-empty]");
    if (!list || !empty) return;

    list.innerHTML = normalizedAuras.map((aura, index) => renderAura(aura, index)).join("");
    empty.hidden = normalizedAuras.length > 0;
    syncAurasField(panel);
}

// Generate the HTML markup for a single aura configuration card.
function renderAura(aura, index) {
    const id = escapeHtml(aura.id);
    const nameLabel = localize("settings.name.name");
    const rangeLabel = `${localize("settings.radius.name")} (Scene Units)`;
    const colorLabel = localize("settings.color.name");
    const fromLabel = localize("settings.measurement.from");
    const toLabel = localize("settings.measurement.to");
    const wallsLabel = localize("settings.walls.name");
    const enabledLabel = localize("settings.enabled.name");
    const isGM = game.user.isGM;

    return `
        <fieldset class="basic-aura-highlighting__aura" data-aura-id="${id}">
            <legend>${escapeHtml(aura.name || defaultAuraName(index))}</legend>
            <div class="form-group">
                <label for="${id}-enabled">${enabledLabel}</label>
                <div class="form-fields">
                    <input id="${id}-enabled" type="checkbox" ${aura.enabled ? "checked" : ""} data-aura-field="enabled">
                </div>
            </div>
            <div class="form-group">
                <label for="${id}-name">${nameLabel}</label>
                <div class="form-fields">
                    <input id="${id}-name" type="text" value="${escapeHtml(aura.name)}" data-aura-field="name">
                </div>
            </div>
            <div class="form-group">
                <label for="${id}-range">${rangeLabel}</label>
                <div class="form-fields">
                    <input id="${id}-range" type="number" min="0" step="0.5" value="${aura.range}" data-aura-field="range">
                </div>
            </div>
            <div class="form-group">
                <label for="${id}-color">${colorLabel}</label>
                <div class="form-fields">
                    <input id="${id}-color" type="color" value="${escapeHtml(aura.color)}" data-aura-field="color">
                </div>
            </div>
            <div class="form-group">
                <label for="${id}-from">${fromLabel}</label>
                <div class="form-fields">
                    <select id="${id}-from" data-aura-field="from">
                        <option value="edge" ${aura.from === "edge" ? "selected" : ""}>${localize("settings.measurement.edge")}</option>
                        <option value="center" ${aura.from === "center" ? "selected" : ""}>${localize("settings.measurement.center")}</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label for="${id}-to">${toLabel}</label>
                <div class="form-fields">
                    <select id="${id}-to" data-aura-field="to">
                        <option value="edge" ${aura.to === "edge" ? "selected" : ""}>${localize("settings.measurement.edge")}</option>
                        <option value="center" ${aura.to === "center" ? "selected" : ""}>${localize("settings.measurement.center")}</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label for="${id}-walls">${wallsLabel}</label>
                <div class="form-fields">
                    <input id="${id}-walls" type="checkbox" ${aura.walls ? "checked" : ""} data-aura-field="walls" ${isGM ? "" : "disabled"}>
                </div>
            </div>
            <div class="form-group">
                <button type="button" class="basic-aura-highlighting__delete" data-action="delete-aura">
                    <i class="fa-solid fa-trash"></i> ${localize("tabs.delete")}
                </button>
            </div>
        </fieldset>
    `;
}

// =============================================================================
// Helper Functions: Geometric calculations and distance algorithms.
// =============================================================================

// Retrieve or initialize cached geometry and elevation data for a token.
function getCachedTokenData(token, cache, pixelsPerUnit) {
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

// Determine whether a target token is within range and line-of-sight of an aura.
function isTokenInAuraCached(source, target, aura, sourceData, targetData, dz2, rangePixels2) {
    // 0. Fast reject using rectangular bounding boxes
    const sourceBounds = sourceData.bounds;
    const targetBounds = targetData.bounds;
    if (measureBoundsGapSquared(sourceBounds, targetBounds) + dz2 > rangePixels2) {
        return false;
    }

    // 1. Narrow phase distance check using configured measurement points
    const d2d2 = measureAuraDistanceSquared(source, target, aura, sourceData, targetData);
    if (d2d2 + dz2 > rangePixels2) {
        return false;
    }

    // 2. Obstruction check using scene wall geometry
    if (aura.walls) {
        const isBlocked = CONFIG.Canvas.polygonBackends.sight.testCollision(
            sourceData.center,
            targetData.center,
            { mode: "any", type: "sight" },
        );
        if (isBlocked) return false;
    }

    return true;
}

// Calculate the squared Euclidean distance between two token centers.
function measureCenterDistance2(sourceData, targetData) {
    const dx = sourceData.center.x - targetData.center.x;
    const dy = sourceData.center.y - targetData.center.y;
    return dx * dx + dy * dy; // Distance squared calculation
}

// Measure the squared distance between tokens according to configured aura modes.
function measureAuraDistanceSquared(source, target, aura, sourceData, targetData) {
    if (aura.from === "center" && aura.to === "center") {
        return measureCenterDistance2(sourceData, targetData);
    }

    const sourcePoints = getMeasurementPointsCached(source, aura.from, sourceData);
    const targetPoints = getMeasurementPointsCached(target, aura.to, targetData);

    if (sourcePoints.length === 0 || targetPoints.length === 0) {
        return measureBoundsDistance2(sourceData, targetData, aura);
    }

    return measurePointSetDistance2(sourcePoints, targetPoints);
}

// Calculate bounding box fallback distance when texture alpha points are missing.
function measureBoundsDistance2(sourceData, targetData, aura) {
    if (aura.from === "center") {
        return measurePointToBoundsDistance2(sourceData.center, targetData.bounds);
    }
    if (aura.to === "center") {
        return measurePointToBoundsDistance2(targetData.center, sourceData.bounds);
    }

    return measureBoundsGapSquared(sourceData.bounds, targetData.bounds);
}

// Calculate the shortest squared Euclidean distance between two rectangles.
function measureBoundsGapSquared(sourceBounds, targetBounds) {
    const dx = Math.max(sourceBounds.x - targetBounds.right, targetBounds.x - sourceBounds.right, 0);
    const dy = Math.max(sourceBounds.y - targetBounds.bottom, targetBounds.y - sourceBounds.bottom, 0);
    return dx * dx + dy * dy; // Distance squared calculation
}

// Calculate the shortest squared distance from a 2D point to a rectangle boundary.
function measurePointToBoundsDistance2(point, bounds) {
    const dx = Math.max(bounds.x - point.x, point.x - bounds.right, 0);
    const dy = Math.max(bounds.y - point.y, point.y - bounds.bottom, 0);
    return dx * dx + dy * dy; // Distance squared calculation
}

// Retrieve cached measurement points or sample texture alpha edge points.
function getMeasurementPointsCached(token, mode, tokenData) {
    if (mode === "center") return [tokenData.center];

    if (tokenData.alphaPoints === null) {
        tokenData.alphaPoints = getTokenAlphaEdgePoints(token);
    }
    return tokenData.alphaPoints;
}

// Find the minimum squared distance between two sets of 2D points.
function measurePointSetDistance2(sourcePoints, targetPoints) {
    let minDistanceSquared = Infinity;

    for (let i = 0, lenS = sourcePoints.length; i < lenS; i++) {
        const sP = sourcePoints[i];
        for (let j = 0, lenT = targetPoints.length; j < lenT; j++) {
            const tP = targetPoints[j];
            const dx = sP.x - tP.x;
            const dy = sP.y - tP.y;
            const d2 = dx * dx + dy * dy; // Distance squared calculation

            if (d2 < minDistanceSquared) {
                minDistanceSquared = d2;
                if (minDistanceSquared === 0) return 0;
            }
        }
    }

    return minDistanceSquared;
}

// =============================================================================
// Helper Functions: Texture sampling and edge detection.
// =============================================================================

// Extract canvas world coordinates along the visible boundary of a token texture.
function getTokenAlphaEdgePoints(token) {
    const displayObject = getTokenFilterTarget(token);
    const normalizedPoints = getTextureAlphaEdgePoints(displayObject);
    if (normalizedPoints.length === 0) return [];

    const mapper = getAlphaPointMapper(displayObject, token);
    return normalizedPoints.map(mapper);
}

// Create a coordinate transform function from local texture space to canvas space.
function getAlphaPointMapper(displayObject, token) {
    const localBounds = displayObject?.getLocalBounds?.();
    const transform = displayObject?.worldTransform;
    const stageTransform = globalThis.canvas?.stage?.worldTransform;

    if (localBounds && transform?.apply && stageTransform?.applyInverse) {
        return (point) => {
            // Coordinate transformation math: local mesh to canvas coordinates
            const localPoint = {
                x: localBounds.x + point.x * localBounds.width,
                y: localBounds.y + point.y * localBounds.height,
            };
            const worldPoint = transform.apply(localPoint);
            return stageTransform.applyInverse(worldPoint);
        };
    }

    const bounds = token.bounds;
    return (point) => ({
        x: bounds.x + point.x * bounds.width,
        y: bounds.y + point.y * bounds.height,
    });
}

// Retrieve cached normalized alpha boundary points for a display object texture.
function getTextureAlphaEdgePoints(displayObject) {
    const texture = displayObject?.texture;
    const source = getTextureSource(texture);
    if (!texture || !source) return [];

    const frame = getTextureFrame(texture, source);
    const cacheKey = getAlphaShapeCacheKey(texture, frame);
    if (_alphaShapeCache.has(cacheKey)) return _alphaShapeCache.get(cacheKey);

    const points = sampleTextureAlphaEdges(source, frame);

    // Evict oldest cached geometry entries when limit is reached
    if (_alphaShapeCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = _alphaShapeCache.keys().next().value;
        _alphaShapeCache.delete(oldestKey);
    }

    _alphaShapeCache.set(cacheKey, points);
    return points;
}

// Resolve the underlying canvas image source element from a PIXI texture.
function getTextureSource(texture) {
    const source =
        texture?.source?.resource?.source ??
        texture?.source?.resource ??
        texture?.baseTexture?.resource?.source ??
        texture?.baseTexture?.resource ??
        null;

    return isCanvasImageSource(source) ? source : null;
}

// Validate whether an object is a valid browser image source element.
function isCanvasImageSource(source) {
    const constructors = [
        globalThis.HTMLImageElement,
        globalThis.HTMLCanvasElement,
        globalThis.HTMLVideoElement,
        globalThis.ImageBitmap,
        globalThis.OffscreenCanvas,
    ].filter(Boolean);

    return constructors.some((constructor) => source instanceof constructor);
}

// Determine the sub-frame dimensions of a texture within its source image.
function getTextureFrame(texture, source) {
    const frame = texture.frame ?? texture._frame;
    const width =
        frame?.width ??
        texture.width ??
        source.videoWidth ??
        source.naturalWidth ??
        source.width;
    const height =
        frame?.height ??
        texture.height ??
        source.videoHeight ??
        source.naturalHeight ??
        source.height;

    return {
        x: frame?.x ?? 0,
        y: frame?.y ?? 0,
        width,
        height,
    };
}

// Generate a deterministic cache identifier for texture alpha shape data.
function getAlphaShapeCacheKey(texture, frame) {
    const textureId =
        texture.cacheId ??
        texture.source?.uid ??
        texture.baseTexture?.uid ??
        texture.baseTexture?.cacheId ??
        texture.uid ??
        "texture";
    return `${textureId}:${frame.x}:${frame.y}:${frame.width}:${frame.height}:${ALPHA_SAMPLE_SIZE}:${HIGHLIGHT_ALPHA_THRESHOLD}`;
}

// Draw the texture to an offscreen canvas and sample boundary pixel alpha values.
function sampleTextureAlphaEdges(source, frame) {
    const canvas = document.createElement("canvas");
    canvas.width = ALPHA_SAMPLE_SIZE;
    canvas.height = ALPHA_SAMPLE_SIZE;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !frame.width || !frame.height) return [];

    try {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
            source,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            0,
            0,
            canvas.width,
            canvas.height,
        );
        return getAlphaEdgeSamplePoints(
            context.getImageData(0, 0, canvas.width, canvas.height),
        );
    } catch (error) {
        console.warn(
            `${MODULE_ID} | Could not sample token texture alpha for aura distance. Falling back to token bounds.`,
            error,
        );
        return [];
    }
}

// Identify boundary pixels between opaque and transparent texture regions.
function getAlphaEdgeSamplePoints(imageData) {
    const alphaThreshold = HIGHLIGHT_ALPHA_THRESHOLD * 255;
    const { data, width, height } = imageData;
    const totalPixels = width * height;
    const opaquePixels = new Uint8Array(totalPixels);
    const rawPoints = [];

    // 0. Identify opaque pixel indices
    for (let i = 0; i < totalPixels; i++) {
        opaquePixels[i] = data[i * 4 + 3] >= alphaThreshold ? 1 : 0;
    }

    // 1. Extract coordinates of opaque pixels bordering transparent neighbors
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            if (!opaquePixels[index] || !isAlphaEdgePixel(opaquePixels, width, height, x, y)) {
                continue;
            }

            rawPoints.push({
                x: (x + 0.5) / width,
                y: (y + 0.5) / height,
            });
        }
    }

    // 2. Subsample point cloud to keep distance comparisons within bounds
    return decimateEdgePoints(rawPoints, MAX_ALPHA_EDGE_POINTS);
}

// Subsample a list of edge points evenly to a maximum target count.
function decimateEdgePoints(points, maxCount) {
    const len = points.length;
    if (len <= maxCount) return points;

    const step = len / maxCount;
    const decimated = [];
    for (let i = 0; i < maxCount; i++) {
        decimated.push(points[Math.floor(i * step)]);
    }
    return decimated;
}

// Determine whether an opaque pixel is adjacent to any transparent pixel.
function isAlphaEdgePixel(opaquePixels, width, height, x, y) {
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;

            const neighborX = x + dx;
            const neighborY = y + dy;
            if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) {
                return true;
            }
            if (!opaquePixels[neighborY * width + neighborX]) {
                return true;
            }
        }
    }

    return false;
}

// =============================================================================
// Helper Functions: Filter creation and highlight rendering.
// =============================================================================

// Locate the display object mesh or icon to receive highlight filters.
function getTokenFilterTarget(token) {
    return token.mesh ?? token.icon ?? token.children?.find((child) => child.texture) ?? null;
}

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

// =============================================================================
// Helper Functions: DOM construction and navigation for token sheets.
// =============================================================================

// Resolve the root HTMLElement from raw element or jQuery wrapper.
function getRootElement(element) {
    if (element instanceof HTMLElement) return element;
    if (element?.[0] instanceof HTMLElement) return element[0];
    return null;
}

// Locate tab navigation element within token sheet root.
function findTabsNav(root) {
    return root.querySelector("nav.tabs[data-group], .tabs[data-group], nav.tabs, .tabs");
}

// Locate an existing tab page element to insert the Auras tab after.
function findExistingTab(root, tabsNav) {
    const group = tabsNav?.dataset.group;
    if (group) {
        const tab = root.querySelector(`.tab[data-group="${group}"][data-tab]`);
        if (tab) return tab;
    }
    return root.querySelector(".tab[data-tab]");
}

// Create the navigation tab button element for the Auras tab.
function createAurasTabButton(group) {
    const button = document.createElement("a");
    button.classList.add("item");
    button.dataset.tab = AURAS_TAB;
    button.dataset.group = group;
    button.dataset.action = "tab";
    button.innerHTML = `<i class="fa-solid fa-bullseye"></i> ${localize("tabs.auras")}`;
    return button;
}

// Create the tab panel container element for configuring auras.
function createAurasTabPanel(group, auras) {
    const panel = document.createElement("section");
    panel.classList.add("tab", "basic-aura-highlighting");
    panel.dataset.tab = AURAS_TAB;
    panel.dataset.group = group;
    panel.innerHTML = `
        <input type="hidden" name="${AURAS_FLAG_PATH}" data-dtype="JSON">
        <div class="basic-aura-highlighting__header">
            <button type="button" class="basic-aura-highlighting__add" data-action="add-aura" title="${localize("tabs.add")}">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
        <div class="basic-aura-highlighting__list" data-auras-list></div>
        <p class="hint basic-aura-highlighting__empty" data-empty>${localize("tabs.empty")}</p>
    `;

    renderAuras(panel, auras);
    return panel;
}

// Switch the active tab in the token configuration sheet to the Auras tab.
function activateAurasTab(root, group) {
    for (const tab of root.querySelectorAll(`.tab[data-group="${group}"], .tab[data-tab]`)) {
        tab.classList.toggle("active", tab.dataset.tab === AURAS_TAB);
    }

    for (const item of root.querySelectorAll(`[data-group="${group}"][data-tab], .tabs [data-tab]`)) {
        item.classList.toggle("active", item.dataset.tab === AURAS_TAB);
    }
}

// Extract form input data from the Auras tab panel into structured aura objects.
function readAuras(panel) {
    return Array.from(panel.querySelectorAll("[data-aura-id]")).map((item) => ({
        id: item.dataset.auraId,
        name: item.querySelector("[data-aura-field='name']")?.value?.trim() || "",
        range: Number(item.querySelector("[data-aura-field='range']")?.value) || 0,
        color: item.querySelector("[data-aura-field='color']")?.value || "#ff0000",
        from: normalizeMeasurementMode(item.querySelector("[data-aura-field='from']")?.value),
        to: normalizeMeasurementMode(item.querySelector("[data-aura-field='to']")?.value),
        walls: Boolean(item.querySelector("[data-aura-field='walls']")?.checked),
        enabled: Boolean(item.querySelector("[data-aura-field='enabled']")?.checked),
    }));
}

// Synchronize the hidden JSON form input field with current aura panel state.
function syncAurasField(panel) {
    const hidden = panel.querySelector(`input[name="${AURAS_FLAG_PATH}"]`);
    if (hidden) hidden.value = JSON.stringify(readAuras(panel));
}

// =============================================================================
// Format Conversions and Utility Functions: Data sanitization and parsing.
// =============================================================================

// Standardize aura object structure with fallback values for missing fields.
function normalizeAura(aura = {}) {
    const legacyMeasurement = normalizeMeasurementMode(aura.measurement);
    return {
        id: typeof aura.id === "string" ? aura.id : randomId(),
        name: typeof aura.name === "string" ? aura.name : "",
        range: Number.isFinite(Number(aura.range)) ? Number(aura.range) : 10,
        color: typeof aura.color === "string" ? aura.color : "#ff0000",
        from: normalizeMeasurementMode(aura.from ?? legacyMeasurement),
        to: normalizeMeasurementMode(aura.to ?? legacyMeasurement),
        walls: aura.walls ?? true,
        enabled: aura.enabled ?? true,
    };
}

// Normalize an array of aura objects and ensure default titles.
function normalizeAuras(auras) {
    return auras.map((aura, index) => {
        const normalized = normalizeAura(aura);
        if (!normalized.name) normalized.name = defaultAuraName(index);
        return normalized;
    });
}

// Construct a new aura object with default configuration values.
function createDefaultAura(index) {
    return {
        ...normalizeAura(),
        name: defaultAuraName(index),
    };
}

// Generate the fallback display name for an aura by its list index.
function defaultAuraName(index) {
    return `${localize("tabs.auras")} ${index + 1}`;
}

// Constrain measurement mode input to valid center or edge values.
function normalizeMeasurementMode(value) {
    return value === "center" ? "center" : "edge";
}

// Normalize aura data in update delta payloads before database persistence.
function parseAurasInChanges(changes, path) {
    const value = foundry.utils.getProperty(changes, path);
    if (typeof value !== "string") return;
    foundry.utils.setProperty(changes, path, normalizeAuras(parseAuras(value)));
}

// Parse raw aura definitions from JSON string or return existing arrays.
function parseAuras(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

// Convert a hex color string or number to an integer color value.
function colorToNumber(color) {
    const value = String(color).replace("#", "");
    const parsed = Number.parseInt(value, 16);
    return Number.isFinite(parsed) ? parsed : 0xff0000;
}

// Convert a numeric hex color value to a normalized RGBA array [r, g, b, a].
function colorToRgbArray(color) {
    return [
        ((color >> 16) & 0xff) / 255,
        ((color >> 8) & 0xff) / 255,
        (color & 0xff) / 255,
        1,
    ];
}

// Localize an internationalization string key for the module.
function localize(path) {
    return game.i18n.localize(`BASIC_AURA_HIGHLIGHTING.${path}`);
}

// Generate a random unique identifier string.
function randomId() {
    return globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2);
}

// Escape HTML special characters to prevent cross-site scripting in markup.
function escapeHtml(value) {
    return String(value).replace(
        /[&<>"']/g,
        (character) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character],
    );
}
