// =============================================================================
// =============================================================================
// Accuracy test suite verifying 2D and 3D aura measurement modes.
// =============================================================================
// =============================================================================

import "./setup-env.js";
import {
    measureAuraDistanceSquared,
    isTokenInAuraCached,
} from "../scripts/geometry/distance.js";
import { getCachedTokenData } from "../scripts/module.js";

// =============================================================================
// Constants and Configuration Limits: Test parameters and epsilon tolerances.
// =============================================================================

const EPSILON = 1e-5;
const TEST_TRIALS_PER_MODE = 100;
const CANVAS_BOUNDS = { minX: 100, maxX: 2500, minY: 100, maxY: 2500 };
const TOKEN_SIZES = [100, 200, 300]; // 1x1, 2x2, 3x3 grid unit sizes
const TOKEN_SHAPES = ["circle", "square", "ellipse", "star"];
const MEASUREMENT_MODES = [
    { from: "edge", to: "edge", label: "Edge-to-Edge" },
    { from: "edge", to: "center", label: "Edge-to-Center" },
    { from: "center", to: "edge", label: "Center-to-Edge" },
    { from: "center", to: "center", label: "Center-to-Center" },
];

// =============================================================================
// Primary Operations: Accuracy test runner and assertion verification.
// =============================================================================

// Execute accuracy trials across all four measurement permutations.
function runAccuracyTests() {
    console.log("\n==============================================================================");
    console.log("  BASIC AURA HIGHLIGHTING - MEASUREMENT ACCURACY TEST SUITE");
    console.log("==============================================================================");
    console.log(`Trials Per Mode: ${TEST_TRIALS_PER_MODE} | Floating-Point Tolerance: ${EPSILON}\n`);

    let totalTests = 0;
    let totalPasses = 0;
    let maxObservedError = 0;

    for (const mode of MEASUREMENT_MODES) {
        let modePasses = 0;
        let modeMaxError = 0;

        for (let i = 0; i < TEST_TRIALS_PER_MODE; i++) {
            const result = executeSingleTrial(mode.from, mode.to, i);
            totalTests += 1;

            if (result.passed) {
                totalPasses += 1;
                modePasses += 1;
            }

            if (result.errorDelta > modeMaxError) modeMaxError = result.errorDelta;
            if (result.errorDelta > maxObservedError) maxObservedError = result.errorDelta;
        }

        console.log(
            `[${mode.label.padEnd(16)}] Passed: ${String(modePasses).padStart(3)}/${TEST_TRIALS_PER_MODE} | ` +
            `Max Error: ${modeMaxError.toExponential(2)}px | Status: ${modePasses === TEST_TRIALS_PER_MODE ? "PASS" : "FAIL"}`
        );
    }

    console.log("\n------------------------------------------------------------------------------");
    console.log(`Summary: ${totalPasses}/${totalTests} tests passed. Max error delta: ${maxObservedError.toExponential(2)}px.`);
    console.log("------------------------------------------------------------------------------\n");

    if (totalPasses !== totalTests) {
        process.exit(1);
    }
}

// Execute a single randomized measurement trial between two simulated tokens.
function executeSingleTrial(fromMode, toMode, seed) {
    const pixelsPerUnit = 20; // 100px per 5ft grid
    const tokenCache = new Map();

    // 0. Generate randomized source and target tokens with random shapes and sizes
    const sourceShape = TOKEN_SHAPES[seed % TOKEN_SHAPES.length];
    const targetShape = TOKEN_SHAPES[(seed + 1) % TOKEN_SHAPES.length];
    const sourceSize = TOKEN_SIZES[seed % TOKEN_SIZES.length];
    const targetSize = TOKEN_SIZES[(seed + 2) % TOKEN_SIZES.length];

    const source = createRandomToken("source", sourceShape, sourceSize);
    const target = createRandomToken("target", targetShape, targetSize);

    const sourceData = getCachedTokenData(source, tokenCache, pixelsPerUnit);
    const targetData = getCachedTokenData(target, tokenCache, pixelsPerUnit);

    const aura = {
        from: fromMode,
        to: toMode,
        range: 25,
        walls: false,
        enabled: true,
    };

    // 1. Compute ground truth distance from analytical geometry points
    const sourcePoints = fromMode === "center" ? [sourceData.center] : source._mockEdgePoints;
    const targetPoints = toMode === "center" ? [targetData.center] : target._mockEdgePoints;
    const expectedDistance2D = computeAnalyticalDistance(sourcePoints, targetPoints);

    // 2. Compute module measured distance
    const measuredDistanceSquared = measureAuraDistanceSquared(source, target, aura, sourceData, targetData);
    const measuredDistance2D = Math.sqrt(measuredDistanceSquared);

    const errorDelta = Math.abs(measuredDistance2D - expectedDistance2D);
    const isDistanceAccurate = errorDelta <= EPSILON;

    // 3. Verify 3D Euclidean inclusion logic with elevation
    const dz = Math.abs(sourceData.elevation - targetData.elevation);
    const dz2 = dz * dz;
    const distance3D = Math.sqrt(measuredDistanceSquared + dz2);
    const rangePixels = aura.range * pixelsPerUnit;
    const rangePixels2 = rangePixels * rangePixels;

    const expectedInAura = distance3D <= rangePixels;
    const actualInAura = isTokenInAuraCached(source, target, aura, sourceData, targetData, dz2, rangePixels2);
    const isInclusionAccurate = actualInAura === expectedInAura;

    return {
        passed: isDistanceAccurate && isInclusionAccurate,
        errorDelta,
    };
}

// =============================================================================
// Helper Functions: Random token creation, shape math, and geometry calculations.
// =============================================================================

// Compute shortest Euclidean distance between two sets of 2D points.
function computeAnalyticalDistance(pointsA, pointsB) {
    let minDistance = Infinity;

    for (let i = 0; i < pointsA.length; i++) {
        const pA = pointsA[i];
        for (let j = 0; j < pointsB.length; j++) {
            const pB = pointsB[j];
            const dx = pA.x - pB.x;
            const dy = pA.y - pB.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDistance) minDistance = dist;
        }
    }

    return minDistance;
}

// Construct a mock token with random coordinates, elevation, and boundary geometry.
function createRandomToken(id, shape, size) {
    const x = getRandomInRange(CANVAS_BOUNDS.minX, CANVAS_BOUNDS.maxX);
    const y = getRandomInRange(CANVAS_BOUNDS.minY, CANVAS_BOUNDS.maxY);
    const elevationUnits = getRandomInRange(0, 30);
    const bounds = new PIXI.Rectangle(x, y, size, size);
    const center = { x: x + size / 2, y: y + size / 2 };

    const token = {
        id: `token-${id}-${Math.random()}`,
        center,
        bounds,
        document: {
            elevation: elevationUnits,
            hidden: false,
            getFlag: () => [],
        },
        mesh: {
            texture: { uid: `tex-${id}` },
        },
    };

    token._mockEdgePoints = generateShapePoints(center.x, center.y, size / 2, shape, 36);
    return token;
}

// Generate boundary points for specified parametric 2D shapes.
function generateShapePoints(cx, cy, halfSize, shape, pointCount) {
    const points = [];

    if (shape === "circle") {
        for (let i = 0; i < pointCount; i++) {
            const angle = (i / pointCount) * Math.PI * 2;
            points.push({
                x: cx + Math.cos(angle) * halfSize,
                y: cy + Math.sin(angle) * halfSize,
            });
        }
        return points;
    }

    if (shape === "square") {
        const pointsPerSide = Math.floor(pointCount / 4);
        const left = cx - halfSize;
        const right = cx + halfSize;
        const top = cy - halfSize;
        const bottom = cy + halfSize;

        for (let i = 0; i < pointsPerSide; i++) {
            const t = i / pointsPerSide;
            points.push({ x: left + (right - left) * t, y: top }); // Top
            points.push({ x: right, y: top + (bottom - top) * t }); // Right
            points.push({ x: right - (right - left) * t, y: bottom }); // Bottom
            points.push({ x: left, y: bottom - (bottom - top) * t }); // Left
        }
        return points;
    }

    if (shape === "ellipse") {
        const radiusX = halfSize;
        const radiusY = halfSize * 0.6;
        for (let i = 0; i < pointCount; i++) {
            const angle = (i / pointCount) * Math.PI * 2;
            points.push({
                x: cx + Math.cos(angle) * radiusX,
                y: cy + Math.sin(angle) * radiusY,
            });
        }
        return points;
    }

    if (shape === "star") {
        for (let i = 0; i < pointCount; i++) {
            const angle = (i / pointCount) * Math.PI * 2;
            const radius = (i % 2 === 0) ? halfSize : halfSize * 0.5;
            points.push({
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius,
            });
        }
        return points;
    }

    return points;
}

// Generate a random float within a specified range.
function getRandomInRange(min, max) {
    return min + Math.random() * (max - min);
}

// =============================================================================
// Test Runner Entry Point
// =============================================================================

runAccuracyTests();
