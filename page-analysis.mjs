export function otsuThreshold(histogram) {
  let total = 0;
  let sum = 0;
  for (let value = 0; value < 256; value++) {
    total += histogram[value];
    sum += value * histogram[value];
  }
  let leftCount = 0;
  let leftSum = 0;
  let bestScore = -1;
  let threshold = 170;
  for (let value = 0; value < 255; value++) {
    leftCount += histogram[value];
    leftSum += value * histogram[value];
    const rightCount = total - leftCount;
    if (!leftCount || !rightCount) continue;
    const difference = leftSum / leftCount - (sum - leftSum) / rightCount;
    const score = leftCount * rightCount * difference * difference;
    if (score > bestScore) {
      bestScore = score;
      threshold = value;
    }
  }
  return Math.max(100, Math.min(210, threshold));
}

export function analyzeCanvas(canvas, dpi = 200) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const histogram = new Uint32Array(256);
  const rowInk = new Uint32Array(height);
  let ink = 0;
  let color = 0;
  let edges = 0;
  let previous = new Uint8Array(width).fill(255);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      const gray = (red * 77 + green * 150 + blue * 29) >> 8;
      row[x] = gray;
      histogram[gray]++;
      if (gray < 180) {
        rowInk[y]++;
        ink++;
      }
      if (gray < 235 && Math.max(red, green, blue) - Math.min(red, green, blue) > 24) color++;
      if (x && y && Math.abs(gray - row[x - 1]) + Math.abs(gray - previous[x]) >= 32) edges++;
    }
    previous = row;
  }

  const heights = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const active = y < height && rowInk[y] > Math.max(3, width * 0.005) && rowInk[y] < width * 0.45;
    if (active && start < 0) start = y;
    if (!active && start >= 0) {
      const span = y - start;
      if (span >= 4 && span <= dpi * 0.4) heights.push(span);
      start = -1;
    }
  }
  heights.sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : null;
  const consistent = median
    ? heights.filter(value => value >= median * 0.7 && value <= median * 1.3).length / heights.length : 0;
  const printedText = heights.length >= 8 && consistent >= 0.6 && ink / (width * height) < 0.4;
  const textHeight = printedText ? heights[Math.floor(heights.length * 0.2)] : null;
  const minimumTextPixels = 10;
  const minimumDpi = textHeight
    ? Math.min(300, Math.max(150, Math.ceil((dpi * minimumTextPixels / textHeight) / 10) * 10)) : 180;
  const colorFraction = color / (width * height);
  return {
    referenceDpi: dpi,
    pageType: printedText ? 'printed-text' : 'mixed-or-handwritten',
    textLineCount: heights.length,
    estimatedTextHeight: textHeight,
    lineConsistency: Number(consistent.toFixed(3)),
    minimumDpi,
    inkFraction: Number((ink / (width * height)).toFixed(4)),
    edgeDensity: Number((edges / (width * height)).toFixed(4)),
    colorFraction: Number(colorFraction.toFixed(4)),
    recommendedMode: colorFraction < 0.025 ? 'monochrome' : 'color',
    thresholdMethod: printedText ? 'otsu' : 'adaptive',
    threshold: otsuThreshold(histogram),
  };
}
