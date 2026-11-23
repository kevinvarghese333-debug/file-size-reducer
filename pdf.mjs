import { compressPage } from './compress.mjs?v=7';

const assets = new URL('./vendor/pdfjs-6.5.438/', import.meta.url);

export async function openPdf(file, signal) {
  const pdfjs = await import('./vendor/pdfjs-6.5.438/pdf.min.mjs');
  const data = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();

  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', assets).href;
  const task = pdfjs.getDocument({
    data,
    cMapUrl: new URL('cmaps/', assets).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', assets).href,
    iccUrl: new URL('iccs/', assets).href,
    wasmUrl: new URL('wasm/', assets).href,
    stopAtErrors: true,
  });
  let closing;
  function close() {
    signal.removeEventListener('abort', cancel);
    return closing ??= task.destroy();
  }
  function cancel() {
    void close().catch(() => {});
  }
  signal.addEventListener('abort', cancel, { once: true });

  try {
    const document = await task.promise;
    return { document, close };
  } catch (error) {
    cancel();
    if (error.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Unlock it before adding it.');
    }
    throw new Error('This file could not be opened as a PDF.');
  }
}

export async function renderPdfPage(pdf, number, signal, byteLimit) {
  return withPdfPage(pdf, number, signal, canvas => compressPage(canvas, byteLimit));
}

export async function withPdfPage(pdf, number, signal, consume, dpi) {
  const page = await pdf.getPage(number);
  signal.throwIfAborted();
  const { width, height } = page.getViewport({ scale: 1 });
  const scale = dpi ? dpi / 72 : Math.min(2.5, 2600 / Math.max(width, height));
  if (width * height * scale * scale > 24_000_000) {
    throw new Error('This page is too large to render at the selected document resolution.');
  }
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const render = page.render({ canvas, viewport, background: '#fff' });
  const cancel = () => render.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await render.promise;
    signal.throwIfAborted();
    return await consume(canvas, { width, height });
  } finally {
    signal.removeEventListener('abort', cancel);
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}
