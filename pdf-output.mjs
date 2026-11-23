import { loadImage } from './compress.mjs?v=7';
import { openPdf, withPdfPage } from './pdf.mjs?v=7';
import { encodeCcittFax } from './vendor/pdf-codec-5.9.0/image/ccitt-encode.js';
import { checkPdfParts } from './pdf-check.mjs?v=7';

export const PDF_BYTE_LIMIT = 198_000;

// Every page is an image XObject with a matching page box. Byte offsets are
// measured from encoded chunks so binary images cannot corrupt the xref.
export function buildPdf(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;

  function append(value) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  }

  function object(number, body) {
    offsets[number] = length;
    append(number + ' 0 obj\n');
    append(body);
    append('\nendobj\n');
  }

  append('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const children = pages.map((_, index) => (3 + index * 3) + ' 0 R').join(' ');
  object(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + children + '] >>');

  for (const [index, page] of pages.entries()) {
    const number = 3 + index * 3;
    const width = Number(page.width.toFixed(3));
    const height = Number(page.height.toFixed(3));
    object(number, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height +
      '] /Resources << /XObject << /Im ' + (number + 1) + ' 0 R >> >> /Contents ' + (number + 2) + ' 0 R >>');

    offsets[number + 1] = length;
    const encoding = page.fax
      ? '/DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns ' +
        page.imageWidth + ' /Rows ' + page.imageHeight + ' /BlackIs1 false /EndOfBlock false >>'
      : page.monochrome ? '/DeviceGray /BitsPerComponent 1 /Filter /FlateDecode'
        : '/DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode';
    append((number + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + page.imageWidth +
      ' /Height ' + page.imageHeight + ' /ColorSpace ' + encoding + ' /Length ' +
      page.bytes.length + ' >>\nstream\n');
    append(page.bytes);
    append('\nendstream\nendobj\n');

    const commands = 'q\n' + width + ' 0 0 ' + height + ' 0 0 cm\n/Im Do\nQ\n';
    object(number + 2, '<< /Length ' + encoder.encode(commands).length + ' >>\nstream\n' + commands + 'endstream');
  }

  const xref = length;
  append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) append(String(offset).padStart(10, '0') + ' 00000 n \n');
  append('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(chunks, { type: 'application/pdf' });
}

async function optimizeOriginal(file, signal) {
  const { PDFDocument } = await import('./vendor/pdf-lib-1.17.1/pdf-lib.min.mjs');
  signal.throwIfAborted();
  const pdf = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  const bytes = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false });
  signal.throwIfAborted();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), document: pdf };
}

// Try the most even page ranges first, then adjust boundaries to fit actual
// byte sizes. Results stay consecutive and cover the full document.
export async function partitionPdf(total, encodeRange, signal) {
  const cache = new Map();
  const failedRanges = new Set();
  async function encode(start, end) {
    signal.throwIfAborted();
    const key = start + '-' + end;
    if (!cache.has(key)) cache.set(key, await encodeRange(start, end));
    return cache.get(key);
  }
  async function find(start, remaining) {
    const key = start + '-' + remaining;
    if (failedRanges.has(key)) return null;
    if (remaining === 1) {
      const blob = await encode(start, total);
      if (blob.size < PDF_BYTE_LIMIT) return [{ blob, pageStart: start, pageEnd: total }];
      failedRanges.add(key);
      return null;
    }
    const idealEnd = start - 1 + Math.ceil((total - start + 1) / remaining);
    const ends = Array.from({ length: total - remaining - start + 2 }, (_, index) => start + index);
    ends.sort((a, b) => Math.abs(a - idealEnd) - Math.abs(b - idealEnd));
    for (const end of ends) {
      const blob = await encode(start, end);
      if (blob.size >= PDF_BYTE_LIMIT) continue;
      const tail = await find(end + 1, remaining - 1);
      if (tail) return [{ blob, pageStart: start, pageEnd: end }, ...tail];
    }
    failedRanges.add(key);
    return null;
  }
  for (let count = 1; count <= Math.min(3, total); count++) {
    const parts = await find(1, count);
    if (parts) return parts;
  }
  return null;
}

// Threshold against the local paper brightness. This retains thin dark strokes
// on uneven scans and stores sharp black/white pixels without JPEG artifacts.
async function monochromeBytes(canvas, signal) {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
      gray[i] = value;
      rowSum += value;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }

  const rowBytes = Math.ceil(width / 8);
  const packed = new Uint8Array(rowBytes * height);
  packed.fill(255);
  const radius = 20;
  for (let y = 0; y < height; y++) {
    signal.throwIfAborted();
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      // The local window sum fits in 32 bits, including when the full
      // integral image wraps on a large page.
      const sum = (integral[bottom * stride + right] - integral[top * stride + right]
        - integral[bottom * stride + left] + integral[top * stride + left]) >>> 0;
      const mean = sum / ((right - left) * (bottom - top));
      if (gray[y * width + x] < Math.max(55, mean - 8)) {
        packed[y * rowBytes + (x >> 3)] &= ~(128 >> (x & 7));
      }
    }
  }
  const compressed = new Blob([packed]).stream().pipeThrough(new CompressionStream('deflate'));
  const flate = new Uint8Array(await new Response(compressed).arrayBuffer());
  const fax = encodeCcittFax(packed, { columns: width, rows: height, maxBytes: flate.length });
  return fax && fax.length < flate.length ? { bytes: fax, fax: true } : { bytes: flate, fax: false };
}

async function imagePage(canvas, dimensions, mode, quality, signal) {
  let bytes;
  let fax = false;
  if (mode === 'monochrome') {
    ({ bytes, fax } = await monochromeBytes(canvas, signal));
  } else {
    const jpeg = await new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode this page.')),
        'image/jpeg', quality);
    });
    bytes = new Uint8Array(await jpeg.arrayBuffer());
  }
  return {
    bytes,
    ...dimensions,
    imageWidth: canvas.width,
    imageHeight: canvas.height,
    monochrome: mode === 'monochrome',
    fax,
  };
}

async function withImageCanvas(file, signal, consume) {
  const image = await loadImage(file);
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, Math.sqrt(24_000_000 / (image.naturalWidth * image.naturalHeight)));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  try {
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await consume(canvas, { width: canvas.width * 72 / 200, height: canvas.height * 72 / 200 });
  } finally {
    canvas.width = canvas.height = 0;
  }
}

async function checkedResult(parts, source, total, signal, onProgress) {
  await checkPdfParts(parts, source, signal, onProgress);
  signal.throwIfAborted();
  return {
    parts,
    pageCount: total,
    blob: parts.length === 1 ? parts[0].blob : undefined,
    detail: parts[0].detail,
  };
}

export async function compressPdfFile(file, isPdf, signal, onProgress, mode = 'color') {
  let source;
  try {
    if (isPdf) source = await openPdf(file, signal);
    signal.throwIfAborted();
    const total = source?.document.numPages ?? 1;
    if (isPdf && mode === 'color' && file.size < PDF_BYTE_LIMIT) {
      const parts = [{
        blob: new Blob([file], { type: 'application/pdf' }),
        pageStart: 1, pageEnd: total, detail: 'Original quality',
      }];
      return await checkedResult(parts, source.document, total, signal, onProgress);
    }

    if (isPdf && mode === 'color') {
      onProgress('Optimizing PDF text and graphics…');
      let optimized;
      try {
        optimized = await optimizeOriginal(file, signal);
      } catch {
        signal.throwIfAborted();
        // PDFs that cannot be rewritten can still be rendered.
      }
      if (optimized?.blob.size < PDF_BYTE_LIMIT) {
        const parts = [{
          blob: optimized.blob, pageStart: 1, pageEnd: total, detail: 'Text and graphics preserved',
        }];
        return await checkedResult(parts, source.document, total, signal, onProgress);
      }
      if (optimized && optimized.blob.size < PDF_BYTE_LIMIT * 3) {
        const { PDFDocument } = await import('./vendor/pdf-lib-1.17.1/pdf-lib.min.mjs');
        onProgress('Checking page ranges for lossless PDF parts…');
        const parts = await partitionPdf(total, async (start, end) => {
          const pdf = await PDFDocument.create();
          const indices = Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
          const pages = await pdf.copyPages(optimized.document, indices);
          for (const page of pages) pdf.addPage(page);
          return new Blob([await pdf.save({ useObjectStreams: true, updateFieldAppearances: false })],
            { type: 'application/pdf' });
        }, signal);
        if (parts) {
          for (const part of parts) part.detail = 'Text and graphics preserved';
          return await checkedResult(parts, source.document, total, signal, onProgress);
        }
      }
    }

    const resolutions = isPdf ? [300, 200] : [200];
    for (const dpi of resolutions) {
      const pages = [];
      let imageBytes = 0;
      for (let number = 1; number <= total; number++) {
        signal.throwIfAborted();
        onProgress('Preparing page ' + number + ' of ' + total + ' at ' + dpi + ' dpi…');
        const consume = (canvas, dimensions) => imagePage(canvas, dimensions, mode, dpi === 300 ? 0.9 : 0.82, signal);
        const page = isPdf
          ? await withPdfPage(source.document, number, signal, consume, dpi)
          : await withImageCanvas(file, signal, consume);
        signal.throwIfAborted();
        pages.push(page);
        imageBytes += page.bytes.length;
        if (imageBytes >= PDF_BYTE_LIMIT * 3) break;
      }
      if (pages.length !== total || imageBytes >= PDF_BYTE_LIMIT * 3) continue;
      onProgress('Finding clear PDF parts under 198 KB…');
      const parts = await partitionPdf(total,
        (start, end) => buildPdf(pages.slice(start - 1, end)), signal);
      if (parts) {
        for (const part of parts) {
          part.detail = isPdf ? dpi + ' dpi · ' + (mode === 'monochrome' ? 'Black & white' : 'Color')
            : 'Image quality preserved';
        }
        return await checkedResult(parts, source?.document, total, signal, onProgress);
      }
    }
    const suggestion = mode === 'color' ? ' Try Black & white for scanned text.' : '';
    throw new Error('This document could not fit into up to 3 clear PDFs below 198 KB each.' + suggestion);
  } finally {
    if (source) await source.close().catch(() => {});
  }
}
