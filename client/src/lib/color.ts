/** Convert 6-digit hex to HSL tuple [h(0-360), s(0-100), l(0-100)] */
export function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Given any hex color as the "primary" (≈ shade 600), generate a full
 * 11-step scale (50–950) using relative lightness offsets and saturation scaling.
 * Returns CSS hsl() strings keyed by shade number.
 */
export function generateShadeScale(hex: string): Record<number, string> {
  const [h, s, inputL] = hexToHsl(hex);

  // Lightness offsets relative to the input color (treated as shade 600, ~L47)
  const DELTA_L: Record<number, number> = {
    50: 50, 100: 47, 200: 40, 300: 30, 400: 19, 500: 9,
    600: 0,
    700: -8, 800: -17, 900: -23, 950: -32,
  };
  // Saturation scale: lighter/darker extremes are less saturated
  const S_FACTOR: Record<number, number> = {
    50: 0.20, 100: 0.35, 200: 0.50, 300: 0.65, 400: 0.80, 500: 0.90,
    600: 1.00, 700: 1.00, 800: 0.95, 900: 0.85, 950: 0.75,
  };

  const result: Record<number, string> = {};
  for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
    const newL = Math.max(2, Math.min(98, inputL + DELTA_L[shade]));
    const newS = Math.round(s * S_FACTOR[shade]);
    result[shade] = `hsl(${h}, ${newS}%, ${newL}%)`;
  }
  return result;
}

export function isValidHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

/** Normalise 3-digit shorthand to 6-digit, ensure leading # */
export function normaliseHex(raw: string): string {
  let h = raw.trim();
  if (!h.startsWith('#')) h = '#' + h;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h.toLowerCase();
}

/** Apply a hex accent color to the document by overriding --color-indigo-* on <html>.
 *  Using element.style.setProperty gives inline-style priority, which wins
 *  regardless of how Tailwind compiled the CSS. */
export function applyAccentColor(hex: string) {
  const root = document.documentElement;

  if (!isValidHex(hex)) {
    // Clear overrides → fall back to Tailwind defaults
    for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      root.style.removeProperty(`--color-indigo-${shade}`);
    }
    return;
  }

  const scale = generateShadeScale(hex);
  for (const [shade, value] of Object.entries(scale)) {
    root.style.setProperty(`--color-indigo-${shade}`, value);
  }
}

// Quick-pick presets shipped with the Settings page
export const ACCENT_PRESETS = [
  { hex: '#4f46e5', label: 'Indigo' },
  { hex: '#7c3aed', label: 'Violet' },
  { hex: '#9333ea', label: 'Purple' },
  { hex: '#2563eb', label: 'Blue' },
  { hex: '#0284c7', label: 'Sky' },
  { hex: '#0d9488', label: 'Teal' },
  { hex: '#059669', label: 'Emerald' },
  { hex: '#e11d48', label: 'Rose' },
  { hex: '#db2777', label: 'Pink' },
  { hex: '#ea580c', label: 'Orange' },
  { hex: '#d97706', label: 'Amber' },
  { hex: '#0891b2', label: 'Cyan' },
] as const;

export function previewHex(hex: string): string {
  // Returns a preview swatch hex for display purposes
  return isValidHex(hex) ? hex : '#4f46e5';
}

/** Derive a foreground (white/black) for use on a given background hex */
export function contrastColor(hex: string): string {
  const [, , l] = hexToHsl(hex);
  return l > 55 ? '#1e1b4b' : '#ffffff';
}

/** Generate a lighter shade of the hex for button-hover equivalents */
export function darken(hex: string, amount = 8): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(2, l - amount));
}
