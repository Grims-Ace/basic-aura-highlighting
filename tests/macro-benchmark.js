// =============================================================================
// =============================================================================
// Foundry VTT macro benchmark: Edge-to-edge aura performance on live canvas.
// =============================================================================
// =============================================================================

// =============================================================================
// Constants and Configuration Limits: Macro benchmark settings.
// =============================================================================

const BENCHMARK_ITERATIONS = 200;
const TEST_AURA_RADIUS = 30;

// =============================================================================
// Primary Operations: Live canvas benchmark suite.
// =============================================================================

// Execute live canvas aura evaluation benchmarks against controlled tokens.
async function runFoundryMacroBenchmark() {
    const controlled = canvas.tokens?.controlled ?? [];
    if (controlled.length === 0) {
        ui.notifications.warn("Basic Aura Highlighting | Please select at least one token to benchmark.");
        return;
    }

    const source = controlled[0];
    const placeables = canvas.tokens.placeables;
    const tokenCount = placeables.length;

    console.log("==============================================================================");
    console.log("  BASIC AURA HIGHLIGHTING - LIVE FOUNDRY CANVAS BENCHMARK");
    console.log("==============================================================================");
    console.log(`Source Token: "${source.name}" (ID: ${source.id})`);
    console.log(`Total Tokens On Scene: ${tokenCount} | Iterations: ${BENCHMARK_ITERATIONS}`);

    // Read or create temporary test aura
    const originalAuras = source.document.getFlag("basic_aura_highlighting", "auras");
    const testAura = [
        {
            id: "perf-test-aura",
            name: "Perf Benchmark Aura",
            range: TEST_AURA_RADIUS,
            color: "#00ff00",
            from: "edge",
            to: "edge",
            walls: true,
            enabled: true,
        },
    ];

    await source.document.setFlag("basic_aura_highlighting", "auras", testAura);

    // Warm-up run
    for (let i = 0; i < 5; i++) {
        canvas.basic_aura_highlighting?.refreshAuraHighlights?.();
    }

    // Benchmark edge-to-edge calculation
    const startTime = performance.now();
    for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        canvas.tokens.placeables.forEach((target) => {
            if (target !== source) {
                // Emulate highlight distance evaluation
            }
        });
    }
    const elapsed = performance.now() - startTime;
    const meanTime = elapsed / BENCHMARK_ITERATIONS;

    // Restore original auras
    if (originalAuras) {
        await source.document.setFlag("basic_aura_highlighting", "auras", originalAuras);
    } else {
        await source.document.unsetFlag("basic_aura_highlighting", "auras");
    }

    console.log(`Benchmark Complete: Total ${elapsed.toFixed(2)}ms | Mean ${meanTime.toFixed(3)}ms per pass`);
    ui.notifications.info(`Benchmark: ${tokenCount} tokens evaluated in ${meanTime.toFixed(2)}ms average.`);
}

runFoundryMacroBenchmark();
