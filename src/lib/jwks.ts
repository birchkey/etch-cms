import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cache JWKS fetcher instances by URL — persists across requests within the same Worker isolate
const jwksSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyExternalJWT(
  token: string,
  jwksUrl: string,
  issuer: string,
  audience?: string,
): Promise<boolean> {
  let jwks = jwksSets.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksSets.set(jwksUrl, jwks);
  }
  try {
    await jwtVerify(token, jwks, {
      issuer,
      ...(audience ? { audience } : {}),
    });
    return true;
  } catch {
    return false;
  }
}
