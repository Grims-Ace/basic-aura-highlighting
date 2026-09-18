// =============================================================================
// =============================================================================
// Immutable thresholds, identifiers, limits, and WebGL shader code.
// =============================================================================
// =============================================================================

// =============================================================================
// Constants and Configuration Limits: Immutable values and shader code.
// =============================================================================

export const MODULE_ID = "basic_aura_highlighting";
export const AURAS_TAB = "basic-aura-highlighting-auras";
export const AURAS_FLAG_PATH = `flags.${MODULE_ID}.auras`;
export const HIGHLIGHT_CONTAINER_NAME = `${MODULE_ID}.highlights`;
export const HIGHLIGHT_RING_SPACING = 5;
export const HIGHLIGHT_ALPHA_THRESHOLD = 0.2;
export const ALPHA_SAMPLE_SIZE = 48;
export const MAX_ALPHA_EDGE_POINTS = 36;
export const MAX_CACHE_ENTRIES = 128;
export const HIGHLIGHT_FILTER_MARKER = Symbol(MODULE_ID);
export const THICKNESS_SETTING = "thickness";
export const REFRESH_DURING_MOVE_SETTING = "refreshDuringMove";

// WebGL fragment shader to generate outline highlights around opaque texture pixels.
export const ALPHA_OUTLINE_FRAGMENT_SHADER = `
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
