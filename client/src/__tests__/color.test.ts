import { describe, it, expect } from 'vitest';
import { hexToHsl, isValidHex, normaliseHex, contrastColor, darken, generateShadeScale } from '../lib/color';

describe('isValidHex', () => {
  it('accepts valid 6-digit lowercase hex', () => {
    expect(isValidHex('#4f46e5')).toBe(true);
  });

  it('accepts valid 6-digit uppercase hex', () => {
    expect(isValidHex('#4F46E5')).toBe(true);
  });

  it('accepts black and white', () => {
    expect(isValidHex('#000000')).toBe(true);
    expect(isValidHex('#ffffff')).toBe(true);
  });

  it('rejects 3-digit shorthand', () => {
    expect(isValidHex('#fff')).toBe(false);
  });

  it('rejects missing # prefix', () => {
    expect(isValidHex('4f46e5')).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(isValidHex('#xyz123')).toBe(false);
  });
});

describe('normaliseHex', () => {
  it('adds # prefix when missing', () => {
    expect(normaliseHex('4f46e5')).toBe('#4f46e5');
  });

  it('expands 3-digit shorthand to 6 digits', () => {
    expect(normaliseHex('#fff')).toBe('#ffffff');
    expect(normaliseHex('#abc')).toBe('#aabbcc');
  });

  it('lowercases the result', () => {
    expect(normaliseHex('#4F46E5')).toBe('#4f46e5');
  });

  it('passes through already-normalised hex', () => {
    expect(normaliseHex('#4f46e5')).toBe('#4f46e5');
  });

  it('trims whitespace', () => {
    expect(normaliseHex('  #4f46e5  ')).toBe('#4f46e5');
  });
});

describe('hexToHsl', () => {
  it('converts white to [0, 0, 100]', () => {
    expect(hexToHsl('#ffffff')).toEqual([0, 0, 100]);
  });

  it('converts black to [0, 0, 0]', () => {
    expect(hexToHsl('#000000')).toEqual([0, 0, 0]);
  });

  it('converts pure red to [0, 100, 50]', () => {
    expect(hexToHsl('#ff0000')).toEqual([0, 100, 50]);
  });

  it('converts pure green to [120, 100, 50]', () => {
    expect(hexToHsl('#00ff00')).toEqual([120, 100, 50]);
  });

  it('converts pure blue to [240, 100, 50]', () => {
    expect(hexToHsl('#0000ff')).toEqual([240, 100, 50]);
  });

  it('returns values in valid ranges', () => {
    const [h, s, l] = hexToHsl('#4f46e5');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(360);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(100);
  });
});

describe('contrastColor', () => {
  it('returns dark text on light backgrounds', () => {
    expect(contrastColor('#ffffff')).toBe('#1e1b4b');
    expect(contrastColor('#f5f5f5')).toBe('#1e1b4b');
  });

  it('returns white text on dark backgrounds', () => {
    expect(contrastColor('#000000')).toBe('#ffffff');
    expect(contrastColor('#1a1a2e')).toBe('#ffffff');
  });
});

describe('darken', () => {
  it('returns a darker color', () => {
    const [, , l1] = hexToHsl('#4f46e5');
    const darkened = darken('#4f46e5', 10);
    const [, , l2] = hexToHsl(darkened);
    expect(l2).toBeLessThan(l1);
  });

  it('returns a valid hex string', () => {
    expect(darken('#4f46e5')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('does not go below minimum lightness', () => {
    // Should not crash or return invalid hex for very dark input
    expect(darken('#000000', 50)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('generateShadeScale', () => {
  it('returns all 11 shade steps', () => {
    const scale = generateShadeScale('#4f46e5');
    const keys = Object.keys(scale).map(Number);
    expect(keys).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
  });

  it('returns hsl() strings', () => {
    const scale = generateShadeScale('#4f46e5');
    for (const value of Object.values(scale)) {
      expect(value).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    }
  });

  it('shade 50 is lighter than shade 900', () => {
    const scale = generateShadeScale('#4f46e5');
    const l50 = parseInt(scale[50].match(/(\d+)%\)$/)![1]);
    const l900 = parseInt(scale[900].match(/(\d+)%\)$/)![1]);
    expect(l50).toBeGreaterThan(l900);
  });
});
