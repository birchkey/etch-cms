import { describe, it, expect } from 'vitest';
import { slugify, slugifyUnderscore, parseFieldValue } from '../lib/utils';

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('collapses multiple separators to one hyphen', () => {
    expect(slugify('Hello  World!!!')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world');
  });

  it('preserves already-slugged strings', () => {
    expect(slugify('hello-world')).toBe('hello-world');
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('handles numbers', () => {
    expect(slugify('Post 42')).toBe('post-42');
  });
});

describe('slugifyUnderscore', () => {
  it('lowercases and underscores words', () => {
    expect(slugifyUnderscore('Hello World')).toBe('hello_world');
  });

  it('converts hyphens to underscores', () => {
    expect(slugifyUnderscore('hello-world')).toBe('hello_world');
  });

  it('trims leading and trailing underscores', () => {
    expect(slugifyUnderscore('  Field Name  ')).toBe('field_name');
  });

  it('collapses multiple separators', () => {
    expect(slugifyUnderscore('hello  world!!!')).toBe('hello_world');
  });
});

describe('parseFieldValue', () => {
  it('returns null for null input regardless of type', () => {
    expect(parseFieldValue(null, 'text')).toBeNull();
    expect(parseFieldValue(null, 'number')).toBeNull();
    expect(parseFieldValue(null, 'boolean')).toBeNull();
  });

  it('returns string as-is for text type', () => {
    expect(parseFieldValue('hello', 'text')).toBe('hello');
  });

  it('returns string as-is for rich_text type', () => {
    expect(parseFieldValue('<p>hello</p>', 'rich_text')).toBe('<p>hello</p>');
  });

  it('converts string to number for number type', () => {
    expect(parseFieldValue('42', 'number')).toBe(42);
    expect(parseFieldValue('3.14', 'number')).toBe(3.14);
  });

  it('converts "true"/"false" strings to booleans', () => {
    expect(parseFieldValue('true', 'boolean')).toBe(true);
    expect(parseFieldValue('false', 'boolean')).toBe(false);
  });

  it('parses JSON array for relation type', () => {
    expect(parseFieldValue('["id1","id2"]', 'relation')).toEqual(['id1', 'id2']);
  });

  it('returns string fallback for malformed relation JSON', () => {
    expect(parseFieldValue('not-json', 'relation')).toBe('not-json');
  });

  it('parses JSON array for multi-select', () => {
    expect(parseFieldValue('["Draft","Featured"]', 'select')).toEqual(['Draft', 'Featured']);
  });

  it('returns plain string for single select', () => {
    expect(parseFieldValue('Draft', 'select')).toBe('Draft');
  });
});
