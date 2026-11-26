import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPdfSettings, compressionProfiles, minimumPageDpi } from '../pdf-settings.mjs';
import { partitionPdf } from '../pdf-output.mjs';
import { checkPdfParts } from '../pdf-check.mjs';

test('deed and standard PDF limits remain separate', () => {
  assert.equal(getPdfSettings().byteLimit, 200_000);
  assert.equal(getPdfSettings().maximumParts, 4);
  assert.equal(getPdfSettings('deed').byteLimit, 498_000);
  assert.equal(getPdfSettings('deed').maximumParts, 2);
  assert.throws(() => getPdfSettings('unknown'));
});

test('deed packs pages that require separate standard PDF files', async () => {
  const encode = async (start, end) => new Blob([new Uint8Array(600 + (end-start+1)*210_000)]);
  const signal = new AbortController().signal;
  assert.equal(await partitionPdf(2, encode, signal), null);
  const parts = await partitionPdf(2, encode, signal, 2, 498_000);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].blob.size, 420_600);
});

test('deed limit is strict at 498000 bytes, including PDF overhead', async () => {
  const signal = new AbortController().signal;
  assert.equal(await partitionPdf(1, async () => new Blob([new Uint8Array(498_000)]), signal, 2, 498_000), null);
  assert.equal((await partitionPdf(1, async () => new Blob([new Uint8Array(497_999)]), signal, 2, 498_000))[0].blob.size, 497_999);
  await assert.rejects(checkPdfParts([{ blob: new Blob([new Uint8Array(498_000)], { type: 'application/pdf' }),
    pageStart: 1, pageEnd: 1 }], null, signal, () => {}, () => {}, Infinity, 498_000), /file-size/);
});

test('deed lower DPI preserves estimated text height and conservative unknown-text floor', () => {
  const policy = getPdfSettings('deed');
  assert.ok(compressionProfiles(policy).some(p => p.dpi === 100));
  assert.ok(compressionProfiles(getPdfSettings()).every(p => p.dpi >= 150));
  assert.equal(minimumPageDpi({ estimatedTextHeight: 18, referenceDpi: 200 }, policy, 100), 120);
  assert.equal(minimumPageDpi({ estimatedTextHeight: 10, referenceDpi: 200 }, policy, 100), 200);
  assert.equal(minimumPageDpi({ estimatedTextHeight: null }, policy, 100), 150);
});
