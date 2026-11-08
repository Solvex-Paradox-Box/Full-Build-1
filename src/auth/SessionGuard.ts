import { AuthService, type UserContext } from './AuthService';

export interface SessionContext extends UserContext {}

export interface SessionDecision {
  authenticated: boolean;
  authorized: boolean;
  status: 'BLOCKED' | 'UNAVAILABLE' | 'AUTHENTICATED';
  reason: string;
  session?: SessionContext;
}

/**
 * SessionGuard — every production decision is backed by a verified Neon session token.
 * A caller-supplied UserContext alone is never accepted.
 */
export class SessionGuard {
  /**
   * @param sessionToken Opaque session token from the Secure HttpOnly cookie.
   *                     Required in production; looked up against Neon on every call.
   */
  public static async requireVerifiedSession(
    sessionToken: string | null | undefined,
    action: string,
    targetTenantId?: string,
  ): Promise<SessionDecision> {
    if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length < 32) {
      return {
        authenticated: false,
        authorized: false,
        status: 'BLOCKED',
        reason: `BLOCKED: no verified session token for action "${action}".`,
      };
    }

    const decision = await AuthService.getInstance().requireVerifiedSession(
      sessionToken,
      action,
      targetTenantId,
    );

    return {
      authenticated: decision.authenticated,
      authorized: decision.authorized,
      status: decision.status,
      reason: decision.reason,
      session: decision.user,
    };
  }

  public static async isReadOnlyAllowed(
    sessionToken: string | null | undefined,
  ): Promise<SessionDecision> {
    return SessionGuard.requireVerifiedSession(sessionToken, 'VIEW_EVIDENCE');
  }
}
