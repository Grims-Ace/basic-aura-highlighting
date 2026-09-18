// =============================================================================
// =============================================================================
// Aura data contract, normalization, defaults, and flag persistence.
// =============================================================================
// =============================================================================

import { MODULE_ID } from "../constants.js";
import { localize, randomId } from "../utils.js";

// =============================================================================
// Public Accessors: Aura document queries and factory routines.
// =============================================================================

// Retrieve and normalize all aura definitions configured on a token.
export function getTokenAuras(token) {
    return normalizeAuras(parseAuras(token.document?.getFlag?.(MODULE_ID, "auras")));
}

// Read stored aura definitions from token or prototype actor documents.
export function getSavedAuras(app) {
    const doc = app.document ?? app.object ?? app.token ?? app.actor?.prototypeToken;
    return normalizeAuras(parseAuras(doc?.getFlag?.(MODULE_ID, "auras")));
}

// =============================================================================
// Constructors and Initializers: Aura object construction routines.
// =============================================================================

// Construct a new aura object populated with default values.
export function createDefaultAura(index) {
    return {
        ...normalizeAura(),
        name: defaultAuraName(index),
    };
}

// Generate the fallback display name for an aura by its list index.
export function defaultAuraName(index) {
    return `${localize("tabs.auras")} ${index + 1}`;
}

// =============================================================================
// Helper Functions: Validation and measurement normalization.
// =============================================================================

// Constrain measurement mode input to valid center or edge values.
export function normalizeMeasurementMode(value) {
    return value === "center" ? "center" : "edge";
}

// =============================================================================
// Format Conversions: Normalization and persistence transformations.
// =============================================================================

// Standardize aura object structure with fallback values for missing fields.
export function normalizeAura(aura = {}) {
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
export function normalizeAuras(auras) {
    return auras.map((aura, index) => {
        const normalized = normalizeAura(aura);
        if (!normalized.name) normalized.name = defaultAuraName(index);
        return normalized;
    });
}

// Normalize aura data in update delta payloads before database persistence.
export function parseAurasInChanges(changes, path) {
    const value = foundry.utils.getProperty(changes, path);
    if (typeof value !== "string") return;
    foundry.utils.setProperty(changes, path, normalizeAuras(parseAuras(value)));
}

// Parse raw aura definitions from JSON string or return existing arrays.
export function parseAuras(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}
