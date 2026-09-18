// =============================================================================
// =============================================================================
// Foundry VTT macro: Live canvas measurement accuracy verification.
// =============================================================================
// =============================================================================

// =============================================================================
// Primary Operations: Live token pair accuracy comparison.
// =============================================================================

// Verify measured aura distance between two selected tokens against Foundry grid ray distance.
function testSelectedTokensAccuracy() {
    const controlled = canvas.tokens?.controlled ?? [];
    if (controlled.length < 2) {
        ui.notifications.warn("Basic Aura Highlighting | Please select 2 tokens to compare distance accuracy.");
        return;
    }

    const tokenA = controlled[0];
    const tokenB = controlled[1];

    // Compute Foundry native center ray distance
    const ray = new Ray(tokenA.center, tokenB.center);
    const foundryDistance = canvas.grid.measureDistances([{ ray }], { gridSpaces: false })[0];

    // Compute pixel Euclidean distance
    const dx = tokenA.center.x - tokenB.center.x;
    const dy = tokenA.center.y - tokenB.center.y;
    const pixelsPerUnit = (canvas.grid.size ?? 100) / (canvas.scene.grid.distance ?? 5);
    const euclideanDistanceUnits = Math.sqrt(dx * dx + dy * dy) / pixelsPerUnit;

    console.log("==============================================================================");
    console.log("  BASIC AURA HIGHLIGHTING - LIVE ACCURACY COMPARISON");
    console.log("==============================================================================");
    console.log(`Token A: "${tokenA.name}" | Token B: "${tokenB.name}"`);
    console.log(`Foundry Center Ray Distance:   ${foundryDistance.toFixed(3)} scene units`);
    console.log(`Euclidean Center-to-Center:     ${euclideanDistanceUnits.toFixed(3)} scene units`);

    ui.notifications.info(
        `Distance: Ray ${foundryDistance.toFixed(2)} units | Euclidean ${euclideanDistanceUnits.toFixed(2)} units`,
    );
}

testSelectedTokensAccuracy();
