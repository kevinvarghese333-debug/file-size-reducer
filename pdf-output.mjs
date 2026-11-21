import { loadImage } from './compress.mjs?v=4';
import { openPdf, withPdfPage } from './pdf.mjs?v=4';
import { encodeCcittFax } from './vendor/pdf-codec-5.9.0/image/ccitt-encode.js';

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
  return new Blob([bytes], { type: 'application/pdf' });
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
      if (gray[y * width + x] < Math.max(55, mean - 12)) {
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

export async function compressPdfFile(file, isPdf, signal, onProgress, mode = 'color') {
  let source;
  try {
    if (isPdf) source = await openPdf(file, signal);
    signal.throwIfAborted();
    const total = source?.document.numPages ?? 1;
    if (isPdf && mode === 'color' && file.size < PDF_BYTE_LIMIT) {
      return { blob: new Blob([file], { type: 'application/pdf' }), pageCount: total, detail: 'Original quality' };
    }

    if (isPdf && mode === 'color') {
      onProgress('Optimizing PDF text and graphics…');
      try {
        const optimized = await optimizeOriginal(file, signal);
        if (optimized.size < PDF_BYTE_LIMIT) {
          return { blob: optimized, pageCount: total, detail: 'Text and graphics preserved' };
        }
      } catch (error) {
        signal.throwIfAborted();
        // Some PDFs accepted by PDF.js cannot be rewritten by PDF-LIB.
        // Rendering remains available for those documents.
      }
    }

    const resolutions = isPdf ? [300, 200] : [200];
    for (const dpi of resolutions) {
      const pages = [];
      for (let number = 1; number <= total; number++) {
        signal.throwIfAborted();
        onProgress('Preparing page ' + number + ' of ' + total + ' at ' + dpi + ' dpi…');
        const consume = (canvas, dimensions) => imagePage(canvas, dimensions, mode, dpi === 300 ? 0.9 : 0.82, signal);
        const page = isPdf
          ? await withPdfPage(source.document, number, signal, consume, dpi)
          : await withImageCanvas(file, signal, consume);
        signal.throwIfAborted();
        pages.push(page);
        if (pages.reduce((sum, item) => sum + item.bytes.length, 0) >= PDF_BYTE_LIMIT) break;
      }
      if (pages.length !== total) continue;
      const blob = buildPdf(pages);
      if (blob.size < PDF_BYTE_LIMIT) {
        return { blob, pageCount: total, detail: isPdf ? dpi + ' dpi · ' + (mode === 'monochrome' ? 'Black & white' : 'Color') : 'Image quality preserved' };
      }
    }
    const suggestion = mode === 'color'
      ? 'Try Black & white for scanned text, or upload fewer pages.'
      : 'Upload fewer pages or use a higher file-size limit at the receiving portal.';
    throw new Error('This document cannot fit under 198 KB at the supported clarity settings. ' + suggestion);
  } finally {
    if (source) await source.close().catch(() => {});
  }
}
