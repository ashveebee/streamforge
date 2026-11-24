import { createHash, createPublicKey, randomBytes, verify as verifySig, type JsonWebKeyInput } from 'node:crypto';
import { cache } from '../lib/cache.js';
import { readPref, writePref } from '../lib/db.js';
import { requestJson, requestRaw, UpstreamError } from '../lib/http.js';
import { keyHint } from '../settings.js';

/*
 * Single sign-on with any OpenID Connect provider (Authentik, Authelia,
 * Keycloak, Pocket ID, Google, …): authorization code flow with PKCE.
 *
 * The signed-in identity is matched to a Jellyfin user by a claim
 * (preferred_username by default), compared case-insensitively with the
 * Jellyfin user name. Users that don't exist in Jellyfin can't sign in.
 * StreamForge then talks to Jellyfin for that user with the server API key,
 * so SSO needs a Jellyfin API key.
 */

export interface OidcSettings {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  label: string;
  claim: string;
  /** Hide the username/password form when SSO is on. */
  hidePassword: boolean;
}

const DEFAULTS: OidcSettings = { enabled: false, issuer: '', clientId: '', clientSecret: '', label: 'Single sign-on', claim: 'preferred_username', hidePassword: false };
let settings: OidcSettings = { ...DEFAULTS, ...readPref<Partial<OidcSettings>>('oidc', {}) };

export const oidcSettings = () => settings;
export const oidcReady = () => settings.enabled && !!settings.issuer && !!settings.clientId;
export function describeOidc() {
  const { clientSecret, ...rest } = settings;
  return { ...rest, clientSecretSet: !!clientSecret, clientSecretHint: keyHint(clientSecret) };
}
export function updateOidc(p: Partial<OidcSettings>) {
  settings = { ...settings, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) };
  writePref('oidc', settings);
  cache.delete('oidc:');
  return describeOidc();
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

export async function discover(issuer = settings.issuer) {
  const base = issuer.replace(/\/+$/, '');
  return cache.get(`oidc:discovery:${base}`, 60 * 60_000, async () => {
    const d = await requestJson<Discovery>(`${base}/.well-known/openid-configuration`, { service: 'oidc' });
    if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw new UpstreamError('The provider’s discovery document is incomplete', undefined, 'oidc');
    return d;
  });
}

/* ------------------------------ login flow ------------------------------ */

const flows = new Map<string, { verifier: string; nonce: string; redirectUri: string; expires: number }>();
const b64url = (b: Buffer) => b.toString('base64url');

export async function authorizeUrl(redirectUri: string) {
  const d = await discover();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const now = Date.now();
  for (const [k, f] of flows) if (f.expires < now) flows.delete(k);
  flows.set(state, { verifier, nonce, redirectUri, expires: now + 10 * 60_000 });
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: settings.clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();
  return u.toString();
}

type Jwk = JsonWebKeyInput['key'] & { kid?: string; alg?: string; use?: string };

const ALGS: Record<string, { hash: string; ec?: boolean; pss?: boolean }> = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  PS256: { hash: 'sha256', pss: true },
  ES256: { hash: 'sha256', ec: true },
  ES384: { hash: 'sha384', ec: true },
};

async function verifyIdToken(idToken: string, d: Discovery, nonce: string) {
  const [h, p, s] = idToken.split('.');
  if (!h || !p || !s) throw new Error('Malformed ID token');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg: string; kid?: string };
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
  const alg = ALGS[header.alg];
  if (!alg) throw new Error(`Unsupported signing algorithm ${header.alg}`);
  const jwks = await cache.get(`oidc:jwks:${d.jwks_uri}`, 60 * 60_000, () => requestJson<{ keys: Jwk[] }>(d.jwks_uri, { service: 'oidc' }));
  const jwk = jwks.keys.find((k) => (header.kid ? k.kid === header.kid : true) && (!k.use || k.use === 'sig'));
  if (!jwk) {
    cache.delete(`oidc:jwks:${d.jwks_uri}`);
    throw new Error('No matching signing key');
  }
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = verifySig(alg.hash, Buffer.from(`${h}.${p}`), alg.ec ? { key, dsaEncoding: 'ieee-p1363' } : alg.pss ? { key, padding: 6 } : key, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('Invalid ID token signature');
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== d.issuer) throw new Error('ID token issuer mismatch');
  if (!aud.includes(settings.clientId)) throw new Error('ID token audience mismatch');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new Error('ID token expired');
  if (claims.nonce !== nonce) throw new Error('ID token nonce mismatch');
  return claims;
}

/** Completes the flow and returns the identity's claims. */
export async function finishLogin(state: string, code: string) {
  const flow = flows.get(state);
  flows.delete(state);
  if (!flow || flow.expires < Date.now()) throw new Error('This sign-in link has expired. Try again.');
  const d = await discover();
  const res = await requestRaw(d.token_endpoint, {
    method: 'POST',
    service: 'oidc',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(settings.clientId)}:${encodeURIComponent(settings.clientSecret)}`).toString('base64')}`,
    },
    rawBody: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, code_verifier: flow.verifier, client_id: settings.clientId }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.id_token) throw new Error(body.error_description ?? body.error ?? `Token exchange failed (HTTP ${res.status})`);
  const claims = await verifyIdToken(body.id_token, d, flow.nonce);
  // Some providers only put profile claims in userinfo.
  if (claims[settings.claim] === undefined && d.userinfo_endpoint && body.access_token) {
    const info: Record<string, unknown> = await requestJson<Record<string, unknown>>(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${body.access_token}` }, service: 'oidc' }).catch(() => ({}));
    if (info.sub === claims.sub) Object.assign(claims, info);
  }
  const name = claims[settings.claim];
  if (typeof name !== 'string' || !name) throw new Error(`Your identity provider didn’t send “${settings.claim}”.`);
  return { name, sub: String(claims.sub) };
}
