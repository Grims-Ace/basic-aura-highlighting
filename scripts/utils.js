// =============================================================================
// =============================================================================
// Format conversions, color utilities, HTML escaping, and scene unit queries.
// =============================================================================
// =============================================================================

import { MODULE_ID, THICKNESS_SETTING } from "./constants.js";

// =============================================================================
// Public Accessors: Configuration getters and scene metric queries.
// =============================================================================

// Retrieve the highlight outline thickness configured in module settings.
export function getHighlightThickness() {
    return game.settings.get(MODULE_ID, THICKNESS_SETTING) ?? 4;
}

// Compute the pixel conversion factor for current scene distance units.
export function getPixelsPerSceneUnit() {
    const activeCanvas = globalThis.canvas;
    const gridSize = activeCanvas.grid?.size ?? activeCanvas.dimensions?.size ?? 100;
    const gridDistance = Number(activeCanvas.scene?.grid?.distance ?? activeCanvas.dimensions?.distance ?? 1) || 1;
    return gridSize / gridDistance;
}

// Localize an internationalization string key for the module.
export function localize(path) {
    return game.i18n.localize(`BASIC_AURA_HIGHLIGHTING.${path}`);
}

// Generate a random unique identifier string.
export function randomId() {
    return globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2);
}

// =============================================================================
// Format Conversions: Data sanitization and color transformations.
// =============================================================================

// Convert a hex color string or number to an integer color value.
export function colorToNumber(color) {
    const value = String(color).replace("#", "");
    const parsed = Number.parseInt(value, 16);
    return Number.isFinite(parsed) ? parsed : 0xff0000;
}

// Convert a numeric hex color value to a normalized RGBA array [r, g, b, a].
export function colorToRgbArray(color) {
    return [
        ((color >> 16) & 0xff) / 255,
        ((color >> 8) & 0xff) / 255,
        (color & 0xff) / 255,
        1,
    ];
}

// Escape HTML special characters to prevent cross-site scripting in markup.
export function escapeHtml(value) {
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
