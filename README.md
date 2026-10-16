# Frame Exporter

Export PNG frame sequences from Spine **4.x** skeletons — in the browser or as a standalone macOS app.

Two modes:

- **v1 Classic** — one animation (or all animations) → PNG sequence per skeleton
- **v2 Tracks** — layer multiple Spine tracks (e.g. walk + aim) and bake the mix to PNG

<p align="center">
  <img src="docs/screenshots/02-v1-preview-skeleton.png" alt="v1 Classic — live preview with Spineboy" width="900" />
</p>

<p align="center"><em>v1 Classic — live WebGL preview, frame-size advice, and per-skeleton animation / skin / atlas controls</em></p>

## Download (macOS)

Prebuilt **Apple Silicon (aarch64)** build is in [`public/`](./public/):

| File | Description |
|------|-------------|
| [**Frame Exporter_0.1.0_aarch64.dmg**](./public/Frame%20Exporter_0.1.0_aarch64.dmg) | Installer disk image (**preferred**) |
| [**Frame-Exporter-macOS.zip**](./public/Frame-Exporter-macOS.zip) | Zipped `.app` (best for AirDrop / chat) |
| [`Frame Exporter.app`](./public/Frame%20Exporter.app) | App bundle |
| [`FIX-MACOS-OPEN.command`](./public/FIX-MACOS-OPEN.command) | Double-click helper if macOS blocks launch |

> Prefer the **DMG** or **ZIP**. Sending a raw `.app` folder via Messenger / Slack / email often breaks the bundle or triggers Gatekeeper.

### If the app won’t open on another Mac

macOS Gatekeeper blocks apps that are not notarized by Apple (this build is **ad-hoc signed**, not Developer ID–notarized). Recipients typically see *“app is damaged”* or *“cannot be opened because it is from an unidentified developer”*.

**Fix (pick one):**

1. **Right-click** `Frame Exporter.app` → **Open** → **Open** (first launch only).
2. Or open **System Settings → Privacy & Security** and click **Open Anyway**.
3. Or double-click [`FIX-MACOS-OPEN.command`](./public/FIX-MACOS-OPEN.command) next to the app.
4. Or in Terminal:

```bash
xattr -cr "/path/to/Frame Exporter.app"
open "/path/to/Frame Exporter.app"
```

Export uses a native Save dialog for the ZIP.

> Requires **macOS 11+**, **Apple Silicon**. Intel Macs need a separate build (not included yet).

## Screenshots & features

### v1 Classic — import → preview → export

<p align="center">
  <img src="docs/screenshots/01-v1-overview.png" alt="v1 empty overview" width="900" />
</p>

**Guided workflow** with numbered steps: drop Spine JSON files, point to an assets folder or `.atlas` + textures, then configure skeletons and export settings. Switch between **v1 Classic** and **v2 Tracks** from the top bar at any time.

---

<p align="center">
  <img src="docs/screenshots/02-v1-preview-skeleton.png" alt="v1 live preview and skeleton card" width="900" />
</p>

**Live animation preview** plays the selected clip in WebGL. Each JSON gets its own card with:

- Status badges (`Ready` / missing assets, atlas vs images mode)
- Animation, skin, and atlas selectors
- Measured **frame size** (scaled AABB) and a one-click **Set canvas to…** when content overflows

---

<p align="center">
  <img src="docs/screenshots/03-v1-export-settings.png" alt="v1 export settings panel" width="900" />
</p>

**Export settings** cover the full bake pipeline:

- Export **all animations** (subfolder per animation) or a single selected clip
- **Ignore missing assets** (transparent placeholders)
- First frame only, canvas size, scale, FPS
- Frame naming presets or a custom pattern (`{name}`, `{anim}`, `{####}`, …)
- Transparent or solid background, optional premultiplied alpha

---

<p align="center">
  <img src="docs/screenshots/04-v1-full-workflow.png" alt="v1 full page workflow" width="700" />
</p>

**ZIP layout** is predictable: one folder per JSON, optional animation subfolders, PNG names from your pattern. Ready count and progress show in the export bar before you click **Export ZIP**.

### v2 Tracks — multi-track mix

<p align="center">
  <img src="docs/screenshots/05-v2-track-mixer.png" alt="v2 track mixer with walk + aim" width="900" />
</p>

**Layer Spine tracks** the same way as Spine Preview (e.g. `walk` on track 0 + `aim` on track 1). Higher tracks override only what they key. Per track you can set loop, delay, time scale, and alpha, with a live mixed preview on the left.

---

<p align="center">
  <img src="docs/screenshots/06-v2-full-workflow.png" alt="v2 full workflow" width="700" />
</p>

**Bake the mix** to a PNG sequence: set duration (or fit to the animation cycle), FPS, canvas, and scale, then export a ZIP of the layered pose.

## Feature list

### v1 Classic

- Import multiple `.json` files at once (files or folder)
- Separate ZIP folder per JSON (optional subfolder per animation)
- Frame naming presets or custom patterns
- Canvas size, scale, FPS, first-frame-only
- Atlas (`.atlas` + textures) **or** images folder
- Skin selection and live WebGL preview
- Frame size preview with suggested canvas
- Ignore missing assets (transparent placeholders)

### v2 Tracks

- Multi-track animation mix (Spine AnimationState tracks)
- Live preview of layered tracks
- Per-track delay, time scale, alpha, loop
- Bake mixed pose to a PNG sequence ZIP

## Requirements

- Spine **4.x** export
- Typical setups:
  - JSON + `images/` folder (no atlas)
  - JSON + `.atlas` + PNG (packed atlas)
- Browser with WebGL (for the web UI)

## Run (web)

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Switch UI version with the **v1 Classic** / **v2 Tracks** toggle (or `#v1` / `#v2` in the URL).

## Build macOS app (Tauri)

```bash
npm install
npm run tauri:dist   # build + ad-hoc sign + refresh public/ artifacts
```

Or build only:

```bash
npm run tauri:build
```

Bundle output:

- `src-tauri/target/release/bundle/macos/Frame Exporter.app`
- `src-tauri/target/release/bundle/dmg/Frame Exporter_*.dmg`

`npm run tauri:dist` also ad-hoc codesigns the app (required on Apple Silicon) and copies DMG / zip / `.app` into `public/`.

> Fully silent Gatekeeper approval on other Macs needs an Apple **Developer ID** certificate + notarization (`APPLE_ID` / `APPLE_TEAM_ID` / …). Without that, recipients use the [Open / xattr steps](#if-the-app-wont-open-on-another-mac) above.

Dev mode with the desktop shell:

```bash
npm run tauri:dev
```

Requirements: Rust toolchain (`rustup`), Xcode Command Line Tools.

Regenerate app icons from the SVG source:

```bash
npm run icons:generate
```

Refresh README screenshots (dev server must be running):

```bash
SMOKE_URL=http://localhost:5199 node scripts/capture-readme-screenshots.mjs
```

## Usage

1. Import one or more Spine `.json` files
2. Point to the PNG images folder (or `.atlas` + textures)
3. Pick animation / skin (v1) or layer tracks (v2)
4. Set canvas, scale, FPS / duration, and naming
5. Click **Export ZIP**

Name placeholders: `{name}`, `{anim}`, `{frame}`, `{####}`, `{index}`.

## Tests

With the Vite dev server running (e.g. port `5199`):

```bash
npm run test:e2e        # v1 preview + export
npm run test:v2         # v2 multi-track export
npm run test:features   # full feature suite
```
