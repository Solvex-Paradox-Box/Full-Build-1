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
  public static async requireVerifiedSession(
    session: SessionContext | null | undefined,
    action: string,
    targetTenantId?: string,
  ): Promise<SessionDecision> {
    if (!session) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: `BLOCKED: no verified session for action "${action}".`,
      };
    }

    if (!session.user_id || !session.tenant_id || !session.email || !session.role) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: 'BLOCKED: session is partial or malformed (subject, email, tenant or role missing).',
      };
    }

    const decision = await AuthService.getInstance().requireVerifiedSession(session, action, targetTenantId);

    return {
      authenticated: decision.authenticated,
      authorized: decision.authorized,
      status: decision.status,
      reason: decision.reason,
      session: decision.authenticated ? session : undefined,
    };
  }

  public static async isReadOnlyAllowed(session: SessionContext | null | undefined): Promise<SessionDecision> {
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
