import { openPdf, withPdfPage } from './pdf.mjs?v=10';

function grayPixels(canvas) {
  const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  }
  return { gray, width: canvas.width, height: canvas.height };
}

// Compare strong source edges with the decoded output. A small neighborhood
// accommodates antialiasing and the chosen monochrome threshold.
export function retainedDetail(reference, output) {
  if (reference.width !== output.width || reference.height !== output.height) return 0;
  const { width, height } = reference;
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const i = y * width + x;
      const contrast = Math.abs(output.gray[i] - output.gray[i - 1]) +
        Math.abs(output.gray[i] - output.gray[i - width]);
      if (contrast >= 24) edges[i] = 1;
    }
  }
  let total = 0;
  let retained = 0;
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const contrast = Math.abs(reference.gray[i] - reference.gray[i - 1]) +
        Math.abs(reference.gray[i] - reference.gray[i - width]);
      if (contrast < 32) continue;
      total++;
      let match = 0;
      for (let dy = -2; dy <= 2 && !match; dy++) {
        for (let dx = -2; dx <= 2; dx++) match |= edges[i + dy * width + dx];
      }
      retained += match;
    }
  }
  return total ? retained / total : 1;
}

export async function checkPdfParts(parts, source, signal, onProgress, record = () => {}, maximumParts = 4) {
  if (!parts.length || parts.length > maximumParts) {
    throw new Error('The output must contain between 1 and ' + maximumParts + ' PDFs.');
  }
  let expectedPage = 1;
  for (const part of parts) {
    if (part.blob.type !== 'application/pdf' || part.blob.size >= 200_000 ||
        part.pageStart !== expectedPage || part.pageEnd < part.pageStart) {
      throw new Error('The generated PDF failed its file-size or page-order check.');
    }
    const output = await openPdf(part.blob, signal);
    try {
      const count = part.pageEnd - part.pageStart + 1;
      if (output.document.numPages !== count) throw new Error('The generated PDF has missing pages.');
      let lowestRetention = 1;
      for (let number = 1; number <= count; number++) {
        signal.throwIfAborted();
        const sourceNumber = part.pageStart + number - 1;
        onProgress('Checking output page ' + sourceNumber + '…');
        const page = await output.document.getPage(number);
        const dimensions = page.getViewport({ scale: 1 });
        const dpi = Math.min(200, 1600 * 72 / Math.max(dimensions.width, dimensions.height));
        const decoded = await withPdfPage(output.document, number, signal, grayPixels, dpi);
        if (source) {
          const original = await source.getPage(sourceNumber);
          const originalSize = original.getViewport({ scale: 1 });
          if (Math.abs(originalSize.width - dimensions.width) > 0.02 ||
              Math.abs(originalSize.height - dimensions.height) > 0.02) {
            throw new Error('Page ' + sourceNumber + ' failed its page-layout check.');
          }
          const reference = await withPdfPage(source, sourceNumber, signal, grayPixels, dpi);
          const retention = retainedDetail(reference, decoded);
          record('page_quality_check', {
            page: sourceNumber, detailRetention: Number(retention.toFixed(4)),
            passed: retention >= 0.92, referenceWidth: reference.width, referenceHeight: reference.height,
          });
          if (retention < 0.92) {
            const error = new Error('Page ' + sourceNumber + ' lost too much image detail at the required size.');
            error.code = 'PDF_DETAIL_LOSS';
            error.pageNumber = sourceNumber;
            throw error;
          }
          lowestRetention = Math.min(lowestRetention, retention);
        }
      }
      part.checked = true;
      part.detailRetention = lowestRetention;
      record('part_checked', { pageStart: part.pageStart, pageEnd: part.pageEnd,
        bytes: part.blob.size, detailRetention: Number(lowestRetention.toFixed(4)) });
      expectedPage = part.pageEnd + 1;
    } finally {
      await output.close().catch(() => {});
    }
  }
  if (source && expectedPage !== source.numPages + 1) {
    throw new Error('The generated PDFs have missing pages.');
  }
}
