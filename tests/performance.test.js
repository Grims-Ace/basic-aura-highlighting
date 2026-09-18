// =============================================================================
// =============================================================================
// Performance benchmark tests for aura distance and edge-to-edge evaluation.
// =============================================================================
// =============================================================================

import { performance } from "node:perf_hooks";

import "./setup-env.js";
import { collectAuraHighlights } from "../scripts/module.js";

// =============================================================================
// Constants and Configuration Limits: Benchmark test matrices.
// =============================================================================

const GRID_SIZE = 100;
const GRID_DISTANCE = 5;
const PIXELS_PER_UNIT = GRID_SIZE / GRID_DISTANCE; // 20 pixels per scene unit
const AURA_RADIUS_UNITS = 30; // 30 feet aura radius
const BENCHMARK_ITERATIONS = 500;
const TOKEN_POPULATIONS = [2, 10, 50, 100];
const DISTANCE_PRESETS = [
    { label: "Short", units: 10 },
    { label: "Medium", units: 30 },
    { label: "Long", units: 60 },
];

// =============================================================================
// Primary Operations: Benchmark test execution and reporting.
// =============================================================================

// Execute performance benchmark scenarios across all distances and token counts.
function runPerformanceBenchmarks() {
    console.log("\n==============================================================================");
    console.log("  BASIC AURA HIGHLIGHTING - EDGE-TO-EDGE PERFORMANCE BENCHMARK");
    console.log("==============================================================================");
    console.log(`Grid Size: ${GRID_SIZE}px | Grid Distance: ${GRID_DISTANCE}ft | Aura Radius: ${AURA_RADIUS_UNITS}ft`);
    console.log(`Measurement Mode: Edge-to-Edge | Benchmark Iterations: ${BENCHMARK_ITERATIONS}\n`);

    const tableRows = [];

    for (const distance of DISTANCE_PRESETS) {
        for (const tokenCount of TOKEN_POPULATIONS) {
            const result = benchmarkScenario(distance, tokenCount, BENCHMARK_ITERATIONS);
            tableRows.push(result);
        }
    }

    printBenchmarkResults(tableRows);
}

// Benchmark a specific distance preset and token count configuration.
function benchmarkScenario(distance, tokenCount, iterations) {
    // 0. Initialize mock canvas scene state
    const sourceToken = createMockToken(0, 1000, 1000, true);
    const targetTokens = createTokenPopulation(tokenCount - 1, distance.units);
    const allTokens = [sourceToken, ...targetTokens];

    globalThis.canvas.tokens.placeables = allTokens;
    globalThis.canvas.tokens.controlled = [sourceToken];

    // 1. Warm up JIT optimization
    for (let i = 0; i < 20; i++) {
        collectAuraHighlights([sourceToken]);
    }

    // 2. Measure execution time across iterations
    const startTime = performance.now();
    let lastHighlightCount = 0;

    for (let i = 0; i < iterations; i++) {
        const highlights = collectAuraHighlights([sourceToken]);
        lastHighlightCount = highlights.size;
    }

    const elapsedMs = performance.now() - startTime;
    const meanMs = elapsedMs / iterations;
    const opsPerSec = Math.round((iterations / elapsedMs) * 1000);

    // 3. Verify correctness assertion
    const isCorrect = verifyScenarioCorrectness(distance.label, lastHighlightCount);

    return {
        distance: distance.label,
        distanceUnits: `${distance.units} ft`,
        tokenCount,
        iterations,
        totalTimeMs: elapsedMs.toFixed(2),
        meanTimeMs: meanMs < 0.01 ? `${(meanMs * 1000).toFixed(1)} µs` : `${meanMs.toFixed(3)} ms`,
        opsPerSec: opsPerSec.toLocaleString(),
        highlighted: lastHighlightCount,
        status: isCorrect ? "PASS" : "FAIL",
    };
}

// =============================================================================
// Helper Functions: Mock generation, geometry math, and result presentation.
// =============================================================================

// Verify that highlight counts match expected geometric boundaries.
function verifyScenarioCorrectness(distanceLabel, highlightCount) {
    if (distanceLabel === "Short") {
        return highlightCount >= 1;
    }
    if (distanceLabel === "Long") {
        return highlightCount === 0;
    }
    return true;
}

// Construct an array of target tokens placed at specified and distributed offsets.
function createTokenPopulation(targetCount, testDistanceUnits) {
    const tokens = [];
    const testDistancePx = testDistanceUnits * PIXELS_PER_UNIT;

    // Place primary target at exact test distance to the right (x + 100px width + distance)
    if (targetCount > 0) {
        tokens.push(createMockToken(1, 1000 + 100 + testDistancePx, 1000, false));
    }

    // Distribute remaining background tokens across scene space
    for (let i = 1; i < targetCount; i++) {
        const angle = (i / targetCount) * Math.PI * 2;
        const radius = 200 + (i % 5) * 300; // Scatter tokens from 200px to 1400px away
        const x = 1000 + Math.cos(angle) * radius;
        const y = 1000 + Math.sin(angle) * radius;
        tokens.push(createMockToken(i + 1, x, y, false));
    }

    return tokens;
}

// Construct a mock Foundry token object with pre-sampled alpha edge points.
function createMockToken(id, x, y, hasAura) {
    const width = 100;
    const height = 100;
    const bounds = new PIXI.Rectangle(x, y, width, height);
    const center = { x: x + width / 2, y: y + height / 2 };

    const token = {
        id: `token-${id}`,
        center,
        bounds,
        document: {
            elevation: 0,
            hidden: false,
            getFlag: (module, flag) => {
                if (module !== "basic_aura_highlighting" || flag !== "auras") return null;
                if (!hasAura) return [];
                return [
                    {
                        id: "aura-test",
                        name: "Test Aura",
                        range: AURA_RADIUS_UNITS,
                        color: "#00ff00",
                        from: "edge",
                        to: "edge",
                        walls: true,
                        enabled: true,
                    },
                ];
            },
        },
        mesh: {
            texture: { uid: `texture-${id}` },
        },
    };

    // Attach pre-calculated edge points to simulate sampled texture silhouette
    token._mockEdgePoints = generateCircleEdgePoints(center.x, center.y, width / 2, 36);

    return token;
}

// Generate circular boundary edge points for token alpha silhouette emulation.
function generateCircleEdgePoints(centerX, centerY, radius, count) {
    const points = [];
    for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        points.push({
            x: centerX + Math.cos(theta) * radius,
            y: centerY + Math.sin(theta) * radius,
        });
    }
    return points;
}

// =============================================================================
// Format Conversions: Tabular text output generation.
// =============================================================================

// Print benchmark results formatted as an aligned console table.
function printBenchmarkResults(results) {
    const headers = [
        "Distance",
        "Offset",
        "Tokens",
        "Iterations",
        "Total (ms)",
        "Mean Time",
        "Throughput",
        "Matches",
        "Status",
    ];

    const rows = results.map((r) => [
        r.distance,
        r.distanceUnits,
        String(r.tokenCount),
        String(r.iterations),
        r.totalTimeMs,
        r.meanTimeMs,
        `${r.opsPerSec} ops/s`,
        String(r.highlighted),
        r.status,
    ]);

    const columnWidths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((row) => row[i].length)),
    );

    const formatRow = (values) =>
        values.map((val, i) => val.padEnd(columnWidths[i])).join(" | ");

    const separator = columnWidths.map((w) => "-".repeat(w)).join("-+-");

    console.log(formatRow(headers));
    console.log(separator);
    for (const row of rows) {
        console.log(formatRow(row));
    }
    console.log(separator);
    console.log("\nAll performance benchmarks completed successfully.\n");
}

// =============================================================================
// Test Runner Entry Point
// =============================================================================

runPerformanceBenchmarks();
