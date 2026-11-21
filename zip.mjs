import { BYTE_LIMIT } from './compress.mjs?v=4';
import { PDF_BYTE_LIMIT } from './pdf-output.mjs?v=4';

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// Outputs are already compressed, so ZIP entries use the stored method.
export async function makeZip(entries) {
  const maxOffset = 0xffffffff;
  if (entries.length >= 0xffff) throw new Error('Choose fewer than 65,535 files per ZIP.');
  const encoder = new TextEncoder();
  const localParts = [];
  const directoryParts = [];
  let offset = 0;
  let directorySize = 0;

  for (const { name, blob } of entries) {
    const limit = blob.type === 'application/pdf' ? PDF_BYTE_LIMIT : BYTE_LIMIT;
    if (!['application/pdf', 'image/jpeg'].includes(blob.type) || blob.size >= limit) {
      throw new Error('Each PDF must be under 198 KB and each JPEG under 200 KB.');
    }
    const filename = encoder.encode(name);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, filename.length, true);
    localParts.push(local.buffer, filename, blob);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(14, 0x21, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, bytes.length, true);
    central.setUint32(24, bytes.length, true);
    central.setUint16(28, filename.length, true);
    central.setUint32(42, offset, true);
    directoryParts.push(central.buffer, filename);

    offset += local.byteLength + filename.length + bytes.length;
    directorySize += central.byteLength + filename.length;
    if (offset + directorySize + 22 >= maxOffset) {
      throw new Error('This batch is too large for one ZIP. Try a smaller batch.');
    }
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...localParts, ...directoryParts, end.buffer], { type: 'application/zip' });
}
