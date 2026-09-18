// =============================================================================
// =============================================================================
// Token configuration sheet tab injection, markup generation, and DOM events.
// =============================================================================
// =============================================================================

import { AURAS_TAB, AURAS_FLAG_PATH } from "../constants.js";
import { escapeHtml, localize } from "../utils.js";
import {
    getSavedAuras,
    normalizeAuras,
    normalizeMeasurementMode,
    createDefaultAura,
    defaultAuraName,
} from "../models/aura.js";

// =============================================================================
// Primary Operations: Sheet tab injection, control bindings, and row rendering.
// =============================================================================

// Inject the Auras management tab into the token configuration sheet.
export function injectAurasTab(app, element) {
    const root = getRootElement(element);
    if (!root || root.querySelector(`[data-tab="${AURAS_TAB}"]`)) return;

    const tabsNav = findTabsNav(root);
    const existingTab = findExistingTab(root, tabsNav);
    if (!tabsNav || !existingTab) {
        console.warn("basic_aura_highlighting | Could not find token config tabs to add Auras tab.");
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
export function activateAurasControls(root, group, panel) {
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

// Populate the HTML panel with rendered aura item rows.
export function renderAuras(panel, auras) {
    const normalizedAuras = normalizeAuras(auras);
    const list = panel.querySelector("[data-auras-list]");
    const empty = panel.querySelector("[data-empty]");
    if (!list || !empty) return;

    list.innerHTML = normalizedAuras.map((aura, index) => renderAura(aura, index)).join("");
    empty.hidden = normalizedAuras.length > 0;
    syncAurasField(panel);
}

// =============================================================================
// Helper Functions: Event handling, markup generation, and DOM queries.
// =============================================================================

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
