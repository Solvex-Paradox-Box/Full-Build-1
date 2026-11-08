/**
 * Production Google OIDC routes (authorization, callback, logout).
 * OPT-IN: do not mount until production readiness is confirmed.
 * Cookie policy: Secure; HttpOnly; SameSite=Lax. No session token in JSON.
 * Logout and state-changing routes require origin allowlist + CSRF double-submit.
 */
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { AuthService } from './AuthService';
import type { SovereignRole } from './AuthService';
import { randomBytes } from 'node:crypto';

const SESSION_COOKIE = 'solvex_session';
const OIDC_STATE_COOKIE = 'solvex_oidc_state';
const CSRF_COOKIE = 'solvex_csrf';
const CSRF_HEADER = 'x-solvex-csrf';
const OIDC_STATE_MAX_AGE = 600;

export interface OidcRouterOptions {
  allowedOrigins: string[];
  resolveMembership: (identity: { sub: string; email: string }) => Promise<{
    userId: string; tenantId: string; role: SovereignRole;
  } | null>;
  postLogoutRedirectUri?: string;
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); }
      catch { return undefined; }
    }
  }
  return undefined;
}

function setSecureCookie(res: Response, name: string, value: string, maxAge: number): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearCookie(res: Response, name: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function originAllowed(req: Request, allowed: string[]): boolean {
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return false;
  try { return allowed.includes(new URL(origin).origin); }
  catch { return false; }
}

function requireOrigin(req: Request, allowed: string[]): boolean {
  return originAllowed(req, allowed);
}

function issueCsrfToken(res: Response): string {
  const token = randomBytes(24).toString('base64url');
  setSecureCookie(res, CSRF_COOKIE, token, 8 * 60 * 60);
  return token;
}

function requireCsrf(req: Request): boolean {
  const cookieToken = parseCookie(req.get('cookie'), CSRF_COOKIE);
  const headerToken = req.get(CSRF_HEADER) || (typeof (req as any).body?.csrf === 'string' ? (req as any).body.csrf : undefined);
  if (!cookieToken || !headerToken || cookieToken.length < 16) return false;
  if (cookieToken.length !== headerToken.length) return false;
  let mismatch = 0;
  for (let i = 0; i < cookieToken.length; i++) {
    mismatch |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  }
  return mismatch === 0;
}

export function createOidcAuthRouter(options: OidcRouterOptions): Router {
  const router = createRouter();
  const auth = AuthService.getInstance();

  router.get('/login', async (req, res) => {
    try {
      if (!requireOrigin(req, options.allowedOrigins)) {
        res.status(403).json({ error: 'BLOCKED: origin not allowed' });
        return;
      }
      if (!(await auth.isProductionReady())) {
        res.status(503).json({ error: 'BLOCKED: production authentication is not ready' });
        return;
      }
      const client = auth.getGoogleClient();
      if (!client) {
        res.status(503).json({ error: 'BLOCKED: Google OIDC client unavailable' });
        return;
      }
      const request = await client.createAuthorizationRequest();
      setSecureCookie(res, OIDC_STATE_COOKIE, JSON.stringify({
        state: request.state, nonce: request.nonce, codeVerifier: request.codeVerifier,
      }), OIDC_STATE_MAX_AGE);
      res.redirect(302, request.authorizationUrl);
    } catch (err) {
      res.status(500).json({ error: 'BLOCKED: failed to start OIDC login', detail: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/callback', async (req, res) => {
    try {
      if (!(await auth.isProductionReady())) {
        res.status(503).json({ error: 'BLOCKED: production authentication is not ready' });
        return;
      }
      const client = auth.getGoogleClient();
      if (!client) {
        res.status(503).json({ error: 'BLOCKED: Google OIDC client unavailable' });
        return;
      }
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const rawState = parseCookie(req.get('cookie'), OIDC_STATE_COOKIE);
      clearCookie(res, OIDC_STATE_COOKIE);
      if (!rawState || !code || !state) {
        res.status(400).json({ error: 'BLOCKED: missing code, state, or state cookie' });
        return;
      }
      let expected: { state: string; nonce: string; codeVerifier: string };
      try { expected = JSON.parse(rawState); }
      catch {
        res.status(400).json({ error: 'BLOCKED: corrupt state cookie' });
        return;
      }
      const identity = await client.handleCallback({
        code, state,
        expectedState: expected.state,
        expectedNonce: expected.nonce,
        codeVerifier: expected.codeVerifier,
      });
      const membership = await options.resolveMembership({ sub: identity.sub, email: identity.email });
      if (!membership) {
        res.status(403).json({ error: 'BLOCKED: no active tenant membership for this identity' });
        return;
      }
      const { token } = await auth.createProductionSession(identity, membership.tenantId, membership.role, membership.userId);
      setSecureCookie(res, SESSION_COOKIE, token, 8 * 60 * 60);
      issueCsrfToken(res);
      res.redirect(302, '/');
    } catch (err) {
      res.status(401).json({ error: 'BLOCKED: OIDC callback failed', detail: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/logout', async (req, res) => {
    if (!requireOrigin(req, options.allowedOrigins)) {
      res.status(403).json({ error: 'BLOCKED: origin not allowed' });
      return;
    }
    if (!requireCsrf(req)) {
      res.status(403).json({ error: 'BLOCKED: CSRF validation failed' });
      return;
    }
    const token = parseCookie(req.get('cookie'), SESSION_COOKIE);
    if (token) await auth.revokeProductionSession(token);
    clearCookie(res, SESSION_COOKIE);
    clearCookie(res, OIDC_STATE_COOKIE);
    clearCookie(res, CSRF_COOKIE);
    const client = auth.getGoogleClient();
    if (client && options.postLogoutRedirectUri) {
      const logoutUrl = await client.buildLogoutUrl(options.postLogoutRedirectUri);
      if (logoutUrl) { res.redirect(302, logoutUrl); return; }
    }
    res.status(204).end();
  });

  router.get('/status', async (_req, res) => {
    const readiness = await auth.evaluateReadiness();
    res.json({
      mode: readiness.mode,
      productionReady: readiness.productionReady,
      googleOidcConfigured: readiness.googleOidcConfigured,
      neonConnected: readiness.neonConnected,
      sessionStoreReady: readiness.sessionStoreReady,
      migrationPresent: readiness.migrationPresent,
      membershipAccessOk: readiness.membershipAccessOk,
      leastPrivilegeOk: readiness.leastPrivilegeOk,
      sessionPersistenceOk: readiness.sessionPersistenceOk,
      reasons: readiness.reasons,
    });
  });

  return router;
}

export function sessionTokenFromRequest(req: Request): string | undefined {
  return parseCookie(req.get('cookie'), SESSION_COOKIE);
}
