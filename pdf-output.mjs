import { compressImage } from './compress.mjs?v=3';
import { openPdf, renderPdfPage } from './pdf.mjs?v=3';

export const PDF_BYTE_LIMIT = 198_000;

// Every page is a JPEG XObject with a matching page box. Byte offsets are
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
    append((number + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + page.imageWidth +
      ' /Height ' + page.imageHeight + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
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

async function jpegPage(blob, dimensions) {
  const image = await createImageBitmap(blob);
  try {
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: dimensions?.width ?? image.width,
      height: dimensions?.height ?? image.height,
      imageWidth: image.width,
      imageHeight: image.height,
    };
  } finally {
    image.close();
  }
}

export async function compressPdfFile(file, isPdf, signal, onProgress) {
  let source;
  try {
    if (isPdf) source = await openPdf(file, signal);
    signal.throwIfAborted();
    const total = source?.document.numPages ?? 1;

    // Keep small original PDFs intact, including their text and links.
    if (isPdf && file.size < PDF_BYTE_LIMIT) {
      return { blob: new Blob([file], { type: 'application/pdf' }), pageCount: total };
    }

    // Reserve actual PDF object overhead, plus room for page dimensions and
    // stream lengths, before dividing the remaining bytes across every page.
    const skeleton = Array.from({ length: total }, () => ({
      width: 1, height: 1, imageWidth: 1, imageHeight: 1, bytes: new Uint8Array(),
    }));
    const overhead = buildPdf(skeleton).size + total * 256;
    const budget = Math.floor((PDF_BYTE_LIMIT - overhead - 1) / total);
    if (budget < 700) throw new Error('This document has too many pages to fit below 198 KB. Try a shorter PDF.');

    const pages = [];
    for (let number = 1; number <= total; number++) {
      signal.throwIfAborted();
      onProgress('Compressing page ' + number + ' of ' + total + '…');
      let jpeg;
      let dimensions;
      if (isPdf) {
        const page = await source.document.getPage(number);
        dimensions = page.getViewport({ scale: 1 });
        jpeg = await renderPdfPage(source.document, number, signal, budget);
      } else {
        jpeg = await compressImage(file, budget);
      }
      signal.throwIfAborted();
      pages.push(await jpegPage(jpeg, dimensions));
    }

    const blob = buildPdf(pages);
    if (blob.size >= PDF_BYTE_LIMIT) {
      throw new Error('This document could not fit below 198 KB. Try a shorter PDF.');
    }
    return { blob, pageCount: total };
  } finally {
    if (source) await source.close().catch(() => {});
  }
}
