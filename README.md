# Spine Frame Exporter

Web app for exporting animation frames from Spine (`.json`) files.

## Features

- Import multiple `.json` files at once
- Separate ZIP folder per JSON
- Frame naming (presets or custom)
- Frame scale and canvas size
- Source animation selection
- First-frame-only export
- Asset location: PNG image folder **or** `.atlas` + textures
- Export all animations (subfolder per animation)
- Skin selection
- Frame size preview (scaled content bounds)

## Requirements

- Spine **4.x** export
- Typical setups:
  - JSON + `images/` folder (no atlas)
  - JSON + `.atlas` + PNG (packed atlas)
- Browser with WebGL

## Run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## macOS app (Tauri)

Standalone `.app` (same UI and export pipeline as the browser version):

```bash
npm install
npm run tauri:build
```

The bundle is written to:

`src-tauri/target/release/bundle/macos/Frame Exporter.app`

A copy for convenience:

`release/Frame Exporter.app`

Open it like any Mac app. Export uses a native Save dialog for the ZIP.

Dev mode with the desktop shell:

```bash
npm run tauri:dev
```

Requirements: Rust toolchain (`rustup`), Xcode Command Line Tools.

## Usage

1. Import one or more `.json` files
2. Point to the PNG images folder (or atlas)
3. Pick animation and skin for each JSON
4. Set canvas, scale, FPS / first frame, and naming
5. Click **Export ZIP**

Name placeholders: `{name}`, `{anim}`, `{frame}`, `{####}`, `{index}`.
