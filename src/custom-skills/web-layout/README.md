# Study Buddy Web Layout

The web-layout graph produces one portable offline `document.html` while retaining an editable source bundle.

## Output contract

Each successful run contains:

```text
output/<request>/<timestamp>/
├── document.html
├── source/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── assets/
├── media-manifest.json
├── validation-report.json
└── run-summary.md
```

Agents edit files under `source/`; they do not patch Base64 payloads in `document.html`. Rebuild edited sources with:

```bash
npm run web-layout:bundle -- "<run-dir>/source" --out "<run-dir>/document.html"
```

## Media behavior

- Moodle-derived pages consume only validated `visual_assets.relative_path` files from an extraction handoff.
- Local images can be supplied with repeatable `--asset <path>` arguments and referenced as `assets/<filename>`.
- SVG remains SVG.
- PNG, JPEG, GIF, WebP, AVIF, BMP, TIFF, and HEIC/HEIF raster inputs are resized when necessary. Browser-safe inputs become WebP when it is smaller; non-browser-safe inputs must become WebP.
- Generated Base64 image data is extracted back into `source/assets/` before validation.
- The final bundler embeds selected assets as data URIs and adds lazy image loading hints.
- Remote images and sibling-file dependencies are rejected. User-triggered HTTPS links to Moodle videos, PDFs, and other source material remain allowed.
- The bundler injects a restrictive offline Content Security Policy. Network connections, forms, frames, plugins, and external code remain blocked even if generated inline JavaScript attempts to use another browser API.
- Static validation and a Chromium pass are mandatory in CI; the validation browser aborts all HTTP(S)/WebSocket requests instead of merely recording them.

## Size policy

The default maximum is 100 MB and the absolute override ceiling is 250 MB. The builder estimates the complete Base64-expanded output before writing it and refuses to exceed the configured ceiling. Runs at or above 100 MB receive a large-artifact warning; 250 MB is reserved for exceptional desktop-oriented artifacts because mobile browser memory limits are substantially lower.

The run summary and media manifest report final size, embedded binary bytes, and estimated decoded raster memory. Override the per-run ceiling with `--max-artifact-mb`; values above 250 MB are rejected.
