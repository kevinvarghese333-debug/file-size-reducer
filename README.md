# Image Desk

Browser-based PDF and image compression, deployed at https://kavitha.cloud/compressor/.

- Three output options, in order: Image (JPEG) below 200,000 bytes, PDF below 200,000 bytes (the default), and Deed copy below 498,000 bytes (only for deed copies). The deed limit leaves a margin below 500 KB.
- Automatic inspects each page and can choose black & white for text scans. Original colors and black & white are also selectable.
- Tries original PDF optimization first, then raster profiles down to 150 dpi for standard PDFs. Deed copies may try 100–140 dpi where estimated text remains at least 10 pixels high; mixed/unknown handwriting retains a 150 dpi floor. Every candidate must pass the same detail checks. It keeps the highest-quality checked candidate for the fewest parts found within these profiles.
- Combines consecutive pages using actual encoded PDF sizes, including PDF overhead. Up to four numbered parts are made available automatically for standard PDFs. Deed copies aim for one or two parts, and require approval above two. If more are needed, the checked proposal shows the exact count, page ranges and sizes, with Proceed and Cancel buttons. No download links appear until it is accepted.
- Every PDF is reopened and every page rendered before download links appear. Checks cover size, page count, order, layout and source-edge retention. This is an automated detail check, not a guarantee of semantic legibility; preview handwriting and stamps.
- If no candidate passes the per-file size and quality limits, stops with an explanation. No oversized fallback is offered.
- JPEG output keeps the existing per-page conversion below 200,000 bytes. Bulk upload and ZIP downloads are supported.

## Diagnostics

Download logs exports JSON from the current browser. Recent jobs are stored locally (up to 20 jobs, 1,000 events per job, with older history pruned). Logs include input names and sizes, page analysis, compression settings, quality metrics, output ranges, approval decisions and failure reasons. They contain no document text or page images and are not sent to a server. When local storage is unavailable, logs remain available in memory until the page closes.

## Development and deployment

Serve this directory with a static HTTP server. All assets and PDF libraries are local, and links are relative so the app works at `/compressor/`. No build or backend is required. Deploy the app modules, HTML, CSS, fonts and vendor directories together; do not deploy test documents.

Run the partition regression checks with:

```sh
node --test tests/*.test.mjs
```
