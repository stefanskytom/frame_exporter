# Frame Exporter

Export PNG frame sequences from Spine **4.x** skeletons — in the browser or as a standalone macOS app.

Two modes:

- **v1 Classic** — one animation (or all animations) → PNG sequence per skeleton
- **v2 Tracks** — layer multiple Spine tracks (e.g. walk + aim) and bake the mix to PNG

## Download (macOS)

Prebuilt Apple Silicon build is in [`public/`](./public/):

| File | Description |
|------|-------------|
| [**Frame Exporter_0.1.0_aarch64.dmg**](./public/Frame%20Exporter_0.1.0_aarch64.dmg) | Installer disk image (recommended) |
| [**Frame-Exporter-macOS.zip**](./public/Frame-Exporter-macOS.zip) | Zipped `.app` |
| [`Frame Exporter.app`](./public/Frame%20Exporter.app) | App bundle (clone / sparse checkout) |

Open the app like any Mac app. Export uses a native Save dialog for the ZIP.

> Requires **macOS 11+**, **Apple Silicon (aarch64)**, and a GPU with WebGL.

## Features

### v1 Classic

- Import multiple `.json` files at once
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
npm run tauri:build
```

Bundle output:

- `src-tauri/target/release/bundle/macos/Frame Exporter.app`
- `src-tauri/target/release/bundle/dmg/Frame Exporter_*.dmg`

Copy into `public/` (and optionally `release/`) when publishing a new download.

Dev mode with the desktop shell:

```bash
npm run tauri:dev
```

Requirements: Rust toolchain (`rustup`), Xcode Command Line Tools.

Regenerate app icons from the SVG source:

```bash
npm run icons:generate
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
