import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionPdf, PDF_BYTE_LIMIT, MAX_PDF_PARTS } from '../pdf-output.mjs';

async function pack(weights) {
  return partitionPdf(weights.length, async (start, end) => new Blob([
    new Uint8Array(600 + weights.slice(start - 1, end).reduce((sum, bytes) => sum + bytes, 0)),
  ], { type: 'application/pdf' }), new AbortController().signal);
}

test('combines adjacent pages when their actual PDF fits', async () => {
  const parts = await pack([87_000, 110_000]);
  assert.equal(parts.length, 1);
  assert.deepEqual([parts[0].pageStart, parts[0].pageEnd], [1, 2]);
});

test('includes PDF overhead and enforces a strict decimal 200 KB limit', async () => {
  assert.equal(PDF_BYTE_LIMIT, 200_000);
  assert.equal((await pack([99_700, 99_700])).length, 2);
  assert.equal(await pack([199_400]), null);
  assert.equal((await pack([199_399]))[0].blob.size, 199_999);
});

test('never returns more than four files', async () => {
  assert.equal(MAX_PDF_PARTS, 4);
  assert.equal(await pack(Array(5).fill(110_000)), null);
});

test('preserves every page in order with unequal page sizes', async () => {
  const weights = [87_000, 120_000, 24_000, 35_000, 125_000, 41_000, 38_000];
  const parts = await pack(weights);
  let next = 1;
  assert.ok(parts.length <= 4);
  for (const part of parts) {
    assert.equal(part.pageStart, next);
    assert.ok(part.blob.size < PDF_BYTE_LIMIT);
    next = part.pageEnd + 1;
  }
  assert.equal(next, weights.length + 1);
  for (let i = 1; i < parts.length; i++) {
    const combined = 600 + weights.slice(parts[i-1].pageStart-1, parts[i].pageEnd).reduce((a,b)=>a+b,0);
    assert.ok(combined >= PDF_BYTE_LIMIT, 'Adjacent parts should already be consolidated');
  }
});

test('honors cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(partitionPdf(1, async () => new Blob(), controller.signal), { name: 'AbortError' });
});


test('calculates an overflow count only when explicitly requested', async () => {
  const parts = await partitionPdf(7, async (start, end) => new Blob([
    new Uint8Array(600 + (end - start + 1) * 110_000),
  ], { type: 'application/pdf' }), new AbortController().signal, Infinity);
  assert.equal(parts.length, 7);
  assert.ok(parts.every(part => part.blob.size < PDF_BYTE_LIMIT));
});
