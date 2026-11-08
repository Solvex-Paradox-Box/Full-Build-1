/**
 * Canonical Full-Build authentication boundary.
 *
 * Modes (explicit, fail-closed):
 *   AUTH_MODE=local_oidc_test  – synthetic local OIDC for automated tests only
 *                                (NODE_ENV must not be production)
 *   AUTH_MODE=production       – real Google OIDC + Neon session store
 *                                Requires successful readiness validation
 *   anything else / missing    – BLOCKED
 *
 * Production is NEVER considered ready merely because environment variables exist.
 * Ready requires: explicit AUTH_MODE=production, valid Google OIDC config,
 * Neon connectivity, and session-store probe success.
 */
import {
  GoogleOidcClient,
  loadGoogleOidcConfig,
  type VerifiedOidcIdentity,
} from './GoogleOidcClient';
import {
  NeonSessionStore,
  InMemorySessionStore,
  type SessionStore,
} from './NeonSessionStore';

export type SovereignRole = 'OWNER' | 'ADMIN' | 'VERIFIER' | 'CUSTOMER';

export interface UserContext {
  user_id: string;
  tenant_id: string;
  email: string;
  role: SovereignRole;
  issued_at: number;
  oidc_sub?: string;
}

const LOCAL_SESSION_TTL_MS = 5 * 60 * 1000;
const PRODUCTION_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ROLE_ACTIONS: Readonly<Record<string, readonly SovereignRole[]>> = {
  ORDER_TRANSITION: ['OWNER', 'ADMIN', 'CUSTOMER'],
  VIEW_EVIDENCE: ['OWNER', 'ADMIN', 'VERIFIER'],
  INVITE_USER: ['OWNER', 'ADMIN'],
  ADMIN_ACTION: ['OWNER', 'ADMIN'],
};
const VALID_ROLES = new Set<SovereignRole>(['OWNER', 'ADMIN', 'VERIFIER', 'CUSTOMER']);

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function authMode(): string {
  return (env('AUTH_MODE') || '').toLowerCase();
}

function isLocalOidcTestMode(): boolean {
  return authMode() === 'local_oidc_test' && env('NODE_ENV') !== 'production';
}

function isExplicitProductionMode(): boolean {
  return authMode() === 'production';
}

type LocalSession = { user: UserContext; expiresAt: number };

export interface AuthReadiness {
  mode: 'local_oidc_test' | 'production' | 'blocked';
  productionReady: boolean;
  reasons: string[];
  googleOidcConfigured: boolean;
  neonConnected: boolean;
  sessionStoreReady: boolean;
}

export class AuthService {
  private static instance: AuthService | null = null;
  private readonly localSessions = new Map<string, LocalSession>();
  private readonly tokenByContext = new WeakMap<UserContext, string>();
  private sessionStore: SessionStore | null = null;
  private googleClient: GoogleOidcClient | null = null;
  private readinessCache: AuthReadiness | null = null;
  private readinessCheckedAt = 0;

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) AuthService.instance = new AuthService();
    return AuthService.instance;
  }

  public setSessionStoreForTests(store: SessionStore | null): void {
    if (isExplicitProductionMode() && env('NODE_ENV') === 'production') {
      throw new Error('BLOCKED: cannot inject test session store in production.');
    }
    this.sessionStore = store;
    this.readinessCache = null;
  }

  public setGoogleClientForTests(client: GoogleOidcClient | null): void {
    if (isExplicitProductionMode() && env('NODE_ENV') === 'production') {
      throw new Error('BLOCKED: cannot inject test OIDC client in production.');
    }
    this.googleClient = client;
    this.readinessCache = null;
  }

  public async evaluateReadiness(): Promise<AuthReadiness> {
    const reasons: string[] = [];
    const mode = authMode();

    if (isLocalOidcTestMode()) {
      return {
        mode: 'local_oidc_test',
        productionReady: false,
        reasons: ['local_oidc_test mode active (not production)'],
        googleOidcConfigured: false,
        neonConnected: false,
        sessionStoreReady: false,
      };
    }

    if (!isExplicitProductionMode()) {
      return {
        mode: 'blocked',
        productionReady: false,
        reasons: [`AUTH_MODE is "${mode || '(unset)'}"; production requires AUTH_MODE=production`],
        googleOidcConfigured: false,
        neonConnected: false,
        sessionStoreReady: false,
      };
    }

    const oidcConfig = loadGoogleOidcConfig();
    const googleOidcConfigured = oidcConfig !== null;
    if (!googleOidcConfigured) {
      reasons.push('Google OIDC config incomplete (need CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)');
    }

    let neonConnected = false;
    let sessionStoreReady = false;
    if (!this.sessionStore) {
      this.sessionStore = NeonSessionStore.fromEnvironment();
    }
    if (!this.sessionStore) {
      reasons.push('DATABASE_URL / NEON_DATABASE_URL not set; Neon session store unavailable');
    } else {
      const probe = await this.sessionStore.probeConnectivity();
      neonConnected = probe.ok;
      sessionStoreReady = probe.ok;
      if (!probe.ok) {
        reasons.push(`Neon session store probe failed: ${probe.reason || 'unknown'}`);
      }
    }

    if (googleOidcConfigured && oidcConfig) {
      try {
        if (!this.googleClient) {
          this.googleClient = new GoogleOidcClient(oidcConfig);
        }
        await this.googleClient.discover();
      } catch (err) {
        reasons.push(`Google OIDC discovery failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const productionReady =
      googleOidcConfigured &&
      neonConnected &&
      sessionStoreReady &&
      reasons.length === 0;

    if (!productionReady && reasons.length === 0) {
      reasons.push('production readiness incomplete');
    }

    const result: AuthReadiness = {
      mode: productionReady ? 'production' : 'blocked',
      productionReady,
      reasons,
      googleOidcConfigured,
      neonConnected,
      sessionStoreReady,
    };
    this.readinessCache = result;
    this.readinessCheckedAt = Date.now();
    return result;
  }

  public async isProductionReady(): Promise<boolean> {
    if (this.readinessCache && Date.now() - this.readinessCheckedAt < 30_000) {
      return this.readinessCache.productionReady;
    }
    const r = await this.evaluateReadiness();
    return r.productionReady;
  }

  public registerLocalOidcTestSession(token: string, source: UserContext): void {
    if (!isLocalOidcTestMode()) {
      throw new Error('BLOCKED: local OIDC test sessions unavailable outside non-production test mode.');
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
    if (!isLocalOidcTestMode()) return;
    this.localSessions.delete(token);
  }

  public isActiveLocalOidcTestContext(user: UserContext | null | undefined): boolean {
    if (!isLocalOidcTestMode() || !user) return false;
    const token = this.tokenByContext.get(user);
    if (!token) return false;
    const session = this.localSessions.get(token);
    if (!session || session.user !== user || session.expiresAt <= Date.now()) {
      this.localSessions.delete(token);
      return false;
    }
    return true;
  }

  public async createProductionSession(
    identity: VerifiedOidcIdentity,
    tenantId: string,
    role: SovereignRole,
    userId: string,
    ttlMs = PRODUCTION_SESSION_TTL_MS,
  ): Promise<{ token: string; user: UserContext }> {
    if (!(await this.isProductionReady())) {
      throw new Error('BLOCKED: production authentication is not ready.');
    }
    if (!this.sessionStore) {
      throw new Error('BLOCKED: session store unavailable.');
    }
    if (!identity.emailVerified) {
      throw new Error('BLOCKED: email not verified by identity provider.');
    }
    if (!VALID_ROLES.has(role)) {
      throw new Error('BLOCKED: invalid role.');
    }

    const user: UserContext = Object.freeze({
      user_id: userId,
      tenant_id: tenantId,
      email: identity.email,
      role,
      issued_at: Date.now(),
      oidc_sub: identity.sub,
    });

    const { token } = await this.sessionStore.createSession(user, ttlMs);
    this.tokenByContext.set(user, token);
    return { token, user };
  }

  public async revokeProductionSession(token: string): Promise<boolean> {
    if (!this.sessionStore) return false;
    return this.sessionStore.revokeSession(token);
  }

  public createSignedToken(_userId: string, _tenantId: string, _email: string, _role: SovereignRole): string {
    throw new Error('BLOCKED: local token issuance is disabled; use Google OIDC + Neon session path.');
  }

  public async verifyToken(token: string): Promise<{ valid: boolean; user?: UserContext; error?: string }> {
    if (typeof token !== 'string' || token.length < 32) {
      return { valid: false, error: 'INVALID_SESSION' };
    }

    if (isLocalOidcTestMode()) {
      const session = this.localSessions.get(token);
      if (!session || session.expiresAt <= Date.now()) {
        this.localSessions.delete(token);
        return { valid: false, error: 'INVALID_OR_EXPIRED_SESSION' };
      }
      return { valid: true, user: session.user };
    }

    if (!isExplicitProductionMode()) {
      return { valid: false, error: 'BLOCKED: AUTH_MODE is not production.' };
    }
    if (!(await this.isProductionReady()) || !this.sessionStore) {
      return { valid: false, error: 'BLOCKED: production authentication is not ready.' };
    }

    const record = await this.sessionStore.findSessionByToken(token);
    if (!record) {
      return { valid: false, error: 'INVALID_OR_EXPIRED_SESSION' };
    }
    if (!VALID_ROLES.has(record.role)) {
      return { valid: false, error: 'MALFORMED_IDENTITY' };
    }

    const user: UserContext = Object.freeze({
      user_id: record.userId,
      tenant_id: record.tenantId,
      email: record.email,
      role: record.role,
      issued_at: record.createdAt,
      oidc_sub: record.oidcSub ?? undefined,
    });
    this.tokenByContext.set(user, token);
    return { valid: true, user };
  }

  public authorize(
    user: UserContext | null | undefined,
    action: string,
    targetTenantId?: string,
  ): { authorized: boolean; reason: string } {
    if (!user) {
      return { authorized: false, reason: 'BLOCKED: verified session required.' };
    }
    if (isLocalOidcTestMode() && !this.isActiveLocalOidcTestContext(user)) {
      return { authorized: false, reason: 'BLOCKED: verified session required.' };
    }
    if (targetTenantId && user.tenant_id !== targetTenantId) {
      return { authorized: false, reason: 'BLOCKED: tenant mismatch; cross-tenant access denied.' };
    }
    const roles = ROLE_ACTIONS[action];
    if (!roles) {
      return { authorized: false, reason: 'BLOCKED: action is not in the authorized policy set.' };
    }
    if (!roles.includes(user.role)) {
      return { authorized: false, reason: 'BLOCKED: role does not permit this action.' };
    }
    return { authorized: true, reason: 'AUTHORIZED: verified identity and tenant membership.' };
  }

  public async requireVerifiedSession(
    session: UserContext | null | undefined,
    action: string,
    targetTenantId?: string,
  ): Promise<{
    authenticated: boolean;
    authorized: boolean;
    status: 'BLOCKED' | 'AUTHENTICATED';
    reason: string;
  }> {
    if (!session) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: 'BLOCKED: no verified session available.',
      };
    }

    if (isLocalOidcTestMode()) {
      if (!this.isActiveLocalOidcTestContext(session)) {
        return {
          authenticated: false,
          authorized: false,
          status: 'BLOCKED',
          reason: 'BLOCKED: local OIDC test session inactive.',
        };
      }
    } else if (isExplicitProductionMode()) {
      if (!(await this.isProductionReady())) {
        return {
          authenticated: false,
          authorized: false,
          status: 'BLOCKED',
          reason: 'BLOCKED: production authentication is not ready.',
        };
      }
    } else {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: 'BLOCKED: AUTH_MODE does not enable authentication.',
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

  public getGoogleClient(): GoogleOidcClient | null {
    if (this.googleClient) return this.googleClient;
    const config = loadGoogleOidcConfig();
    if (!config) return null;
    this.googleClient = new GoogleOidcClient(config);
    return this.googleClient;
  }

  public getAuthStatus(): {
    mode: string;
    localOidcTest: boolean;
    explicitProduction: boolean;
  } {
    return {
      mode: authMode() || '(unset)',
      localOidcTest: isLocalOidcTestMode(),
      explicitProduction: isExplicitProductionMode(),
    };
  }

  private assertValidIdentity(source: UserContext): void {
    if (
      !source ||
      typeof source.user_id !== 'string' ||
      !source.user_id ||
      typeof source.tenant_id !== 'string' ||
      !source.tenant_id ||
      typeof source.email !== 'string' ||
      !source.email ||
      !VALID_ROLES.has(source.role) ||
      !Number.isSafeInteger(source.issued_at)
    ) {
      throw new Error('BLOCKED: malformed verified identity (subject, email, tenant, role or issued_at).');
    }
  }
}
