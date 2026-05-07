export function generateId(): string {
  return crypto.randomUUID();
}

export function parseFieldValue(value: string | null, type: string): unknown {
  if (value === null) return null;
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';
  if (type === 'relation' || type === 'select' || type === 'image' || type === 'repeater') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

/** Slugify with hyphens — used for entry slugs */
export function slugify(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Slugify with underscores — used for content type and field slugs */
export function slugifyUnderscore(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Heuristic check for regex patterns that could cause catastrophic backtracking (ReDoS).
// Detects the most common form: a group containing a quantifier, itself followed by a quantifier
// e.g. (a+)+, (\w+)*, (a+|b+)+
export function isSafeRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }
  return !/\([^()]*[+*][^()]*\)[+*]/.test(pattern);
}

const ASSET_TTL_SECONDS = 3600; // 1 hour

export async function signAssetUrl(path: string, secret: string, ttlSeconds = ASSET_TTL_SECONDS): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await signPayload(`${path}:${expires}`, secret);
  return `${path}?expires=${expires}&sig=${sig}`;
}

export async function verifyAssetSignature(path: string, expires: string, sig: string, secret: string): Promise<boolean> {
  const exp = parseInt(expires, 10);
  if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await signPayload(`${path}:${exp}`, secret);
  return sig === expected;
}

export async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
