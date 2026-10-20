/*
 * IRANYekan font loader
 * ---------------------
 * Copy the IRANYekan font files (woff2 / woff / ttf / otf — any weights) into
 *     src/assets/fonts/iranyekan/
 * and build again (build-exe.bat does this). The files are discovered
 * automatically at build time, embedded into the single-file build (works
 * offline and inside the portable EXE) and mapped to CSS weights from their
 * names: Thin, UltraLight, Light, Regular, Medium, DemiBold, Bold, ExtraBold,
 * Black, ExtraBlack. "FaNum" variants are preferred and variable fonts are
 * supported. Without these files the embedded Vazirmatn font is used.
 */
const files = import.meta.glob('../assets/fonts/iranyekan/**/*.{woff2,woff,ttf,otf,WOFF2,WOFF,TTF,OTF}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function weightOf(base: string): string {
  const n = base
    .toLowerCase()
    .replace(/iran\s*yekan(x)?/g, '')
    .replace(/fa\s*num|farsi\s*num/g, '');
  if (/(^|[^a-z])(vf|variable)([^a-z]|$)|\[wght\]/.test(n)) return '100 1000';
  if (/extra\s*black|extrablack|heavy/.test(n)) return '950';
  if (/black/.test(n)) return '900';
  if (/extra\s*bold|ultra\s*bold/.test(n)) return '800';
  if (/semi\s*bold|demi\s*bold/.test(n)) return '600';
  if (/bold/.test(n)) return '700';
  if (/medium/.test(n)) return '500';
  if (/thin|hairline/.test(n)) return '100';
  if (/ultra\s*light|extra\s*light/.test(n)) return '200';
  if (/light/.test(n)) return '300';
  return '400';
}

export const hasIranYekan = Object.keys(files).length > 0;

export function loadAppFonts(): void {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  const best = new Map<string, { url: string; rank: number }>();
  for (const [path, url] of Object.entries(files)) {
    const name = path.split('/').pop() || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const fmt = ext === 'woff2' ? 3 : ext === 'woff' ? 2 : 1;
    const fanum = /fa\s*num|farsi\s*num/i.test(name) ? 10 : 0;
    const weight = weightOf(name.replace(/\.[^.]+$/, ''));
    const rank = fanum + fmt;
    const cur = best.get(weight);
    if (!cur || rank > cur.rank) best.set(weight, { url, rank });
  }
  let loaded = 0;
  for (const [weight, f] of best) {
    const face = new FontFace('IRANYekan', `url("${f.url}")`, { weight, style: 'normal', display: 'swap' });
    face
      .load()
      .then((ff) => {
        document.fonts.add(ff);
        if (++loaded === 1) document.documentElement.dataset.font = 'iranyekan';
      })
      .catch(() => console.warn('IRANYekan: font file could not be loaded', weight));
  }
}
