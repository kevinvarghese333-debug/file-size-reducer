export const BYTE_LIMIT = 200_000;

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error();
    return image;
  } catch {
    throw new Error('This file could not be opened as an image in this browser.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob?.type === 'image/jpeg') resolve(blob);
      else reject(new Error('The browser could not create a JPEG for this image.'));
    }, 'image/jpeg', quality);
  });
}

export async function compressImage(file) {
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Image conversion is unavailable in this browser.');

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  let scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(12_000_000 / (width * height)));
  try {
    while (true) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const highQuality = await encode(canvas, 0.94);
      if (highQuality.size < BYTE_LIMIT) return highQuality;

      let low = 0.48;
      let high = 0.94;
      let best = await encode(canvas, low);
      if (best.size < BYTE_LIMIT) {
        for (let step = 0; step < 6; step++) {
          const quality = (low + high) / 2;
          const candidate = await encode(canvas, quality);
          if (candidate.size < BYTE_LIMIT) {
            best = candidate;
            low = quality;
          } else {
            high = quality;
          }
        }
        return best;
      }

      if (canvas.width === 1 && canvas.height === 1) break;
      scale *= Math.min(0.85, 0.95 * Math.sqrt(BYTE_LIMIT / best.size));
    }
    throw new Error('This image could not be compressed under 200 KB.');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function uniqueJpegName(original, usedNames) {
  const clean = original.normalize('NFC')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '');
  let stem = Array.from(clean).slice(0, 90).join('') || 'image';
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  let name = stem + '.jpg';
  let index = 2;
  while (usedNames.has(name.toLowerCase())) {
    name = stem + '-' + index + '.jpg';
    index++;
  }
  usedNames.add(name.toLowerCase());
  return name;
}
