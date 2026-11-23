import { loadImage } from './compress.mjs?v=9';
import { openPdf, withPdfPage } from './pdf.mjs?v=9';
import { encodeCcittFax } from './vendor/pdf-codec-5.9.0/image/ccitt-encode.js';
import { checkPdfParts } from './pdf-check.mjs?v=9';
import { analyzeCanvas, otsuThreshold } from './page-analysis.mjs?v=9';

export const PDF_BYTE_LIMIT = 200_000;
export const MAX_PDF_PARTS = 4;

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

// Pack consecutive pages into at most four parts based on actual PDF bytes.
// Oversized candidates retain only their size to avoid caching large PDF buffers.
export async function partitionPdf(total, encodeRange, signal) {
  const cache = new Map();
  async function encode(start, end) {
    signal.throwIfAborted();
    const key = start + '-' + end;
    if (!cache.has(key)) {
      const blob = await encodeRange(start, end);
      cache.set(key, blob.size < PDF_BYTE_LIMIT ? blob : { size: blob.size });
    }
    return cache.get(key);
  }

  const parts = [];
  let start = 1;
  while (start <= total) {
    const single = await encode(start, start);
    if (single.size >= PDF_BYTE_LIMIT) return null;
    let best = { blob: single, pageStart: start, pageEnd: start };
    let low = start + 1;
    let high = total;
    while (low <= high) {
      const end = Math.floor((low + high) / 2);
      const blob = await encode(start, end);
      if (blob.size < PDF_BYTE_LIMIT) {
        best = { blob, pageStart: start, pageEnd: end };
        low = end + 1;
      } else {
        high = end - 1;
      }
    }
    parts.push(best);
    start = best.pageEnd + 1;
    if (parts.length === MAX_PDF_PARTS && start <= total) return null;
  }

  // Prefer even ranges when they fit without increasing the part count.
  const balanced = [];
  start = 1;
  for (let index = 0; index < parts.length; index++) {
    const count = Math.ceil((total - start + 1) / (parts.length - index));
    const end = start + count - 1;
    const blob = await encode(start, end);
    if (blob.size >= PDF_BYTE_LIMIT) return parts;
    balanced.push({ blob, pageStart: start, pageEnd: end });
    start = end + 1;
  }
  for (let index = 0; index < balanced.length - 1;) {
    const left = balanced[index];
    const right = balanced[index + 1];
    const blob = await encode(left.pageStart, right.pageEnd);
    if (blob.size < PDF_BYTE_LIMIT) {
      balanced.splice(index, 2, { blob, pageStart: left.pageStart, pageEnd: right.pageEnd });
      index = Math.max(0, index - 1);
    } else index++;
  }
  return balanced;
}

// Threshold against the local paper brightness. This retains thin dark strokes
// on uneven scans and stores sharp black/white pixels without JPEG artifacts.
async function monochromeBytes(canvas, signal, thresholdMethod = 'adaptive') {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  const stride = width + 1;
  const integral = thresholdMethod === 'adaptive' ? new Uint32Array(stride * (height + 1)) : null;
  const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
      gray[i] = value;
      histogram[value]++;
      rowSum += value;
      if (integral) integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }

  const rowBytes = Math.ceil(width / 8);
  const packed = new Uint8Array(rowBytes * height);
  packed.fill(255);
  const radius = 20;
  const threshold = otsuThreshold(histogram);
  for (let y = 0; y < height; y++) {
    signal.throwIfAborted();
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      // The local window sum fits in 32 bits, including when the full
      // integral image wraps on a large page.
      const sum = integral ? (integral[bottom * stride + right] - integral[top * stride + right]
        - integral[bottom * stride + left] + integral[top * stride + left]) >>> 0 : 0;
      const cutoff = integral ? Math.max(55, sum / ((right - left) * (bottom - top)) - 8) : threshold;
      if (gray[y * width + x] < cutoff) {
        packed[y * rowBytes + (x >> 3)] &= ~(128 >> (x & 7));
      }
    }
  }
  const compressed = new Blob([packed]).stream().pipeThrough(new CompressionStream('deflate'));
  const flate = new Uint8Array(await new Response(compressed).arrayBuffer());
  const fax = encodeCcittFax(packed, { columns: width, rows: height, maxBytes: flate.length });
  return fax && fax.length < flate.length ? { bytes: fax, fax: true } : { bytes: flate, fax: false };
}

async function imagePage(canvas, dimensions, mode, quality, signal, thresholdMethod) {
  let bytes;
  let fax = false;
  if (mode === 'monochrome') {
    ({ bytes, fax } = await monochromeBytes(canvas, signal, thresholdMethod));
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

async function checkedResult(parts, source, total, signal, onProgress, record) {
  await checkPdfParts(parts, source, signal, onProgress, record);
  signal.throwIfAborted();
  record('candidate_verified', { partCount: parts.length, pageCount: total,
    parts: parts.map(part => ({ pageStart: part.pageStart, pageEnd: part.pageEnd,
      bytes: part.blob.size, detail: part.detail, detailRetention: part.detailRetention })) });
  return { parts, pageCount: total, blob: parts.length === 1 ? parts[0].blob : undefined,
    detail: parts[0].detail };
}

function limitError(reason) {
  const error = new Error(reason + ' The document could not meet the readability checks within 4 PDFs below 200 KB each. Download logs for the page-by-page diagnosis.');
  error.code = 'PDF_FOUR_PART_LIMIT';
  return error;
}

function describeParts(parts, pages, isPdf) {
  for (const part of parts) {
    const selected = pages.slice(part.pageStart - 1, part.pageEnd);
    const low = Math.min(...selected.map(page => page.dpi));
    const high = Math.max(...selected.map(page => page.dpi));
    const resolution = low === high ? String(low) : low + '–' + high;
    const modes = new Set(selected.map(page => page.mode));
    const appearance = modes.size > 1 ? 'Color and black & white'
      : modes.has('monochrome') ? 'Black & white' : 'Color';
    part.detail = isPdf ? resolution + ' dpi · ' + appearance : 'Image quality checked';
  }
}

export async function compressPdfFile(file, isPdf, signal, onProgress, mode = 'auto', record = () => {}) {
  let source;
  try {
    record('document_started', { inputBytes: file.size, appearance: mode, maximumParts: MAX_PDF_PARTS,
      maximumPartBytes: PDF_BYTE_LIMIT, minimumDetailRetention: 0.92 });
    if (isPdf) source = await openPdf(file, signal);
    signal.throwIfAborted();
    const total = source?.document.numPages ?? 1;
    const analyses = [];
    for (let number = 1; number <= total; number++) {
      signal.throwIfAborted();
      onProgress('Analyzing page ' + number + ' of ' + total + '…');
      const analysis = isPdf
        ? await withPdfPage(source.document, number, signal, canvas => analyzeCanvas(canvas, 200), 200)
        : await withImageCanvas(file, signal, canvas => analyzeCanvas(canvas, 200));
      analyses.push(analysis);
      record('page_analysis', { page: number, ...analysis });
    }

    let best;
    if (isPdf && mode !== 'monochrome' && file.size < PDF_BYTE_LIMIT) {
      const parts = [{ blob: new Blob([file], { type: 'application/pdf' }),
        pageStart: 1, pageEnd: total, detail: 'Original quality' }];
      return await checkedResult(parts, source.document, total, signal, onProgress, record);
    }

    if (isPdf && mode !== 'monochrome') {
      onProgress('Optimizing original PDF text and graphics…');
      let optimized;
      try {
        optimized = await optimizeOriginal(file, signal);
        record('lossless_attempt', { bytes: optimized.blob.size });
      } catch (error) {
        signal.throwIfAborted();
        record('lossless_unavailable', { reason: error.message });
      }
      if (optimized?.blob.size < PDF_BYTE_LIMIT) {
        const parts = [{ blob: optimized.blob, pageStart: 1, pageEnd: total, detail: 'Text and graphics preserved' }];
        return await checkedResult(parts, source.document, total, signal, onProgress, record);
      }
      if (optimized && optimized.blob.size < PDF_BYTE_LIMIT * MAX_PDF_PARTS) {
        const { PDFDocument } = await import('./vendor/pdf-lib-1.17.1/pdf-lib.min.mjs');
        const parts = await partitionPdf(total, async (start, end) => {
          const pdf = await PDFDocument.create();
          const pages = await pdf.copyPages(optimized.document,
            Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index));
          for (const page of pages) pdf.addPage(page);
          return new Blob([await pdf.save({ useObjectStreams: true, updateFieldAppearances: false })],
            { type: 'application/pdf' });
        }, signal);
        record('lossless_partition', { fitsFourParts: Boolean(parts) });
        if (parts) {
          for (const part of parts) part.detail = 'Text and graphics preserved';
          best = await checkedResult(parts, source.document, total, signal, onProgress, record);
          if (parts.length === 1) return best;
        }
      }
    }

    const profiles = [
      { dpi: 300, quality: 0.9 }, { dpi: 240, quality: 0.88 }, { dpi: 200, quality: 0.85 },
      { dpi: 180, quality: 0.82 }, { dpi: 160, quality: 0.78 }, { dpi: 150, quality: 0.76 },
      { dpi: 150, quality: 0.6 }, { dpi: 150, quality: 0.45 }, { dpi: 150, quality: 0.3 },
    ];
    const previous = [];
    let lastFailure = 'The pages need more space at the detected text size.';
    for (let index = 0; index < profiles.length; index++) {
      const profile = profiles[index];
      const pages = [];
      let bytes = 0;
      record('compression_attempt', { attempt: index + 1, targetDpi: profile.dpi, jpegQuality: profile.quality });
      for (let number = 1; number <= total; number++) {
        signal.throwIfAborted();
        const analysis = analyses[number - 1];
        // A 150 dpi fallback still has to pass the decoded-output detail checks.
        const minimumDpi = profile.dpi === 150 ? 150 : analysis.minimumDpi;
        const dpi = isPdf ? Math.max(profile.dpi, minimumDpi, analysis.forceDpi || 0) : 200;
        const appearance = analysis.forceMode || (mode === 'auto' ? analysis.recommendedMode : mode);
        const thresholdMethod = analysis.forceThreshold || analysis.thresholdMethod;
        const signature = [dpi, appearance, thresholdMethod, appearance === 'color' ? profile.quality : 'lossless'].join('/');
        let page;
        if (previous[number - 1]?.signature === signature) {
          page = previous[number - 1].page;
        } else {
          onProgress('Compressing page ' + number + ' of ' + total + ' at ' + dpi + ' dpi…');
          const consume = (canvas, dimensions) =>
            imagePage(canvas, dimensions, appearance, profile.quality, signal, thresholdMethod);
          page = isPdf ? await withPdfPage(source.document, number, signal, consume, dpi)
            : await withImageCanvas(file, signal, consume);
          page = { ...page, dpi, mode: appearance };
          previous[number - 1] = { signature, page };
        }
        pages.push(page);
        bytes += page.bytes.length;
        record('page_encoded', { page: number, dpi, appearance, thresholdMethod,
          jpegQuality: appearance === 'color' ? profile.quality : null,
          encodedImageBytes: page.bytes.length,
          estimatedTextPixels: analysis.estimatedTextHeight
            ? Number((analysis.estimatedTextHeight * dpi / analysis.referenceDpi).toFixed(2)) : null });
        if (bytes >= PDF_BYTE_LIMIT * MAX_PDF_PARTS || buildPdf([page]).size >= PDF_BYTE_LIMIT) break;
      }
      if (pages.length !== total || bytes >= PDF_BYTE_LIMIT * MAX_PDF_PARTS) {
        lastFailure = 'The pages still exceed the combined four-file budget at the tried resolution of ' + profile.dpi + ' dpi.';
        record('attempt_rejected', { reason: 'byte_budget', preparedPages: pages.length, encodedImageBytes: bytes });
        continue;
      }
      onProgress('Balancing pages across up to 4 PDFs…');
      const parts = await partitionPdf(total, (start, end) => buildPdf(pages.slice(start - 1, end)), signal);
      record('partition_attempt', { encodedImageBytes: bytes, fitsFourParts: Boolean(parts),
        ranges: parts?.map(part => [part.pageStart, part.pageEnd]), sizes: parts?.map(part => part.blob.size) });
      if (!parts) {
        lastFailure = 'The page sizes still require more than 4 files, or a single page exceeds 200 KB, at the tried resolution of ' + profile.dpi + ' dpi.';
        continue;
      }
      if (best && parts.length >= best.parts.length) {
        record('consolidation_attempt', { partCount: parts.length, retainedPartCount: best.parts.length, improved: false });
        continue;
      }
      describeParts(parts, pages, isPdf);
      try {
        const result = await checkedResult(parts, source?.document, total, signal, onProgress, record);
        record('consolidation_attempt', { partCount: parts.length, previousPartCount: best?.parts.length, improved: true });
        best = result;
        if (parts.length === 1) return result;
      } catch (error) {
        signal.throwIfAborted();
        if (error.code !== 'PDF_DETAIL_LOSS') throw error;
        const pageIndex = error.pageNumber - 1;
        const analysis = analyses[pageIndex];
        const candidate = pages[pageIndex];
        record('quality_rejected', { page: error.pageNumber, reason: error.message, dpi: candidate.dpi });
        if (candidate.mode === 'monochrome' && analysis.thresholdMethod === 'otsu' && !analysis.forceThreshold) {
          analysis.forceThreshold = 'adaptive';
        } else if (mode === 'auto' && candidate.mode === 'color' && !analysis.forceMode) {
          analysis.forceMode = 'monochrome';
          analysis.forceThreshold = 'adaptive';
        } else if (candidate.dpi < 200 && !analysis.forceDpi) {
          analysis.forceDpi = 200;
        } else {
          if (best) { lastFailure = error.message; break; }
          throw limitError(error.message);
        }
        record('page_quality_restore', { page: error.pageNumber, forceDpi: analysis.forceDpi,
          forceMode: analysis.forceMode, forceThreshold: analysis.forceThreshold });
        index--;
        lastFailure = error.message;
      }
    }
    if (best) return best;
    throw limitError(lastFailure);
  } catch (error) {
    record('conversion_stopped', { code: error.code || error.name, reason: error.message });
    throw error;
  } finally {
    if (source) await source.close().catch(() => {});
  }
}
