import { compressImage, uniqueJpegName } from './compress.mjs';
import { makeZip } from './zip.mjs';

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

const entries = [];
const usedNames = new Set();
const counts = { pending: 0, ready: 0, failed: 0 };
const sizeFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
let processing = false;
let zipping = false;

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
  zipLabel.textContent = zipping ? 'Preparing ZIP…' : 'Download ZIP';

  const messages = [];
  if (counts.ready) messages.push(counts.ready + ' ready');
  if (counts.pending) messages.push(counts.pending + ' processing');
  if (counts.failed) messages.push(counts.failed + ' failed');
  const status = messages.join(' · ') || 'JPEGs will appear here as they’re ready.';
  if (summary.textContent !== status) summary.textContent = status;
}

function createEntry(file) {
  const row = document.createElement('li');
  row.className = 'result';
  row.innerHTML = `
    <span class="thumb" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg></span>
    <div class="file-info"><p class="file-name"></p><p class="file-state">Waiting…</p></div>
  `;
  const name = uniqueJpegName(file.name, usedNames);
  const title = row.querySelector('.file-name');
  title.textContent = file.name;
  title.title = file.name;
  return { file, name, row, status: row.querySelector('.file-state') };
}

function showResult(entry, blob) {
  entry.blob = blob;
  entry.url = URL.createObjectURL(blob);
  const image = document.createElement('img');
  image.className = 'thumb';
  image.alt = '';
  image.src = entry.url;
  entry.row.querySelector('.thumb').replaceWith(image);
  entry.status.textContent = formatSize(entry.file.size) + ' → ' + formatSize(blob.size) + ' · JPEG';

  const link = document.createElement('a');
  link.className = 'button download';
  link.href = entry.url;
  link.download = entry.name;
  link.title = 'Download ' + entry.name;
  link.setAttribute('aria-label', link.title);
  link.append(zip.querySelector('svg').cloneNode(true));
  entry.row.append(link);
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    let entry;
    while ((entry = entries.find(item => item.file))) {
      entry.status.textContent = 'Compressing…';
      try {
        const blob = await compressImage(entry.file);
        if (!entry.row.isConnected) continue;
        showResult(entry, blob);
        counts.ready++;
      } catch (error) {
        if (!entry.row.isConnected) continue;
        entry.status.textContent = error.message || 'This file could not be compressed.';
        entry.status.classList.add('error');
        counts.failed++;
      } finally {
        entry.file = null;
        if (entry.row.isConnected) {
          counts.pending--;
          refreshControls();
        }
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
    const entry = createEntry(file);
    entries.push(entry);
    rows.append(entry.row);
  }
  results.append(rows);
  counts.pending += files.length;
  refreshControls();
  void processQueue();
}

choose.addEventListener('click', () => filesInput.click());
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
  for (const entry of entries) {
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
  const ready = entries.filter(entry => entry.blob);
  zipError.hidden = true;
  zipping = true;
  refreshControls();
  try {
    const archive = await makeZip(ready);
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'image-desk-jpegs.zip';
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
