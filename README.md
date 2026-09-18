# Basic Aura Highlighting

**Basic Aura Highlighting** is a Foundry VTT module that highlights tokens whenever they enter an active "aura" emitted by a token with a configured aura. Highlights and distances are made to respect transparency so distance is measured only from visible pixels and highlights are only applied around visible pixels. 

---

## Configuration & Settings

### Configure Settings Menu (`Game Settings -> Configure Settings`)

Under **Basic Aura Highlighting**:

- **Highlight Thickness (`1–100 px`, Default: `4`)**: Controls the pixel width of the outline highlight applied around target tokens.
- **Refresh During Movement (`Checkbox`, Default: `Enabled`)**: When enabled, recalculates and updates aura highlights in real time on every animation frame as tokens move. When disabled, highlights only refresh once token movement ends for performance reasons.

---

### Token Configuration Window (`Auras` Tab in the Token Configureation Menu)

Open any Token Configuration sheet (or Prototype Token sheet on an Actor) to find the **Auras** tab (`bullseye` icon). Each token can host any number of auras with the following settings:

- **Enabled**: Toggle an individual aura on or off.
- **Aura Name**: Label for the aura (e.g., *Paladin's Aura of Protection*, *Spirit Guardians*).
- **Aura Radius (Scene Units)**: The reach of the aura expressed in the current scene's distance units (feet, meters, miles, etc.).
- **Highlight Color**: Color of the highlight that the aura will apply.
- **From (Source Measurement Anchor)**:
  - `Edge`: Measures starting distance from the visible boundary (alpha edge) of the source token's artwork.
  - `Center`: Measures starting distance from the exact geometric center coordinate of the source token.
- **To (Target Measurement Anchor)**:
  - `Edge`: Measures target arrival at the visible boundary (alpha edge) of the target token's artwork.
  - `Center`: Measures target arrival at the geometric center coordinate of the target token.
- **Restricted by Walls (GM Only)**: When enabled, a target token is only highlighted if there is an unobstructed line of sight between the centers of both tokens. Scene walls and vision blockers will prevent the highlight from appearing.

---

## Automatic Installation

To install the module automatically, in the foundry Admin Panel go to "add-on modules", then click "install module" then paste the following URL into the manifest URL section and click "Install": 

```
https://gitlab.com/Grimsace/basic-aura-highlighting-hJ0GE/-/raw/main/module.json?ref_type=heads
```

---
## Manual Installation

To install the module manually into your Foundry VTT instance:

1. **Locate your Foundry VTT User Data directory**:
   - **Linux**: `~/.local/share/FoundryVTT/Data/modules/`
   - **macOS**: `~/Library/Application Support/FoundryVTT/Data/modules/`
   - **Windows**: `%localappdata%/FoundryVTT/Data/modules/`
2. **Create the module directory**:
   - Create a new directory named `basic_aura_highlighting` inside the `modules` folder:
     ```
     Data/modules/basic_aura_highlighting/
     ```
3. **Copy the repository contents**:
   - Extract or clone all files from this repository directly into `Data/modules/basic_aura_highlighting/` such that `module.json` sits at `Data/modules/basic_aura_highlighting/module.json`.
4. **Launch Foundry VTT**:
   - Start Foundry VTT, enter your Game World, navigate to **Game Settings -> Manage Modules**, and enable **Basic Aura Highlighting**.
