import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeZip } from '../zip.mjs';
const entry = (size, outputFormat = 'pdf', type = 'application/pdf') => ({
  name: 'Document.pdf', outputFormat, blob: new Blob([new Uint8Array(size)], { type }),
});

test('ZIP accepts deed files above 200 KB only in deed mode', async () => {
  const archive = await makeZip([entry(497_999, 'deed')]);
  assert.equal(archive.type, 'application/zip');
  assert.ok(archive.size > 497_999);
  await assert.rejects(makeZip([entry(250_000)]), /below 200 KB/);
});

test('ZIP applies strict independent limits to all three formats', async () => {
  await assert.rejects(makeZip([entry(498_000, 'deed')]), /below 498 KB/);
  await assert.rejects(makeZip([entry(200_000)]), /below 200 KB/);
  await assert.rejects(makeZip([entry(200_000, 'jpeg', 'image/jpeg')]), /below 200 KB/);
  assert.equal((await makeZip([entry(199_999), entry(199_999, 'jpeg', 'image/jpeg')])).type, 'application/zip');
});
