const settings = Object.freeze({
  pdf: Object.freeze({ id: 'pdf', byteLimit: 200_000, maximumParts: 4, lowestDpi: 150, limitLabel: '200 KB' }),
  deed: Object.freeze({ id: 'deed', byteLimit: 498_000, maximumParts: 2, lowestDpi: 100, limitLabel: '498 KB' }),
});

export function getPdfSettings(format = 'pdf') {
  if (!settings[format]) throw new Error('Unknown PDF output option.');
  return settings[format];
}

export function compressionProfiles(policy) {
  const profiles = [
    { dpi: 300, quality: 0.9 }, { dpi: 240, quality: 0.88 }, { dpi: 200, quality: 0.85 },
    { dpi: 180, quality: 0.82 }, { dpi: 160, quality: 0.78 }, { dpi: 150, quality: 0.76 },
  ];
  if (policy.id === 'deed') {
    profiles.push({ dpi: 140, quality: 0.74 }, { dpi: 130, quality: 0.72 },
      { dpi: 120, quality: 0.7 }, { dpi: 110, quality: 0.7 }, { dpi: 100, quality: 0.7 });
  }
  profiles.push(...[0.6, 0.45, 0.3].map(quality => ({ dpi: policy.lowestDpi, quality })));
  return profiles;
}

export function minimumPageDpi(analysis, policy, targetDpi) {
  if (policy.id !== 'deed') return targetDpi === 150 ? 150 : analysis.minimumDpi;
  // Retain at least 10 estimated pixels of text height. Unknown handwriting
  // and mixed pages keep a conservative 150 dpi floor. Decoded checks also apply.
  if (!analysis.estimatedTextHeight) return 150;
  return Math.min(300, Math.max(policy.lowestDpi,
    Math.ceil((analysis.referenceDpi * 10 / analysis.estimatedTextHeight) / 10) * 10));
}
