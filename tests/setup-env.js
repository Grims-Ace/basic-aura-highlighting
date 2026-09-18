// =============================================================================
// =============================================================================
// Mock Foundry VTT and PIXI runtime environment for unit and benchmark tests.
// =============================================================================
// =============================================================================

// =============================================================================
// Constructors and Initializers: Mock globals initialization.
// =============================================================================

// Initialize minimal PIXI.js runtime mock classes
globalThis.PIXI = {
    Rectangle: class Rectangle {
        constructor(x = 0, y = 0, width = 0, height = 0) {
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
        }

        get right() {
            return this.x + this.width;
        }

        get bottom() {
            return this.y + this.height;
        }

        clone() {
            return new Rectangle(this.x, this.y, this.width, this.height);
        }

        pad(padding) {
            this.x -= padding;
            this.y -= padding;
            this.width += padding * 2;
            this.height += padding * 2;
            return this;
        }
    },
    Container: class Container {
        constructor() {
            this.children = [];
            this.name = "";
        }

        addChild(child) {
            this.children.push(child);
        }

        removeChildren() {
            const removed = this.children;
            this.children = [];
            return removed;
        }
    },
    Graphics: class Graphics {
        lineStyle() {
            return this;
        }

        drawRoundedRect() {
            return this;
        }

        destroy() {}
    },
};

// Initialize minimal Foundry VTT configuration and backend mocks
globalThis.CONFIG = {
    Canvas: {
        polygonBackends: {
            sight: {
                testCollision: () => false,
            },
        },
    },
};

// Initialize minimal Foundry VTT game and settings repository mocks
globalThis.game = {
    user: {
        isGM: true,
    },
    i18n: {
        localize: (key) => key,
    },
    settings: {
        get: (_moduleId, key) => (key === "thickness" ? 4 : true),
        register: () => {},
    },
};

// Initialize minimal Foundry VTT utility functions
globalThis.foundry = {
    utils: {
        getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj),
        setProperty: (obj, path, value) => {
            const keys = path.split(".");
            const last = keys.pop();
            const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
            target[last] = value;
        },
        randomID: () => Math.random().toString(36).slice(2),
    },
};

// Initialize minimal Foundry VTT event hooks dispatcher mock
globalThis.Hooks = {
    once: () => {},
    on: () => {},
};

// Initialize minimal Foundry VTT canvas mock
globalThis.canvas = {
    ready: true,
    grid: { size: 100 },
    dimensions: { distance: 5, size: 100 },
    scene: { grid: { distance: 5 } },
    stage: {
        worldTransform: {
            apply: (p) => p,
            applyInverse: (p) => p,
        },
    },
    tokens: {
        placeables: [],
        controlled: [],
        quadtree: null,
    },
};
