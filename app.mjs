import { compressImage, uniqueJpegName, uniqueOutputName } from './compress.mjs?v=4';
import { compressPdfFile } from './pdf-output.mjs?v=4';
import { openPdf, renderPdfPage } from './pdf.mjs?v=4';
import { makeZip } from './zip.mjs?v=4';

const choose = document.querySelector('#choose');
const filesInput = document.querySelector('#files');
const dropzone = document.querySelector('#dropzone');
const summary = document.querySelector('#summary');
const empty = document.querySelector('#empty');
const results = document.querySelector('#results');
const clear = document.querySelector('#clear');
const zip = document.querySelector('#zip');
const zipLabel = zip.querySelector('span');
const zipError = document.querySelector('#zip-error');
const formatInputs = document.querySelectorAll('[name="output-format"]');
const formatHelp = document.querySelector('#format-help');
const outputTitle = document.querySelector('#output-title');
const outputLimit = document.querySelector('#output-limit');
const pdfOptions = document.querySelector('#pdf-options');
const pdfMode = document.querySelector('#pdf-mode');

const entries = [];
const usedNames = new Set();
const counts = { pending: 0, ready: 0, failed: 0 };
const sizeFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
let processing = false;
let zipping = false;
let batch = new AbortController();

function formatSize(bytes) {
  if (bytes < 1000) return sizeFormatter.format(bytes) + ' B';
  return sizeFormatter.format(Math.floor(bytes / 100) / 10) + ' KB';
}

function refreshControls() {
  empty.hidden = entries.length > 0;
  results.hidden = entries.length === 0;
  clear.hidden = entries.length === 0;
  clear.disabled = zipping;
  zip.disabled = !counts.ready || counts.pending > 0 || zipping;
  zipLabel.textContent = zipping ? 'Preparing ZIP…' : 'Download all (ZIP)';

  const messages = [];
  if (counts.ready) messages.push(counts.ready + ' ready');
  if (counts.pending) messages.push(counts.pending + ' processing');
  if (counts.failed) messages.push(counts.failed + ' failed');
  const status = messages.join(' · ') || 'Converted files will appear here as they’re ready.';
  if (summary.textContent !== status) summary.textContent = status;
}

function createEntry(label) {
  const row = document.createElement('li');
  row.className = 'result';
  row.innerHTML = `
    <span class="thumb" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg></span>
    <div class="file-info"><p class="file-name"></p><p class="file-state">Waiting…</p></div>
  `;
  const title = row.querySelector('.file-name');
  title.textContent = label;
  title.title = label;
  return { row, status: row.querySelector('.file-state') };
}

function showResult(entry, blob) {
  entry.blob = blob;
  entry.url = URL.createObjectURL(blob);
  const isPdf = blob.type === 'application/pdf';
  if (isPdf) {
    entry.row.querySelector('.thumb').textContent = 'PDF';
  } else {
    const image = document.createElement('img');
    image.className = entry.pageLabel ? 'thumb page-thumb' : 'thumb';
    image.alt = '';
    image.loading = 'lazy';
    image.src = entry.url;
    entry.row.querySelector('.thumb').replaceWith(image);
  }
  const prefix = entry.pageLabel ? entry.pageLabel + ' · ' : formatSize(entry.file.size) + ' → ';
  const type = isPdf ? 'PDF · ' + entry.pageCount + (entry.pageCount === 1 ? ' page' : ' pages') : 'JPEG';
  entry.status.textContent = prefix + formatSize(blob.size) + ' · ' + type +
    (entry.detail ? ' · ' + entry.detail : '');

  const link = document.createElement('a');
  link.className = 'button download';
  link.href = entry.url;
  link.download = entry.name;
  link.title = 'Download ' + entry.name;
  link.setAttribute('aria-label', link.title);
  link.append(zip.querySelector('svg').cloneNode(true));
  entry.row.append(link);
}

function reportFailure(entry, message) {
  entry.status.textContent = (entry.pageLabel ? entry.pageLabel + ' · ' : '') + message;
  entry.status.classList.add('error');
  counts.failed++;
}

async function processOutput(entry, convert, signal, errorMessage) {
  entry.status.textContent = entry.pageLabel ? entry.pageLabel + ' · Converting…' : 'Compressing…';
  try {
    const blob = await convert();
    if (signal.aborted) return;
    showResult(entry, blob);
    counts.ready++;
  } catch (error) {
    if (signal.aborted) return;
    reportFailure(entry, errorMessage || error.message || 'This file could not be compressed.');
  } finally {
    if (!signal.aborted) {
      counts.pending--;
      refreshControls();
    }
  }
}

async function processPdf(entry, signal) {
  entry.status.textContent = 'Reading PDF…';
  let pdf;
  try {
    pdf = await openPdf(entry.file, signal);
  } catch (error) {
    if (!signal.aborted) {
      reportFailure(entry, error.message || 'This file could not be opened as a PDF.');
      counts.pending--;
      refreshControls();
    }
    return;
  }

  try {
    if (signal.aborted) return;
    const total = pdf.document.numPages;
    const digits = String(total).length;
    const rows = document.createDocumentFragment();
    entry.pages = Array.from({ length: total }, (_, index) => {
      const number = index + 1;
      const suffix = '-page-' + String(number).padStart(digits, '0');
      const name = uniqueJpegName(entry.file.name, usedNames, suffix);
      const page = createEntry(name);
      page.name = name;
      page.pageLabel = 'Page ' + number + ' of ' + total;
      page.status.textContent = page.pageLabel + ' · Waiting…';
      rows.append(page.row);
      return page;
    });
    entry.row.replaceWith(rows);
    counts.pending += total - 1;
    refreshControls();

    for (const [index, page] of entry.pages.entries()) {
      if (signal.aborted) break;
      await processOutput(page, () => renderPdfPage(pdf.document, index + 1, signal), signal,
        'This page could not be converted.');
    }
  } finally {
    await pdf.close().catch(() => {});
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    let entry;
    while ((entry = entries.find(item => item.file))) {
      try {
        const signal = batch.signal;
        if (entry.outputFormat === 'pdf') {
          await processOutput(entry, async () => {
            const result = await compressPdfFile(entry.file, entry.isPdf, signal, message => {
              if (!signal.aborted) entry.status.textContent = message;
            }, entry.pdfMode);
            entry.pageCount = result.pageCount;
            entry.detail = result.detail;
            return result.blob;
          }, signal);
        } else if (entry.isPdf) {
          await processPdf(entry, signal);
        } else {
          await processOutput(entry, () => compressImage(entry.file), signal);
        }
      } finally {
        entry.file = null;
      }
    }
  } finally {
    processing = false;
  }
}

function addFiles(files) {
  if (!files.length) return;
  zipError.hidden = true;
  const rows = document.createDocumentFragment();
  for (const file of files) {
    const entry = createEntry(file.name);
    entry.file = file;
    entry.outputFormat = document.querySelector('[name="output-format"]:checked').value;
    entry.pdfMode = pdfMode.value;
    entry.isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (entry.outputFormat === 'pdf') {
      entry.name = uniqueOutputName(file.name, usedNames, '.pdf', '-compressed');
    } else if (!entry.isPdf) {
      entry.name = uniqueJpegName(file.name, usedNames);
    }
    entries.push(entry);
    rows.append(entry.row);
  }
  results.append(rows);
  counts.pending += files.length;
  refreshControls();
  void processQueue();
}

choose.addEventListener('click', () => filesInput.click());
for (const input of formatInputs) {
  input.addEventListener('change', () => {
    const pdf = input.value === 'pdf';
    outputTitle.textContent = pdf ? 'Make PDFs ' : 'Make JPEGs ';
    outputLimit.textContent = pdf ? 'under 198 KB' : 'under 200 KB';
    pdfOptions.hidden = !pdf;
    formatHelp.textContent = pdf
      ? 'PDF text and graphics are optimized first. Scanned pages keep 200 dpi or higher. Choose Black & white for clearer scanned text in a smaller file. This removes colors from scans.'
      : 'Each PDF page becomes a separate JPEG under 200 KB.';
  });
}
filesInput.addEventListener('change', () => {
  addFiles(filesInput.files);
  filesInput.value = '';
});

let dragDepth = 0;
for (const eventName of ['dragover', 'drop']) {
  window.addEventListener(eventName, event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault();
  });
}
dropzone.addEventListener('dragenter', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropzone.classList.remove('dragging');
});
dropzone.addEventListener('dragover', event => {
  if (event.dataTransfer.types.includes('Files')) event.dataTransfer.dropEffect = 'copy';
});
dropzone.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('dragging');
  addFiles(event.dataTransfer.files);
});

clear.addEventListener('click', () => {
  batch.abort();
  batch = new AbortController();
  for (const entry of entries.flatMap(item => item.pages ?? [item])) {
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  entries.length = 0;
  usedNames.clear();
  counts.pending = counts.ready = counts.failed = 0;
  results.replaceChildren();
  zipError.hidden = true;
  refreshControls();
  choose.focus();
});

zip.addEventListener('click', async () => {
  const ready = entries.flatMap(item => item.pages ?? [item]).filter(entry => entry.blob);
  zipError.hidden = true;
  zipping = true;
  refreshControls();
  try {
    const archive = await makeZip(ready);
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'image-desk-files.zip';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    zipError.textContent = error.message || 'The ZIP could not be created. Try again.';
    zipError.hidden = false;
  } finally {
    zipping = false;
    refreshControls();
  }
});
