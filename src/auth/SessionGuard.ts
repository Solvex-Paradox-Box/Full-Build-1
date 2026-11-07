import { AuthService, type UserContext } from './AuthService';

export interface SessionContext extends UserContext {}

export interface SessionDecision {
  authenticated: boolean;
  authorized: boolean;
  status: 'BLOCKED' | 'UNAVAILABLE' | 'AUTHENTICATED';
  reason: string;
  session?: SessionContext;
}

export class SessionGuard {
  public static requireVerifiedSession(session: SessionContext | null | undefined, action: string, targetTenantId?: string): SessionDecision {
    if (!session || !AuthService.getInstance().isActiveLocalOidcTestContext(session)) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: `BLOCKED: no live, verified OIDC session for action "${action}".`,
      };
    }

    const decision = AuthService.getInstance().authorize(session, action, targetTenantId);
    return {
      authenticated: true,
      authorized: decision.authorized,
      status: decision.authorized ? 'AUTHENTICATED' : 'BLOCKED',
      reason: decision.reason,
      session,
    };
  }

  public static isReadOnlyAllowed(_session: SessionContext | null | undefined): SessionDecision {
    return {
      authenticated: false,
      authorized: false,
      status: 'BLOCKED',
      reason: 'BLOCKED: read access requires a live verified session; public health/status reads remain separate.',
    };
  }
}
