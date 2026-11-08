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
  public static requireVerifiedSession(
    session: SessionContext | null | undefined,
    action: string,
    targetTenantId?: string,
  ): SessionDecision {
    if (!session) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: `BLOCKED: no verified session for action "${action}".`,
      };
    }

    // Fail-closed on partial claims
    if (!session.user_id || !session.tenant_id || !session.email || !session.role) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: 'BLOCKED: session is partial or malformed (subject, email, tenant or role missing).',
      };
    }

    const auth = AuthService.getInstance();
    const decision = auth.requireVerifiedSession(session, action, targetTenantId);

    return {
      authenticated: decision.authenticated,
      authorized: decision.authorized,
      status: decision.status,
      reason: decision.reason,
      session: decision.authenticated ? session : undefined,
    };
  }

  public static isReadOnlyAllowed(session: SessionContext | null | undefined): SessionDecision {
    if (!session) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: 'BLOCKED: read access requires a live verified session; public health/status reads remain separate.',
      };
    }
    return SessionGuard.requireVerifiedSession(session, 'VIEW_EVIDENCE');
  }
}
