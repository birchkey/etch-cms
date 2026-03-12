import { describe, it, expect } from 'vitest';
import { cn, slugify, slugifyUnderscore } from '../lib/utils';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('filters falsy values', () => {
    expect(cn('foo', false && 'bar', undefined)).toBe('foo');
  });

  it('resolves Tailwind conflicts (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('handles conditional objects', () => {
    expect(cn({ 'font-bold': true, 'text-red-500': false })).toBe('font-bold');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips special characters', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('trims surrounding hyphens', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world');
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });
});

describe('slugifyUnderscore', () => {
  it('lowercases and underscores', () => {
    expect(slugifyUnderscore('Hello World')).toBe('hello_world');
  });

  it('converts hyphens to underscores', () => {
    expect(slugifyUnderscore('hello-world')).toBe('hello_world');
  });

  it('trims surrounding underscores', () => {
    expect(slugifyUnderscore('  Hello World  ')).toBe('hello_world');
  });
});
