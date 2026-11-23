# Image Desk

Browser-based PDF and image compression, deployed at https://kavitha.cloud/compressor/.

- PDF is the default output. Each PDF must be strictly smaller than 200,000 bytes.
- Automatic inspects each page and can choose black & white for text scans. Original colors and black & white are also selectable.
- Tries original PDF optimization first, then raster profiles down to 150 dpi when necessary. It keeps the highest-quality checked candidate for the fewest parts found within these profiles.
- Combines consecutive pages using actual encoded PDF sizes, including PDF overhead. Outputs contain at most four numbered parts per input, with page ranges in their names.
- Every PDF is reopened and every page rendered before download links appear. Checks cover size, page count, order, layout and source-edge retention. This is an automated detail check, not a guarantee of semantic legibility; preview handwriting and stamps.
- If the size and quality limits cannot be met, stops with an explanation. No oversized fallback is offered.
- JPEG output keeps the existing per-page conversion below 200,000 bytes. Bulk upload and ZIP downloads are supported.

## Diagnostics

Download logs exports JSON from the current browser. Recent jobs are stored locally (up to 20 jobs, 1,000 events per job, with older history pruned). Logs include input names and sizes, page analysis, compression settings, quality metrics, output ranges and failure reasons. They contain no document text or page images and are not sent to a server. When local storage is unavailable, logs remain available in memory until the page closes.

## Development and deployment

Serve this directory with a static HTTP server. All assets and PDF libraries are local, and links are relative so the app works at `/compressor/`. No build or backend is required. Deploy the app modules, HTML, CSS, fonts and vendor directories together; do not deploy test documents.

Run the partition regression checks with:

```sh
node --test tests/pdf-partition.test.mjs
```
