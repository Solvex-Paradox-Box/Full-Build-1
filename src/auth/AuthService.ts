/**
 * Canonical Full-Build authentication boundary.
 *
 * Modes (fail-closed by default):
 * 1. local_oidc_test  – AUTH_MODE=local_oidc_test && NODE_ENV !== 'production'
 *    Short-lived in-memory sessions after openid-client PKCE validation (test only).
 * 2. production_oidc  – OIDC_ISSUER + OIDC_CLIENT_ID + OIDC_CLIENT_SECRET present
 *    Verified ID-token claims mapped to UserContext. Requires real Google (or other)
 *    credentials; never falls back to synthetic identities.
 * 3. first_party      – FirstPartyAuthService + Neon repository (session digests,
 *    invitation-only registration, tenant membership re-check). Wired when
 *    SOVEREIGN_AUTH_SECRET and Neon runtime login are configured.
 *
 * Production remains BLOCKED until the required environment variables and
 * Neon least-privilege role are supplied. Local synthetic OIDC never runs in
 * production.
 */
export type SovereignRole = 'OWNER' | 'ADMIN' | 'VERIFIER' | 'CUSTOMER';

export interface UserContext {
  user_id: string;
  tenant_id: string;
  email: string;
  role: SovereignRole;
  issued_at: number;
  /** Optional subject from the upstream OIDC provider */
  oidc_sub?: string;
}

type LocalSession = { user: UserContext; expiresAt: number };

const LOCAL_SESSION_TTL_MS = 5 * 60 * 1000;
const PRODUCTION_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 h default; refresh handled by OIDC
const LOCAL_ROLE_ACTIONS: Readonly<Record<string, readonly SovereignRole[]>> = {
  ORDER_TRANSITION: ['OWNER', 'ADMIN', 'CUSTOMER'],
  VIEW_EVIDENCE: ['OWNER', 'ADMIN', 'VERIFIER'],
  INVITE_USER: ['OWNER', 'ADMIN'],
  ADMIN_ACTION: ['OWNER', 'ADMIN'],
};
const VALID_ROLES = new Set<SovereignRole>(['OWNER', 'ADMIN', 'VERIFIER', 'CUSTOMER']);

function env(key: string): string | undefined {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function localOidcTestMode(): boolean {
  return env('AUTH_MODE') === 'local_oidc_test' && env('NODE_ENV') !== 'production';
}

function productionOidcConfigured(): boolean {
  // Accept either Google-style or generic OIDC_* names
  const issuer = env('OIDC_ISSUER') || env('GOOGLE_OIDC_ISSUER') || 'https://accounts.google.com';
  const clientId = env('OIDC_CLIENT_ID') || env('GOOGLE_CLIENT_ID');
  const clientSecret = env('OIDC_CLIENT_SECRET') || env('GOOGLE_CLIENT_SECRET');
  return Boolean(clientId && clientSecret && issuer);
}

function firstPartyConfigured(): boolean {
  const secret = env('SOVEREIGN_AUTH_SECRET');
  return typeof secret === 'string' && secret.length >= 32;
}

/**
 * Fail-closed auth boundary. Production identity verification and authorization
 * remain blocked until production OIDC credentials and/or first-party Neon
 * configuration are supplied. The local synthetic OIDC path is strictly for
 * automated testing.
 */
export class AuthService {
  private static instance: AuthService | null = null;
  private readonly localSessions = new Map<string, LocalSession>();
  private readonly tokenByContext = new WeakMap<UserContext, string>();
  /** Production opaque session tokens (token -> UserContext + expiry). In a multi-replica deploy these must be backed by Neon sessions. */
  private readonly productionSessions = new Map<string, LocalSession>();

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) AuthService.instance = new AuthService();
    return AuthService.instance;
  }

  /** Server-side development hook; never accepts caller input over HTTP. */
  public registerLocalOidcTestSession(token: string, source: UserContext): void {
    if (!localOidcTestMode()) {
      throw new Error('BLOCKED: local OIDC test sessions are unavailable outside non-production test mode.');
    }
    this.assertValidIdentity(source);
    if (typeof token !== 'string' || token.length < 32) {
      throw new Error('BLOCKED: malformed verified OIDC test identity.');
    }
    const user = Object.freeze({ ...source }) as UserContext;
    this.localSessions.set(token, { user, expiresAt: Date.now() + LOCAL_SESSION_TTL_MS });
    this.tokenByContext.set(user, token);
  }

  public revokeLocalOidcTestSession(token: string): void {
    if (!localOidcTestMode()) return;
    this.localSessions.delete(token);
  }

  public isActiveLocalOidcTestContext(user: UserContext | null | undefined): boolean {
    if (!localOidcTestMode() || !user) return false;
    const token = this.tokenByContext.get(user);
    if (!token) return false;
    const session = this.localSessions.get(token);
    if (!session || session.user !== user || session.expiresAt <= Date.now()) {
      this.localSessions.delete(token);
      return false;
    }
    return true;
  }

  /**
   * Register a production session after successful OIDC ID-token verification
   * and (when first-party is configured) Neon membership lookup.
   * Never call this from untrusted request handlers without prior JWKS verification.
   */
  public registerProductionSession(token: string, source: UserContext, ttlMs = PRODUCTION_SESSION_TTL_MS): void {
    if (!productionOidcConfigured() && !firstPartyConfigured()) {
      throw new Error('BLOCKED: production session registration requires OIDC or first-party configuration.');
    }
    if (env('NODE_ENV') === 'production' && localOidcTestMode()) {
      throw new Error('BLOCKED: local test mode must not be active in production.');
    }
    this.assertValidIdentity(source);
    if (typeof token !== 'string' || token.length < 32) {
      throw new Error('BLOCKED: production session token must be a high-entropy opaque string.');
    }
    const user = Object.freeze({ ...source }) as UserContext;
    this.productionSessions.set(token, { user, expiresAt: Date.now() + ttlMs });
    this.tokenByContext.set(user, token);
  }

  public revokeProductionSession(token: string): void {
    this.productionSessions.delete(token);
  }

  public isActiveProductionContext(user: UserContext | null | undefined): boolean {
    if (!user) return false;
    const token = this.tokenByContext.get(user);
    if (!token) return false;
    const session = this.productionSessions.get(token);
    if (!session || session.user !== user || session.expiresAt <= Date.now()) {
      this.productionSessions.delete(token);
      return false;
    }
    return true;
  }

  public createSignedToken(_userId: string, _tenantId: string, _email: string, _role: SovereignRole): string {
    throw new Error('BLOCKED: local token issuance is disabled; use the approved OIDC issuer or first-party session path.');
  }

  public verifyToken(token: string): { valid: boolean; user?: UserContext; error?: string } {
    if (typeof token !== 'string' || token.length < 32) {
      return { valid: false, error: 'INVALID_SESSION' };
    }

    // 1. Local synthetic OIDC test path
    if (localOidcTestMode()) {
      const session = this.localSessions.get(token);
      if (!session || session.expiresAt <= Date.now()) {
        this.localSessions.delete(token);
        return { valid: false, error: 'INVALID_OR_EXPIRED_SESSION' };
      }
      return { valid: true, user: session.user };
    }

    // 2. Production path (OIDC or first-party sessions)
    if (productionOidcConfigured() || firstPartyConfigured()) {
      const session = this.productionSessions.get(token);
      if (!session || session.expiresAt <= Date.now()) {
        this.productionSessions.delete(token);
        return { valid: false, error: 'INVALID_OR_EXPIRED_SESSION' };
      }
      // Fail-closed membership / claim checks
      if (!session.user.user_id || !session.user.tenant_id || !session.user.email || !VALID_ROLES.has(session.user.role)) {
        this.productionSessions.delete(token);
        return { valid: false, error: 'MALFORMED_IDENTITY' };
      }
      return { valid: true, user: session.user };
    }

    return { valid: false, error: 'BLOCKED: no configured production OIDC verifier or first-party session store is available.' };
  }

  public authorize(user: UserContext | null | undefined, action: string, targetTenantId?: string): { authorized: boolean; reason: string } {
    const active =
      (localOidcTestMode() && this.isActiveLocalOidcTestContext(user)) ||
      this.isActiveProductionContext(user);

    if (!user || !active) {
      return { authorized: false, reason: 'BLOCKED: verified session required.' };
    }
    if (targetTenantId && user.tenant_id !== targetTenantId) {
      return { authorized: false, reason: 'BLOCKED: tenant mismatch; cross-tenant access denied.' };
    }
    const roles = LOCAL_ROLE_ACTIONS[action];
    if (roles && !roles.includes(user.role)) {
      return { authorized: false, reason: 'BLOCKED: role does not permit this action.' };
    }
    // Unknown actions are denied (fail-closed)
    if (!roles) {
      return { authorized: false, reason: 'BLOCKED: action is not in the authorized policy set.' };
    }
    return { authorized: true, reason: 'AUTHORIZED: verified identity and tenant membership.' };
  }

  public requireVerifiedSession(session: UserContext | null | undefined, action: string, targetTenantId?: string): {
    authenticated: boolean;
    authorized: boolean;
    status: 'BLOCKED' | 'AUTHENTICATED';
    reason: string;
  } {
    const active =
      (localOidcTestMode() && this.isActiveLocalOidcTestContext(session)) ||
      this.isActiveProductionContext(session);

    if (!active) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: 'BLOCKED: no verified first-party or production OIDC session is available; production auth remains disabled until credentials and Neon membership are configured.',
      };
    }
    const decision = this.authorize(session, action, targetTenantId);
    return {
      authenticated: true,
      authorized: decision.authorized,
      status: decision.authorized ? 'AUTHENTICATED' : 'BLOCKED',
      reason: decision.reason,
    };
  }

  /** Configuration status for operators / readiness checks. Never exposes secrets. */
  public getAuthStatus(): {
    localOidcTest: boolean;
    productionOidcConfigured: boolean;
    firstPartyConfigured: boolean;
    mode: 'local_oidc_test' | 'production_ready' | 'blocked';
  } {
    const local = localOidcTestMode();
    const oidc = productionOidcConfigured();
    const fp = firstPartyConfigured();
    let mode: 'local_oidc_test' | 'production_ready' | 'blocked' = 'blocked';
    if (local) mode = 'local_oidc_test';
    else if (oidc || fp) mode = 'production_ready';
    return { localOidcTest: local, productionOidcConfigured: oidc, firstPartyConfigured: fp, mode };
  }

  private assertValidIdentity(source: UserContext): void {
    if (!source ||
        typeof source.user_id !== 'string' || !source.user_id ||
        typeof source.tenant_id !== 'string' || !source.tenant_id ||
        typeof source.email !== 'string' || !source.email ||
        !VALID_ROLES.has(source.role) ||
        !Number.isSafeInteger(source.issued_at)) {
      throw new Error('BLOCKED: malformed verified identity (subject, email, tenant, role or issued_at).');
    }
  }
}
