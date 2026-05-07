const MODULE_ID = "basic_aura_highlighting";
const AURAS_TAB = "basic-aura-highlighting-auras";
const AURAS_FLAG_PATH = `flags.${MODULE_ID}.auras`;
const HIGHLIGHT_CONTAINER_NAME = `${MODULE_ID}.highlights`;
const HIGHLIGHT_LINE_WIDTH = 4;
const HIGHLIGHT_RING_SPACING = 5;
const HIGHLIGHT_ALPHA_THRESHOLD = 0.2;
const ALPHA_SAMPLE_SIZE = 48;
const HIGHLIGHT_FILTER_MARKER = Symbol(MODULE_ID);
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

let highlightedFilterTargets = new Set();
let pendingHighlightRefresh = null;
const alphaShapeCache = new Map();

Hooks.on("renderTokenConfig", injectAurasTab);
Hooks.on("renderPrototypeTokenConfig", injectAurasTab);
Hooks.on("preUpdateToken", (_token, changes) =>
  parseAurasInChanges(changes, AURAS_FLAG_PATH),
);
Hooks.on("preUpdateActor", (_actor, changes) =>
  parseAurasInChanges(changes, `prototypeToken.${AURAS_FLAG_PATH}`),
);
Hooks.on("canvasReady", scheduleAuraHighlightRefresh);
Hooks.on("canvasTearDown", clearAuraHighlights);
Hooks.on("controlToken", scheduleAuraHighlightRefresh);
Hooks.on("updateToken", scheduleAuraHighlightRefresh);
Hooks.on("moveToken", scheduleAuraHighlightRefresh);
Hooks.on("stopToken", scheduleAuraHighlightRefresh);
Hooks.on("refreshToken", scheduleAuraHighlightRefresh);
Hooks.on("createToken", scheduleAuraHighlightRefresh);
Hooks.on("deleteToken", scheduleAuraHighlightRefresh);

function injectAurasTab(app, element) {
  const root = getRootElement(element);
  if (!root || root.querySelector(`[data-tab="${AURAS_TAB}"]`)) return;

  const tabsNav = findTabsNav(root);
  const existingTab = findExistingTab(root, tabsNav);
  if (!tabsNav || !existingTab) {
    console.warn(
      `${MODULE_ID} | Could not find token config tabs to add Auras tab.`,
    );
    return;
  }

  const group = tabsNav.dataset.group || existingTab.dataset.group || "sheet";
  const aurasTabButton = createAurasTabButton(group);
  const aurasPanel = createAurasTabPanel(group, getSavedAuras(app));

  tabsNav.append(aurasTabButton);
  existingTab.after(aurasPanel);
  activateAurasControls(root, group, aurasPanel);
}

function getRootElement(element) {
  if (element instanceof HTMLElement) return element;
  if (element?.[0] instanceof HTMLElement) return element[0];
  return null;
}

function findTabsNav(root) {
  return root.querySelector(
    `nav.tabs[data-group], .tabs[data-group], nav.tabs, .tabs`,
  );
}

function findExistingTab(root, tabsNav) {
  const group = tabsNav?.dataset.group;
  const selector = group
    ? `.tab[data-group="${group}"][data-tab]`
    : `.tab[data-tab]`;
  return root.querySelector(selector) || root.querySelector(`.tab[data-tab]`);
}

function getSavedAuras(app) {
  const document =
    app.document ?? app.object ?? app.token ?? app.actor?.prototypeToken;
  return normalizeAuras(parseAuras(document?.getFlag?.(MODULE_ID, "auras")));
}

function createAurasTabButton(group) {
  const button = document.createElement("a");
  button.classList.add("item");
  button.dataset.tab = AURAS_TAB;
  button.dataset.group = group;
  button.dataset.action = "tab";
  button.innerHTML = `<i class="fa-solid fa-bullseye"></i> ${localize("tabs.auras")}`;
  return button;
}

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

function activateAurasControls(root, group, panel) {
  const form = root.querySelector("form");
  const aurasTabButton = root.querySelector(
    `[data-tab="${AURAS_TAB}"][data-group="${group}"]`,
  );

  aurasTabButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activateAurasTab(root, group);
  });

  panel
    .querySelector("[data-action='add-aura']")
    ?.addEventListener("click", () => {
      const auras = readAuras(panel);
      auras.push(createDefaultAura(auras.length));
      renderAuras(panel, auras);
    });

  panel.addEventListener("input", () => syncAurasField(panel));
  panel.addEventListener("change", () => syncAurasField(panel));
  panel.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const deleteButton = event.target.closest("[data-action='delete-aura']");
    if (!deleteButton) return;

    const auraItem = deleteButton.closest("[data-aura-id]");
    const id = auraItem?.dataset.auraId;
    renderAuras(
      panel,
      readAuras(panel).filter((aura) => aura.id !== id),
    );
  });

  form?.addEventListener("submit", () => syncAurasField(panel), {
    capture: true,
  });
}

function renderAuras(panel, auras) {
  const normalizedAuras = normalizeAuras(auras);
  const list = panel.querySelector("[data-auras-list]");
  const empty = panel.querySelector("[data-empty]");
  if (!list || !empty) return;

  list.innerHTML = normalizedAuras
    .map((aura, index) => renderAura(aura, index))
    .join("");
  empty.hidden = normalizedAuras.length > 0;
  syncAurasField(panel);
}

function renderAura(aura, index) {
  const id = escapeHtml(aura.id);
  const nameLabel = localize("settings.name.name");
  const rangeLabel = localize("settings.radius.name");
  const colorLabel = localize("settings.color.name");
  const fromLabel = localize("settings.measurement.from");
  const toLabel = localize("settings.measurement.to");

  return `
    <fieldset class="basic-aura-highlighting__aura" data-aura-id="${id}">
      <legend>${escapeHtml(aura.name || defaultAuraName(index))}</legend>
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
        <p class="hint">${localize("settings.radius.hint")}</p>
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
        <button type="button" class="basic-aura-highlighting__delete" data-action="delete-aura">
          <i class="fa-solid fa-trash"></i> ${localize("tabs.delete")}
        </button>
      </div>
    </fieldset>
  `;
}

function readAuras(panel) {
  return Array.from(panel.querySelectorAll("[data-aura-id]")).map((item) => ({
    id: item.dataset.auraId,
    name: item.querySelector("[data-aura-field='name']")?.value?.trim() || "",
    range: Number(item.querySelector("[data-aura-field='range']")?.value) || 0,
    color: item.querySelector("[data-aura-field='color']")?.value || "#ff0000",
    from: normalizeMeasurementMode(
      item.querySelector("[data-aura-field='from']")?.value,
    ),
    to: normalizeMeasurementMode(
      item.querySelector("[data-aura-field='to']")?.value,
    ),
  }));
}

function syncAurasField(panel) {
  const hidden = panel.querySelector(`input[name="${AURAS_FLAG_PATH}"]`);
  if (hidden) hidden.value = JSON.stringify(readAuras(panel));
}

function normalizeAura(aura = {}) {
  const legacyMeasurement = normalizeMeasurementMode(aura.measurement);
  return {
    id: typeof aura.id === "string" ? aura.id : randomId(),
    name: typeof aura.name === "string" ? aura.name : "",
    range: Number.isFinite(Number(aura.range)) ? Number(aura.range) : 10,
    color: typeof aura.color === "string" ? aura.color : "#ff0000",
    from: normalizeMeasurementMode(aura.from ?? legacyMeasurement),
    to: normalizeMeasurementMode(aura.to ?? legacyMeasurement),
  };
}

function normalizeAuras(auras) {
  return auras.map((aura, index) => {
    const normalizedAura = normalizeAura(aura);
    if (!normalizedAura.name) normalizedAura.name = defaultAuraName(index);
    return normalizedAura;
  });
}

function createDefaultAura(index) {
  return {
    ...normalizeAura(),
    name: defaultAuraName(index),
  };
}

function defaultAuraName(index) {
  return `${localize("tabs.auras")} ${index + 1}`;
}

function normalizeMeasurementMode(value) {
  return value === "center" ? "center" : "edge";
}

function parseAurasInChanges(changes, path) {
  const value = foundry.utils.getProperty(changes, path);
  if (typeof value !== "string") return;
  foundry.utils.setProperty(changes, path, normalizeAuras(parseAuras(value)));
}

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

function scheduleAuraHighlightRefresh() {
  if (pendingHighlightRefresh !== null) return;

  pendingHighlightRefresh = requestAnimationFrame(() => {
    pendingHighlightRefresh = null;
    refreshAuraHighlights();
  });
}

function refreshAuraHighlights() {
  const activeCanvas = globalThis.canvas;
  if (!activeCanvas?.ready || !activeCanvas.tokens) return;

  clearAuraHighlights();

  const sourceTokens = activeCanvas.tokens.controlled.filter(
    (token) => getTokenAuras(token).length > 0,
  );
  if (sourceTokens.length === 0) return;

  const highlights = collectAuraHighlights(sourceTokens);
  for (const [targetId, targetHighlights] of highlights) {
    const target = activeCanvas.tokens.placeables.find(
      (token) => token.id === targetId,
    );
    if (!target) continue;
    highlightToken(target, targetHighlights);
  }
}

function clearAuraHighlights() {
  if (pendingHighlightRefresh !== null) {
    cancelAnimationFrame(pendingHighlightRefresh);
    pendingHighlightRefresh = null;
  }

  for (const target of highlightedFilterTargets) {
    removeHighlightFilters(target);
  }
  highlightedFilterTargets = new Set();

  const activeCanvas = globalThis.canvas;
  const parent = activeCanvas?.interface ?? activeCanvas?.tokens;
  const container =
    parent?.getChildByName?.(HIGHLIGHT_CONTAINER_NAME) ??
    parent?.children?.find((child) => child.name === HIGHLIGHT_CONTAINER_NAME);
  if (container) clearHighlightContainer(container);
}

function getHighlightContainer() {
  const activeCanvas = globalThis.canvas;
  const parent = activeCanvas.interface ?? activeCanvas.tokens;
  let container =
    parent.getChildByName?.(HIGHLIGHT_CONTAINER_NAME) ??
    parent.children?.find((child) => child.name === HIGHLIGHT_CONTAINER_NAME);
  if (container) return container;

  container = new PIXI.Container();
  container.name = HIGHLIGHT_CONTAINER_NAME;
  container.eventMode = "none";
  container.interactiveChildren = false;
  parent.addChild(container);
  return container;
}

function clearHighlightContainer(container) {
  for (const child of container.removeChildren()) {
    child.destroy();
  }
}

function collectAuraHighlights(sourceTokens) {
  const highlights = new Map();

  for (const source of sourceTokens) {
    const auras = getTokenAuras(source);
    for (const target of globalThis.canvas.tokens.placeables) {
      if (target === source || target.document.hidden) continue;

      for (const aura of auras) {
        if (!isTokenInAura(source, target, aura)) continue;

        const targetHighlights = highlights.get(target.id) ?? [];
        targetHighlights.push(aura);
        highlights.set(target.id, targetHighlights);
      }
    }
  }

  return highlights;
}

function getTokenAuras(token) {
  return normalizeAuras(
    parseAuras(token.document?.getFlag?.(MODULE_ID, "auras")),
  );
}

function isTokenInAura(source, target, aura) {
  const rangePixels = aura.range * getPixelsPerSceneUnit();
  return measureAuraDistance(source, target, aura) <= rangePixels;
}

function measureCenterDistance(source, target) {
  return Math.hypot(
    source.center.x - target.center.x,
    source.center.y - target.center.y,
  );
}

function measureAuraDistance(source, target, aura) {
  const sourcePoints = getMeasurementPoints(source, aura.from);
  const targetPoints = getMeasurementPoints(target, aura.to);
  if (sourcePoints.length === 0 || targetPoints.length === 0)
    return measureBoundsDistance(source, target, aura);

  return measurePointSetDistance(sourcePoints, targetPoints);
}

function measureBoundsDistance(source, target, aura) {
  if (aura.from === "center" && aura.to === "center")
    return measureCenterDistance(source, target);
  if (aura.from === "center")
    return measurePointToBoundsDistance(source.center, target.bounds);
  if (aura.to === "center")
    return measurePointToBoundsDistance(target.center, source.bounds);
  return measureBoundsEdgeDistance(source, target);
}

function measureBoundsEdgeDistance(source, target) {
  const alphaDistance = measureAlphaEdgeDistance(source, target);
  if (Number.isFinite(alphaDistance)) return alphaDistance;

  const sourceBounds = source.bounds;
  const targetBounds = target.bounds;
  const dx = Math.max(
    sourceBounds.x - targetBounds.right,
    targetBounds.x - sourceBounds.right,
    0,
  );
  const dy = Math.max(
    sourceBounds.y - targetBounds.bottom,
    targetBounds.y - sourceBounds.bottom,
    0,
  );
  return Math.hypot(dx, dy);
}

function measurePointToBoundsDistance(point, bounds) {
  const dx = Math.max(bounds.x - point.x, point.x - bounds.right, 0);
  const dy = Math.max(bounds.y - point.y, point.y - bounds.bottom, 0);
  return Math.hypot(dx, dy);
}

function measureAlphaEdgeDistance(source, target) {
  const sourcePoints = getTokenAlphaEdgePoints(source);
  const targetPoints = getTokenAlphaEdgePoints(target);
  if (sourcePoints.length === 0 || targetPoints.length === 0) return Number.NaN;

  return measurePointSetDistance(sourcePoints, targetPoints);
}

function getMeasurementPoints(token, mode) {
  if (mode === "center") return [token.center];

  const alphaPoints = getTokenAlphaEdgePoints(token);
  if (alphaPoints.length > 0) return alphaPoints;
  return [];
}

function measurePointSetDistance(sourcePoints, targetPoints) {
  let minDistanceSquared = Infinity;
  for (const sourcePoint of sourcePoints) {
    for (const targetPoint of targetPoints) {
      const dx = sourcePoint.x - targetPoint.x;
      const dy = sourcePoint.y - targetPoint.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < minDistanceSquared)
        minDistanceSquared = distanceSquared;
    }
  }

  return Math.sqrt(minDistanceSquared);
}

function getTokenAlphaEdgePoints(token) {
  const displayObject = getTokenFilterTarget(token);
  const normalizedPoints = getTextureAlphaEdgePoints(displayObject);
  if (normalizedPoints.length === 0) return [];

  const mapper = getAlphaPointMapper(displayObject, token);
  return normalizedPoints.map(mapper);
}

function getAlphaPointMapper(displayObject, token) {
  const localBounds = displayObject?.getLocalBounds?.();
  const transform = displayObject?.worldTransform;
  const stageTransform = globalThis.canvas?.stage?.worldTransform;

  if (localBounds && transform?.apply && stageTransform?.applyInverse) {
    return (point) => {
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

function getTextureAlphaEdgePoints(displayObject) {
  const texture = displayObject?.texture;
  const source = getTextureSource(texture);
  if (!texture || !source) return [];

  const frame = getTextureFrame(texture, source);
  const cacheKey = getAlphaShapeCacheKey(texture, frame);
  if (alphaShapeCache.has(cacheKey)) return alphaShapeCache.get(cacheKey);

  const points = sampleTextureAlphaEdges(source, frame);
  alphaShapeCache.set(cacheKey, points);
  return points;
}

function getTextureSource(texture) {
  const source =
    texture?.source?.resource?.source ??
    texture?.source?.resource ??
    texture?.baseTexture?.resource?.source ??
    texture?.baseTexture?.resource ??
    null;

  return isCanvasImageSource(source) ? source : null;
}

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

function getAlphaEdgeSamplePoints(imageData) {
  const alphaThreshold = HIGHLIGHT_ALPHA_THRESHOLD * 255;
  const { data, width, height } = imageData;
  const opaquePixels = new Uint8Array(width * height);
  const points = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      opaquePixels[index] = data[index * 4 + 3] >= alphaThreshold ? 1 : 0;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (
        !opaquePixels[index] ||
        !isAlphaEdgePixel(opaquePixels, width, height, x, y)
      )
        continue;

      points.push({
        x: (x + 0.5) / width,
        y: (y + 0.5) / height,
      });
    }
  }

  return points;
}

function isAlphaEdgePixel(opaquePixels, width, height, x, y) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;

      const neighborX = x + dx;
      const neighborY = y + dy;
      if (
        neighborX < 0 ||
        neighborY < 0 ||
        neighborX >= width ||
        neighborY >= height
      )
        return true;
      if (!opaquePixels[neighborY * width + neighborX]) return true;
    }
  }

  return false;
}

function highlightToken(token, highlights) {
  const target = getTokenFilterTarget(token);
  const filters = highlights
    .map((aura) => createOutlineFilter(aura.color))
    .filter(Boolean);

  if (target && filters.length > 0) {
    applyHighlightFilters(target, filters);
    return;
  }

  drawFallbackTokenHighlights(getHighlightContainer(), token, highlights);
}

function getTokenFilterTarget(token) {
  return (
    token.mesh ??
    token.icon ??
    token.children?.find((child) => child.texture) ??
    null
  );
}

function applyHighlightFilters(target, filters) {
  removeHighlightFilters(target);

  for (const filter of filters) {
    filter[HIGHLIGHT_FILTER_MARKER] = true;
  }

  target.filters = [...(target.filters ?? []), ...filters];
  highlightedFilterTargets.add(target);
}

function removeHighlightFilters(target) {
  const filters = target.filters ?? [];
  const remainingFilters = filters.filter(
    (filter) => !filter?.[HIGHLIGHT_FILTER_MARKER],
  );
  target.filters = remainingFilters.length > 0 ? remainingFilters : null;
}

function createOutlineFilter(color) {
  const colorNumber = colorToNumber(color);
  const pixiOutlineFilter = globalThis.PIXI?.filters?.OutlineFilter;
  if (pixiOutlineFilter)
    return new pixiOutlineFilter(HIGHLIGHT_LINE_WIDTH, colorNumber, 0.2);

  const outlineOverlayFilter =
    globalThis.OutlineOverlayFilter ??
    globalThis.foundry?.canvas?.rendering?.filters?.OutlineOverlayFilter;
  if (outlineOverlayFilter?.create) {
    const filter = outlineOverlayFilter.create({
      outlineColor: colorToRgbArray(colorNumber),
      thickness: [HIGHLIGHT_LINE_WIDTH, HIGHLIGHT_LINE_WIDTH],
      alphaThreshold: HIGHLIGHT_ALPHA_THRESHOLD,
      knockout: false,
      wave: false,
    });
    filter.animate = false;
    filter.animated = false;
    return filter;
  }

  const alphaOutlineFilter = createAlphaOutlineFilter(colorNumber);
  if (alphaOutlineFilter) return alphaOutlineFilter;

  const glowOverlayFilter =
    globalThis.GlowOverlayFilter ??
    globalThis.foundry?.canvas?.rendering?.filters?.GlowOverlayFilter;
  if (glowOverlayFilter?.create) {
    const filter = glowOverlayFilter.create({
      glowColor: colorToRgbArray(colorNumber),
      distance: HIGHLIGHT_LINE_WIDTH,
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

function createAlphaOutlineFilter(color) {
  const uniforms = {
    outlineColor: colorToRgbArray(color),
    thickness: HIGHLIGHT_LINE_WIDTH,
    alphaThreshold: HIGHLIGHT_ALPHA_THRESHOLD,
  };
  const baseFilter =
    globalThis.foundry?.canvas?.rendering?.filters?.AbstractBaseFilter ??
    globalThis.PIXI?.Filter;
  if (!baseFilter) return null;

  try {
    const filter = new baseFilter(
      undefined,
      ALPHA_OUTLINE_FRAGMENT_SHADER,
      uniforms,
    );
    filter.padding = HIGHLIGHT_LINE_WIDTH;
    return filter;
  } catch (_error) {
    return null;
  }
}

function drawFallbackTokenHighlights(container, token, highlights) {
  highlights.forEach((aura, index) => {
    const bounds = token.bounds.clone().pad(index * HIGHLIGHT_RING_SPACING);
    const graphic = new PIXI.Graphics();

    graphic.lineStyle(HIGHLIGHT_LINE_WIDTH, colorToNumber(aura.color), 0.9);
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

function getPixelsPerSceneUnit() {
  const activeCanvas = globalThis.canvas;
  const gridSize =
    activeCanvas.grid?.size ?? activeCanvas.dimensions?.size ?? 100;
  const gridDistance =
    Number(
      activeCanvas.scene?.grid?.distance ??
        activeCanvas.dimensions?.distance ??
        1,
    ) || 1;
  return gridSize / gridDistance;
}

function colorToNumber(color) {
  const value = String(color).replace("#", "");
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : 0xff0000;
}

function colorToRgbArray(color) {
  return [
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255,
    1,
  ];
}

function activateAurasTab(root, group) {
  for (const tab of root.querySelectorAll(
    `.tab[data-group="${group}"], .tab[data-tab]`,
  )) {
    tab.classList.toggle("active", tab.dataset.tab === AURAS_TAB);
  }

  for (const item of root.querySelectorAll(
    `[data-group="${group}"][data-tab], .tabs [data-tab]`,
  )) {
    item.classList.toggle("active", item.dataset.tab === AURAS_TAB);
  }
}

function localize(path) {
  return game.i18n.localize(`BASIC_AURA_HIGHLIGHTING.${path}`);
}

function randomId() {
  return (
    globalThis.foundry?.utils?.randomID?.() ??
    Math.random().toString(36).slice(2)
  );
}

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
