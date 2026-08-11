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

## Usage

1. Import one or more `.json` files
2. Point to the PNG images folder (or atlas)
3. Pick animation and skin for each JSON
4. Set canvas, scale, FPS / first frame, and naming
5. Click **Export ZIP**

Name placeholders: `{name}`, `{anim}`, `{frame}`, `{####}`, `{index}`.
