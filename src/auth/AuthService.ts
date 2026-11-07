export type SovereignRole = 'OWNER' | 'ADMIN' | 'VERIFIER' | 'CUSTOMER';

export interface UserContext {
  user_id: string;
  tenant_id: string;
  email: string;
  role: SovereignRole;
  issued_at: number;
}

type LocalSession = { user: UserContext; expiresAt: number };
const LOCAL_SESSION_TTL_MS = 5 * 60 * 1000;
const LOCAL_ROLE_ACTIONS: Readonly<Record<string, readonly SovereignRole[]>> = {
  ORDER_TRANSITION: ['OWNER', 'ADMIN', 'CUSTOMER'],
  VIEW_EVIDENCE: ['OWNER', 'ADMIN', 'VERIFIER'],
};
const VALID_ROLES = new Set<SovereignRole>(['OWNER', 'ADMIN', 'VERIFIER', 'CUSTOMER']);

function localOidcTestMode(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.AUTH_MODE === 'local_oidc_test' && env?.NODE_ENV !== 'production';
}

/**
 * Fail-closed auth boundary. Production identity verification and authorization
 * remain blocked. The only enabled path is a loopback-only OIDC test flow whose
 * server registers identities only after openid-client validates issuer,
 * signature, audience, expiry, nonce, state, and the PKCE code exchange.
 */
export class AuthService {
  private static instance: AuthService | null = null;
  private readonly localSessions = new Map<string, LocalSession>();
  private readonly tokenByContext = new WeakMap<UserContext, string>();

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
    if (typeof token !== 'string' || token.length < 32 ||
        !source || typeof source.user_id !== 'string' || !source.user_id ||
        typeof source.tenant_id !== 'string' || !source.tenant_id ||
        typeof source.email !== 'string' || !source.email ||
        !VALID_ROLES.has(source.role) || !Number.isSafeInteger(source.issued_at)) {
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

  public createSignedToken(_userId: string, _tenantId: string, _email: string, _role: SovereignRole): string {
    throw new Error('BLOCKED: local token issuance is disabled; use the approved OIDC issuer.');
  }

  public verifyToken(token: string): { valid: boolean; user?: UserContext; error?: string } {
    if (!localOidcTestMode()) {
      return { valid: false, error: 'BLOCKED: no configured production OIDC verifier is available.' };
    }
    if (typeof token !== 'string' || token.length < 32) {
      return { valid: false, error: 'INVALID_SESSION' };
    }
    const session = this.localSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.localSessions.delete(token);
      return { valid: false, error: 'INVALID_OR_EXPIRED_SESSION' };
    }
    return { valid: true, user: session.user };
  }

  public authorize(user: UserContext | null | undefined, action: string, targetTenantId?: string): { authorized: boolean; reason: string } {
    if (!user || !this.isActiveLocalOidcTestContext(user)) {
      return { authorized: false, reason: 'BLOCKED: verified OIDC session required.' };
    }
    if (targetTenantId && user.tenant_id !== targetTenantId) {
      return { authorized: false, reason: 'BLOCKED: tenant mismatch.' };
    }
    const roles = LOCAL_ROLE_ACTIONS[action];
    if (!roles || !roles.includes(user.role)) {
      return { authorized: false, reason: 'BLOCKED: action is not permitted by the local test policy.' };
    }
    return { authorized: true, reason: 'AUTHORIZED: local synthetic OIDC test policy.' };
  }

  public requireVerifiedSession(session: UserContext | null | undefined, action: string, targetTenantId?: string): {
    authenticated: boolean;
    authorized: boolean;
    status: 'BLOCKED' | 'AUTHENTICATED';
    reason: string;
  } {
    if (!this.isActiveLocalOidcTestContext(session)) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: 'BLOCKED: no verified first-party session is available; production auth remains disabled.',
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
}
