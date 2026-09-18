// =============================================================================
// =============================================================================
// 2D/3D Euclidean math, bounding-box tests, and sight collision checks.
// =============================================================================
// =============================================================================

import { getTokenAlphaEdgePoints } from "./sampling.js";

// =============================================================================
// Primary Operations: Collision tests and distance measurement routines.
// =============================================================================

// Determine whether a target token is within range and line-of-sight of an aura.
export function isTokenInAuraCached(source, target, aura, sourceData, targetData, dz2, rangePixels2) {
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

// Measure the squared distance between tokens according to configured aura modes.
export function measureAuraDistanceSquared(source, target, aura, sourceData, targetData) {
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

// Calculate the shortest squared Euclidean distance between two rectangles.
export function measureBoundsGapSquared(sourceBounds, targetBounds) {
    const dx = Math.max(sourceBounds.x - targetBounds.right, targetBounds.x - sourceBounds.right, 0);
    const dy = Math.max(sourceBounds.y - targetBounds.bottom, targetBounds.y - sourceBounds.bottom, 0);
    return dx * dx + dy * dy; // Distance squared calculation
}

// =============================================================================
// Helper Functions: Coordinate comparisons and point set distance math.
// =============================================================================

// Calculate the squared Euclidean distance between two token centers.
function measureCenterDistance2(sourceData, targetData) {
    const dx = sourceData.center.x - targetData.center.x;
    const dy = sourceData.center.y - targetData.center.y;
    return dx * dx + dy * dy; // Distance squared calculation
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
