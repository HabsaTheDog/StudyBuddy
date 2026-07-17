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

## Size policy

The default and absolute maximum is 1,000,000,000 bytes. The builder estimates the complete Base64-expanded output before writing it and refuses to exceed the configured ceiling. Runs at or above 100 MB receive a large-artifact warning; runs at or above 250 MB receive a very-large mobile-compatibility warning. These are warnings, not smaller hidden limits.

The run summary and media manifest report final size, embedded binary bytes, and estimated decoded raster memory. Override the per-run ceiling only downward with `--max-artifact-mb`; values above 1000 MB are rejected.
