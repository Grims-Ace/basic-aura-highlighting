// =============================================================================
// =============================================================================
// Texture alpha boundary extraction, coordinate transforms, and decimation.
// =============================================================================
// =============================================================================

import {
    MODULE_ID,
    HIGHLIGHT_ALPHA_THRESHOLD,
    ALPHA_SAMPLE_SIZE,
    MAX_ALPHA_EDGE_POINTS,
    MAX_CACHE_ENTRIES,
} from "../constants.js";

// =============================================================================
// Internal State Fields: Encapsulated shape cache for texture geometry.
// =============================================================================

const _alphaShapeCache = new Map();

// =============================================================================
// Public Accessors: Cache management and display object queries.
// =============================================================================

// Clear the texture alpha shape cache when canvas state is invalidated.
export function clearAlphaShapeCache() {
    _alphaShapeCache.clear();
}

// Locate the display object mesh or icon for a token.
export function getTokenFilterTarget(token) {
    return token.mesh ?? token.icon ?? token.children?.find((child) => child.texture) ?? null;
}

// =============================================================================
// Primary Operations: Texture edge point extraction and coordinate mapping.
// =============================================================================

// Extract canvas world coordinates along the visible boundary of a token texture.
export function getTokenAlphaEdgePoints(token) {
    const displayObject = getTokenFilterTarget(token);
    const normalizedPoints = getTextureAlphaEdgePoints(displayObject);
    if (normalizedPoints.length === 0) return [];

    const mapper = getAlphaPointMapper(displayObject, token);
    return normalizedPoints.map(mapper);
}

// =============================================================================
// Helper Functions: Alpha sampling, transform math, and geometry decimation.
// =============================================================================

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
