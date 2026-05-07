const MODULE_ID = "basic_aura_highlighting";
const AURA_TAB = "basic-aura-highlighting-aura";

Hooks.on("renderTokenConfig", injectAuraTab);
Hooks.on("renderPrototypeTokenConfig", injectAuraTab);

function injectAuraTab(app, element) {
  const root = getRootElement(element);
  if (!root || root.querySelector(`[data-tab="${AURA_TAB}"]`)) return;

  const tabsNav = findTabsNav(root);
  const existingTab = findExistingTab(root, tabsNav);
  if (!tabsNav || !existingTab) {
    console.warn(`${MODULE_ID} | Could not find token config tabs to add Aura tab.`);
    return;
  }

  const group = tabsNav.dataset.group || existingTab.dataset.group || "sheet";
  const auraTabButton = createAuraTabButton(group);
  tabsNav.append(auraTabButton);

  const auraPanel = createAuraTabPanel(group);
  existingTab.after(auraPanel);

  auraTabButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activateAuraTab(root, group);
  });
}

function getRootElement(element) {
  if (element instanceof HTMLElement) return element;
  if (element?.[0] instanceof HTMLElement) return element[0];
  return null;
}

function findTabsNav(root) {
  return root.querySelector(`nav.tabs[data-group], .tabs[data-group], nav.tabs, .tabs`);
}

function findExistingTab(root, tabsNav) {
  const group = tabsNav?.dataset.group;
  const selector = group ? `.tab[data-group="${group}"][data-tab]` : `.tab[data-tab]`;
  return root.querySelector(selector) || root.querySelector(`.tab[data-tab]`);
}

function createAuraTabButton(group) {
  const button = document.createElement("a");
  button.classList.add("item");
  button.dataset.tab = AURA_TAB;
  button.dataset.group = group;
  button.dataset.action = "tab";
  button.innerHTML = `<i class="fa-solid fa-bullseye"></i> ${game.i18n.localize("BASIC_AURA_HIGHLIGHTING.tabs.aura")}`;
  return button;
}

function createAuraTabPanel(group) {
  const panel = document.createElement("section");
  panel.classList.add("tab");
  panel.dataset.tab = AURA_TAB;
  panel.dataset.group = group;
  panel.innerHTML = `
    <div class="form-group">
      <p class="hint">${game.i18n.localize("BASIC_AURA_HIGHLIGHTING.tabs.auraHint")}</p>
    </div>
  `;
  return panel;
}

function activateAuraTab(root, group) {
  for (const tab of root.querySelectorAll(`.tab[data-group="${group}"], .tab[data-tab]`)) {
    tab.classList.toggle("active", tab.dataset.tab === AURA_TAB);
  }

  for (const item of root.querySelectorAll(`[data-group="${group}"][data-tab], .tabs [data-tab]`)) {
    item.classList.toggle("active", item.dataset.tab === AURA_TAB);
  }
}
