import { compressImage, uniqueJpegName, uniqueOutputName } from './compress.mjs?v=10';
import { compressPdfFile, MAX_PDF_PARTS, PDF_BYTE_LIMIT } from './pdf-output.mjs?v=10';
import { openPdf, renderPdfPage } from './pdf.mjs?v=10';
import { makeZip } from './zip.mjs?v=10';
import { startDiagnosticJob, diagnosticLogBlob } from './diagnostics.mjs?v=10';

const choose = document.querySelector('#choose');
const filesInput = document.querySelector('#files');
const dropzone = document.querySelector('#dropzone');
const summary = document.querySelector('#summary');
const empty = document.querySelector('#empty');
const results = document.querySelector('#results');
const clear = document.querySelector('#clear');
const retry = document.querySelector('#retry');
const zip = document.querySelector('#zip');
const zipLabel = zip.querySelector('span');
const zipError = document.querySelector('#zip-error');
const formatInputs = document.querySelectorAll('[name="output-format"]');
const formatHelp = document.querySelector('#format-help');
const outputTitle = document.querySelector('#output-title');
const outputLimit = document.querySelector('#output-limit');
const pdfOptions = document.querySelector('#pdf-options');
const pdfMode = document.querySelector('#pdf-mode');
const downloadLogs = document.querySelector('#download-logs');

const entries = [];
const usedNames = new Set();
const counts = { pending: 0, ready: 0, failed: 0, awaiting: 0, skipped: 0 };
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
  retry.hidden = counts.failed === 0;
  retry.disabled = zipping || counts.pending > 0;
  pdfMode.disabled = zipping;
  for (const input of formatInputs) input.disabled = zipping;
  zip.disabled = !counts.ready || counts.pending > 0 || counts.awaiting > 0 || zipping;
  zipLabel.textContent = zipping ? 'Preparing ZIP…' : 'Download all (ZIP)';

  const messages = [];
  if (counts.ready) messages.push(counts.ready + ' ready');
  if (counts.pending) messages.push(counts.pending + ' processing');
  if (counts.awaiting) messages.push(counts.awaiting + ' awaiting decision');
  if (counts.skipped) messages.push(counts.skipped + ' skipped');
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
  if (isPdf) {
    const preview = document.createElement('a');
    preview.className = 'button preview';
    preview.href = entry.url;
    preview.target = '_blank';
    preview.rel = 'noopener';
    preview.textContent = 'Preview';
    preview.setAttribute('aria-label', 'Preview ' + entry.name);
    entry.row.append(preview);
  }
  entry.row.append(link);
}

function reportFailure(entry, message) {
  const mode = entry.outputFormat === 'pdf'
    ? ({ auto: 'Automatic', monochrome: 'Black & white', color: 'Original colors' }[entry.pdfMode]) : '';
  const context = entry.pageLabel || mode;
  entry.status.textContent = (context ? context + ' · ' : '') + message;
  entry.status.classList.add('error');
  counts.failed++;
  entry.log?.record('output_failed', { page: entry.pageNumber, reason: message });
  if (entry.sourceFile) entry.log.finish('failed', { reason: message });
}

async function processOutput(entry, convert, signal, errorMessage) {
  entry.status.textContent = entry.pageLabel ? entry.pageLabel + ' · Converting…' : 'Compressing…';
  try {
    const blob = await convert();
    if (signal.aborted) return;
    showResult(entry, blob);
    counts.ready++;
    entry.log?.record('jpeg_ready', { page: entry.pageNumber || 1, bytes: blob.size });
    if (entry.sourceFile) entry.log.finish('completed', { outputs: [{ name: entry.name, bytes: blob.size }] });
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
      page.pageNumber = number;
      page.log = entry.log;
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
    if (!signal.aborted) {
      entry.log.finish(entry.pages?.some(page => !page.blob) ? 'partial' : 'completed', {
        outputs: (entry.pages || []).filter(page => page.blob).map(page => ({ name: page.name, bytes: page.blob.size })),
      });
    }
  }
}

function presentPdfResult(entry, result) {
  if (result.parts.length === 1) {
    entry.pageCount = result.pageCount;
    entry.detail = result.parts[0].detail + ' · Output checks passed';
    showResult(entry, result.parts[0].blob);
  } else {
    const rows = document.createDocumentFragment();
    const digits = String(result.pageCount).length;
    const partDigits = Math.max(2, String(result.parts.length).length);
    entry.pages = result.parts.map((part, index) => {
      const start = String(part.pageStart).padStart(digits, '0');
      const end = String(part.pageEnd).padStart(digits, '0');
      const suffix = '-part-' + String(index + 1).padStart(partDigits, '0') + '-of-' +
        String(result.parts.length).padStart(partDigits, '0') + '-pages-' + start + '-' + end;
      const name = uniqueOutputName(entry.sourceFile.name, usedNames, '.pdf', suffix);
      const output = createEntry(name);
      output.name = name;
      output.pageLabel = 'Part ' + (index + 1) + ' of ' + result.parts.length +
        ' · Pages ' + part.pageStart + '–' + part.pageEnd;
      output.pageCount = part.pageEnd - part.pageStart + 1;
      output.detail = part.detail + ' · Output checks passed';
      showResult(output, part.blob);
      rows.append(output.row);
      return output;
    });
    entry.row.replaceWith(rows);
  }
  counts.ready += result.parts.length;
  entry.log.finish('completed', { pageCount: result.pageCount, partCount: result.parts.length,
    outputs: result.parts.map((part, index) => ({
      name: entry.pages ? entry.pages[index].name : entry.name,
      pageStart: part.pageStart, pageEnd: part.pageEnd, bytes: part.blob.size,
      detail: part.detail, detailRetention: part.detailRetention,
    })) });
}

function requestPdfApproval(entry, result, signal) {
  entry.pendingResult = result;
  counts.awaiting++;
  const count = result.parts.length;
  entry.status.textContent = count + ' PDFs are needed at the checked settings, each below 200 KB. This exceeds the default of 4. Proceed?';
  entry.log.record('approval_requested', { partCount: count, pageCount: result.pageCount,
    parts: result.parts.map(part => ({ pageStart: part.pageStart, pageEnd: part.pageEnd, bytes: part.blob.size })) });
  const proposal = document.createElement('div');
  proposal.className = 'pdf-approval';
  const list = document.createElement('ol');
  for (const part of result.parts) {
    const item = document.createElement('li');
    item.textContent = 'Pages ' + part.pageStart + '–' + part.pageEnd + ' · ' + formatSize(part.blob.size);
    list.append(item);
  }
  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  const proceed = document.createElement('button');
  proceed.className = 'button primary';
  proceed.type = 'button';
  proceed.textContent = 'Proceed with ' + count + ' PDFs';
  const cancel = document.createElement('button');
  cancel.className = 'button outline';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  function decide(approved) {
    if (signal.aborted || !entry.pendingResult) return;
    entry.pendingResult = null;
    counts.awaiting--;
    proposal.remove();
    if (approved) {
      entry.log.record('approval_accepted', { partCount: count });
      presentPdfResult(entry, result);
    } else {
      counts.skipped++;
      entry.status.textContent = 'Cancelled. No files were made available.';
      entry.log.record('approval_declined', { partCount: count });
      entry.log.finish('declined', { proposedPartCount: count });
    }
    refreshControls();
  }
  proceed.addEventListener('click', () => decide(true));
  cancel.addEventListener('click', () => decide(false));
  actions.append(proceed, cancel);
  proposal.append(list, actions);
  entry.row.querySelector('.file-info').append(proposal);
}

async function processPdfDownloads(entry, signal) {
  try {
    const result = await compressPdfFile(entry.file, entry.isPdf, signal, message => {
      if (!signal.aborted) entry.status.textContent = message;
    }, entry.pdfMode, entry.log.record);
    if (signal.aborted) return;

    if (result.requiresApproval) requestPdfApproval(entry, result, signal);
    else presentPdfResult(entry, result);
  } catch (error) {
    if (!signal.aborted) reportFailure(entry, error.message || 'This PDF could not be prepared.');
  } finally {
    if (!signal.aborted) {
      counts.pending--;
      refreshControls();
    }
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
          await processPdfDownloads(entry, signal);
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
    entry.sourceFile = file;
    entry.file = file;
    entry.outputFormat = document.querySelector('[name="output-format"]:checked').value;
    entry.pdfMode = pdfMode.value;
    entry.log = startDiagnosticJob(file, { format: entry.outputFormat, appearance: entry.pdfMode,
      maximumPdfParts: MAX_PDF_PARTS, maximumPdfBytes: PDF_BYTE_LIMIT });
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
    outputLimit.textContent = 'under 200 KB';
    pdfOptions.hidden = !pdf;
    formatHelp.textContent = pdf
      ? 'Automatic analyzes each page and may use black & white for text scans. It tries 150 dpi when needed and combines pages into as few PDFs as possible, each below 200 KB. If more than 4 are needed, it shows the checked file count and asks you to proceed or cancel. Conversion stops if size and detail checks cannot be met. Preview handwriting and stamps before use.'
      : 'Each PDF page becomes a separate JPEG under 200 KB.';
    reprocessFiles();
  });
}
pdfMode.addEventListener('change', reprocessFiles);
retry.addEventListener('click', reprocessFiles);
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

function clearEntries() {
  batch.abort();
  batch = new AbortController();
  for (const entry of entries) {
    entry.pendingResult = null;
    entry.log.finish('cancelled', { reason: 'Files cleared or settings changed' });
  }
  for (const entry of entries.flatMap(item => item.pages ?? [item])) {
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  entries.length = 0;
  usedNames.clear();
  counts.pending = counts.ready = counts.failed = counts.awaiting = counts.skipped = 0;
  results.replaceChildren();
  zipError.hidden = true;
  refreshControls();
}

function reprocessFiles() {
  const files = entries.map(entry => entry.sourceFile);
  if (!files.length || zipping) return;
  clearEntries();
  addFiles(files);
}

clear.addEventListener('click', () => {
  clearEntries();
  choose.focus();
});

downloadLogs.addEventListener('click', () => {
  const url = URL.createObjectURL(diagnosticLogBlob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'image-desk-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
