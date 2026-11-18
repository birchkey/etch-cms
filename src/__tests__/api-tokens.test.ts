import { describe, it, expect } from 'vitest';
import { generateApiToken, hashApiToken, tokenHint, API_TOKEN_PREFIX } from '../lib/api-tokens';

describe('generateApiToken', () => {
  it('starts with the prefix and is URL-safe', () => {
    const token = generateApiToken();
    expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^etch_[A-Za-z0-9_-]{40}$/);
  });

  it('is unique per call', () => {
    expect(generateApiToken()).not.toBe(generateApiToken());
  });
});

describe('hashApiToken', () => {
  it('is a deterministic hex SHA-256', async () => {
    const token = generateApiToken();
    const h = await hashApiToken(token);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashApiToken(token)).toBe(h);
  });

  it('differs for different tokens', async () => {
    expect(await hashApiToken('etch_a')).not.toBe(await hashApiToken('etch_b'));
  });
});

describe('tokenHint', () => {
  it('keeps the prefix plus four characters', () => {
    expect(tokenHint('etch_AbCdEfGh')).toBe('etch_AbCd');
  });
});
