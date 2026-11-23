const storageKey = 'image-desk-diagnostics-v1';
const maxJobs = 20;
const maxEvents = 1000;
let jobs = [];
let timer;
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(stored)) jobs = stored.slice(-maxJobs);
} catch {
  // Downloads still work when browser storage is unavailable.
}

function persist() {
  clearTimeout(timer);
  timer = null;
  try {
    let serialized = JSON.stringify(jobs);
    while (serialized.length > 2_000_000 && jobs.length > 1) {
      jobs.shift();
      serialized = JSON.stringify(jobs);
    }
    localStorage.setItem(storageKey, serialized);
  } catch {
    // Keep the current diagnostics in memory for Download logs.
  }
}

export function startDiagnosticJob(file, settings) {
  const job = {
    id: crypto.randomUUID(),
    appVersion: '9',
    startedAt: new Date().toISOString(),
    status: 'queued',
    input: { name: file.name, bytes: file.size, type: file.type },
    settings,
    events: [],
  };
  jobs.push(job);
  jobs = jobs.slice(-maxJobs);
  persist();
  let finished = false;
  return {
    id: job.id,
    record(event, details = {}) {
      if (finished) return;
      job.status = 'processing';
      job.events.push({ at: new Date().toISOString(), event, ...details });
      if (job.events.length > maxEvents) {
        job.events.shift();
        job.droppedEvents = (job.droppedEvents || 0) + 1;
      }
      if (!timer) timer = setTimeout(persist, 250);
    },
    finish(status, details = {}) {
      if (finished) return;
      finished = true;
      job.status = status;
      job.finishedAt = new Date().toISOString();
      job.result = details;
      persist();
    },
  };
}

export function diagnosticLogBlob() {
  persist();
  return new Blob([JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    jobs,
  }, null, 2)], { type: 'application/json' });
}
