import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthIdentity, FirstPartyRole } from './FirstPartyAuthService';

export interface TenantContextClaims {
  user_id: string;
  tenant_id: string;
  email: string;
  role: FirstPartyRole;
  issued_at: number;
  expires_at: number;
}

export interface TenantContextVerification {
  valid: boolean;
  claims?: TenantContextClaims;
  error?: string;
}

export const DATABASE_CONTEXT_MAX_TTL_MS = 15 * 60 * 1000;
const MAX_TOKEN_LENGTH = 8192;
const MAX_CLOCK_SKEW_MS = 30_000;
const ALLOWED_ROLES = new Set<FirstPartyRole>(['OWNER', 'ADMIN', 'VERIFIER', 'CUSTOMER']);

function sign(encodedClaims: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedClaims, 'utf8').digest('hex');
}

/**
 * Creates the short-lived HMAC claim token consumed by solvex_private.current_claims()
 * for PostgreSQL RLS. This is an internal database-context token, NOT a browser session
 * token; never return it to clients. It must be set with SET LOCAL app.auth_token inside
 * the same database transaction as tenant-scoped queries.
 */
export function createTenantContextToken(
  identity: AuthIdentity,
  secret: string,
  now = Date.now(),
  ttlMs = DATABASE_CONTEXT_MAX_TTL_MS,
): string {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('BLOCKED: SOVEREIGN_AUTH_SECRET must contain at least 32 characters.');
  }
  if (!Number.isFinite(now) || !Number.isSafeInteger(now)) throw new Error('Invalid issued-at time.');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > DATABASE_CONTEXT_MAX_TTL_MS) {
    throw new Error('Database context token TTL must be between 1 second and 15 minutes.');
  }
  if (!identity.userId.trim() || !identity.tenantId.trim() || !identity.email.trim() || !ALLOWED_ROLES.has(identity.role)) {
    throw new Error('BLOCKED: verified identity and tenant role are required.');
  }

  const claims: TenantContextClaims = {
    user_id: identity.userId,
    tenant_id: identity.tenantId,
    email: identity.email,
    role: identity.role,
    issued_at: now,
    expires_at: now + ttlMs,
  };
  // Standard Base64 is required because the database function uses decode(..., 'base64').
  const encodedClaims = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64');
  const token = `${encodedClaims}.${sign(encodedClaims, secret)}`;
  if (token.length > MAX_TOKEN_LENGTH) throw new Error('Database context token exceeds the database verifier limit.');
  return token;
}

/** Mirrors the validation rules in solvex_private.current_claims() without accessing the database. */
export function verifyTenantContextToken(
  token: string,
  secret: string,
  now = Date.now(),
): TenantContextVerification {
  if (typeof secret !== 'string' || secret.length < 32) return { valid: false, error: 'AUTH_SECRET_UNAVAILABLE' };
  if (typeof token !== 'string' || token.length < 16 || token.length > MAX_TOKEN_LENGTH ||
      (token.match(/\./g) || []).length !== 1) {
    return { valid: false, error: 'TOKEN_FORMAT_INVALID' };
  }

  const [encodedClaims, suppliedSignature] = token.split('.');
  if (!/^[0-9a-f]{64}$/.test(suppliedSignature)) return { valid: false, error: 'SIGNATURE_FORMAT_INVALID' };
  const expectedSignature = sign(encodedClaims, secret);
  const supplied = Buffer.from(suppliedSignature, 'hex');
  const expected = Buffer.from(expectedSignature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { valid: false, error: 'SIGNATURE_INVALID' };
  }

  let claims: TenantContextClaims;
  try {
    claims = JSON.parse(Buffer.from(encodedClaims, 'base64').toString('utf8')) as TenantContextClaims;
  } catch {
    return { valid: false, error: 'CLAIMS_INVALID' };
  }

  const issued = claims?.issued_at;
  const expires = claims?.expires_at;
  if (!claims || typeof claims.user_id !== 'string' || !claims.user_id ||
      typeof claims.tenant_id !== 'string' || !claims.tenant_id ||
      typeof claims.email !== 'string' || !claims.email ||
      !ALLOWED_ROLES.has(claims.role) ||
      typeof issued !== 'number' || !Number.isFinite(issued) ||
      typeof expires !== 'number' || !Number.isFinite(expires) ||
      issued > now + MAX_CLOCK_SKEW_MS || expires <= now || expires <= issued ||
      expires - issued > DATABASE_CONTEXT_MAX_TTL_MS) {
    return { valid: false, error: 'CLAIMS_REJECTED' };
  }

  return { valid: true, claims };
}
