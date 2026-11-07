import { randomBytes, sign as cryptoSign, type KeyObject } from 'node:crypto';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import * as oidcClient from 'openid-client';
import { AuthService, type SovereignRole, type UserContext } from './src/auth/AuthService';
import {
  LOCAL_OIDC_CALLBACK,
  LOCAL_OIDC_CLIENT_ID,
  LOCAL_OIDC_CLIENT_SECRET,
  LOCAL_OIDC_ISSUER,
  startLocalOidcProvider,
} from './scripts/local-oidc-provider.mjs';

const APP_ORIGIN = 'http://127.0.0.1:3000';
const TRANSACTION_COOKIE = 'fullbuild_dev_oidc_tx';
const SESSION_COOKIE = 'fullbuild_dev_session';
const TRANSACTION_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_SECONDS = 300;
const TOKEN_TAMPER_MODES = new Set(['issuer', 'audience', 'expiration']);
const ALL_TEST_TAMPER_MODES = new Set([...TOKEN_TAMPER_MODES, 'signature', 'userinfo-sub']);
const pendingTransactions = new Map<string, {
  verifier: string;
  nonce: string;
  createdAt: number;
}>();

function assertDevOnly(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FULL-BUILD root server is a local development runtime; production startup is blocked.');
  }
  if (process.env.AUTH_MODE !== 'local_oidc_test') {
    throw new Error('Set AUTH_MODE=local_oidc_test only for local synthetic-account testing.');
  }
  if (process.env.HOST && process.env.HOST !== '127.0.0.1' && process.env.HOST !== 'localhost') {
    throw new Error('Local OIDC test runtime must bind to loopback only.');
  }
}

function readCookie(req: express.Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const equals = part.indexOf('=');
    if (equals < 0) continue;
    if (part.slice(0, equals).trim() === name) {
      try { return decodeURIComponent(part.slice(equals + 1).trim()); }
      catch { return undefined; }
    }
  }
  return undefined;
}

function setCookie(res: express.Response, name: string, value: string, maxAge: number): void {
  // Secure is omitted only because this server is forcibly loopback-only HTTP.
  // This cookie configuration is not suitable for any deployed environment.
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearCookie(res: express.Response, name: string): void {
  res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function validIdTokenClaims(claims: Record<string, unknown>): boolean {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  return claims.iss === LOCAL_OIDC_ISSUER &&
    typeof claims.sub === 'string' && claims.sub.length > 0 &&
    audiences.includes(LOCAL_OIDC_CLIENT_ID) &&
    (audiences.length <= 1 || claims.azp === LOCAL_OIDC_CLIENT_ID) &&
    typeof claims.exp === 'number' && claims.exp > now &&
    typeof claims.iat === 'number' && claims.iat <= now + 60;
}

function validUserInfoClaims(claims: Record<string, unknown>, expectedSubject: string): claims is Record<string, unknown> & {
  sub: string;
  email: string;
  email_verified: true;
  role: SovereignRole;
  tenant_id: string;
} {
  return claims.sub === expectedSubject &&
    typeof claims.email === 'string' && claims.email_verified === true &&
    typeof claims.tenant_id === 'string' && claims.tenant_id.length > 0 &&
    ['OWNER', 'ADMIN', 'VERIFIER', 'CUSTOMER'].includes(String(claims.role));
}

function tamperSignedIdToken(idToken: string, mode: string, signingKey: KeyObject): string {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Local test token was not a compact JWT.');
  if (mode === 'signature') {
    return `${parts[0]}.${parts[1]}.${parts[2].slice(0, -8)}`;
  }
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  if (mode === 'issuer') claims.iss = 'https://invalid-issuer.example.invalid';
  if (mode === 'audience') {
    claims.aud = 'unknown-test-client';
    delete claims.azp;
  }
  if (mode === 'expiration') claims.exp = Math.floor(Date.now() / 1000) - 300;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${parts[0]}.${payload}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(input), signingKey).toString('base64url');
  return `${input}.${signature}`;
}

function jsonResponseLike(response: Response, value: unknown): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
  return new Response(JSON.stringify(value), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function main(): Promise<void> {
  assertDevOnly();
  const tamperMode = process.env.OIDC_TEST_TAMPER ?? '';
  if (tamperMode && !ALL_TEST_TAMPER_MODES.has(tamperMode)) {
    throw new Error('Unrecognized local OIDC test tamper mode.');
  }
  const { server: issuerServer, signingPrivateKey } = await startLocalOidcProvider();
  let tampered = false;
  const localTestFetch = tamperMode ? async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const response = await fetch(input, init);
    if (tampered || !response.ok) return response;
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
    if (url.origin !== LOCAL_OIDC_ISSUER) return response;
    if (tamperMode === 'signature' && url.pathname === '/jwks') {
      const jwks = await response.clone().json() as { keys?: Array<Record<string, unknown>> };
      if (!Array.isArray(jwks.keys) || !jwks.keys[0]) throw new Error('Local test JWKS missing signing key.');
      jwks.keys[0].n = 'AA';
      tampered = true;
      return jsonResponseLike(response, jwks);
    }
    if (TOKEN_TAMPER_MODES.has(tamperMode) && url.pathname === '/token') {
      const tokenResponse = await response.clone().json() as Record<string, unknown>;
      if (typeof tokenResponse.id_token !== 'string') throw new Error('Local test token response missing ID token.');
      tokenResponse.id_token = tamperSignedIdToken(tokenResponse.id_token, tamperMode, signingPrivateKey);
      tampered = true;
      return jsonResponseLike(response, tokenResponse);
    }
    if (tamperMode === 'userinfo-sub' && url.pathname === '/me') {
      const userInfo = await response.clone().json() as Record<string, unknown>;
      userInfo.sub = 'different-subject';
      tampered = true;
      return jsonResponseLike(response, userInfo);
    }
    return response;
  } : undefined;
  const oidcConfig = await oidcClient.discovery(
    new URL(LOCAL_OIDC_ISSUER),
    LOCAL_OIDC_CLIENT_ID,
    LOCAL_OIDC_CLIENT_SECRET,
    undefined,
    {
      execute: [oidcClient.allowInsecureRequests],
      ...(localTestFetch ? { [oidcClient.customFetch]: localTestFetch } : {}),
    },
  );
  // openid-client separates claim validation from the application-level JWS
  // signature check; explicitly enable the latter before accepting tokens.
  oidcClient.enableNonRepudiationChecks(oidcConfig);
  const auth = AuthService.getInstance();
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/auth/login', async (_req, res, next) => {
    try {
      const state = oidcClient.randomState();
      const nonce = oidcClient.randomNonce();
      const verifier = oidcClient.randomPKCECodeVerifier();
      const challenge = await oidcClient.calculatePKCECodeChallenge(verifier);
      for (const [key, transaction] of pendingTransactions) {
        if (Date.now() - transaction.createdAt > TRANSACTION_TTL_MS) pendingTransactions.delete(key);
      }
      pendingTransactions.set(state, { verifier, nonce, createdAt: Date.now() });
      setCookie(res, TRANSACTION_COOKIE, state, 300);
      const url = oidcClient.buildAuthorizationUrl(oidcConfig, {
        redirect_uri: LOCAL_OIDC_CALLBACK,
        scope: 'openid profile email fullbuild',
        response_type: 'code',
        response_mode: 'query',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      res.redirect(302, url.href);
    } catch (error) { next(error); }
  });

  app.get('/auth/callback', async (req, res, next) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const transaction = pendingTransactions.get(state);
    pendingTransactions.delete(state);
    const transactionCookie = readCookie(req, TRANSACTION_COOKIE);
    clearCookie(res, TRANSACTION_COOKIE);
    if (!state || !transaction || transactionCookie !== state || Date.now() - transaction.createdAt > TRANSACTION_TTL_MS) {
      res.status(400).json({ error: 'OIDC_TRANSACTION_INVALID' });
      return;
    }
    try {
      const tokens = await oidcClient.authorizationCodeGrant(
        oidcConfig,
        new URL(req.originalUrl, APP_ORIGIN),
        {
          pkceCodeVerifier: transaction.verifier,
          expectedState: state,
          expectedNonce: transaction.nonce,
        },
      );
      const idTokenClaims = tokens.claims() as Record<string, unknown>;
      if (!validIdTokenClaims(idTokenClaims) || typeof tokens.access_token !== 'string') {
        res.status(401).json({ error: 'OIDC_IDENTITY_CLAIMS_INVALID' });
        return;
      }
      const userInfo = await oidcClient.fetchUserInfo(oidcConfig, tokens.access_token, String(idTokenClaims.sub));
      if (!validUserInfoClaims(userInfo, String(idTokenClaims.sub))) {
        res.status(401).json({ error: 'OIDC_USERINFO_CLAIMS_INVALID' });
        return;
      }
      const context: UserContext = {
        user_id: idTokenClaims.sub as string,
        tenant_id: userInfo.tenant_id,
        email: userInfo.email,
        role: userInfo.role,
        issued_at: Math.floor(Date.now() / 1000),
      };
      const sessionToken = randomBytes(32).toString('base64url');
      auth.registerLocalOidcTestSession(sessionToken, context);
      setCookie(res, SESSION_COOKIE, sessionToken, SESSION_TTL_SECONDS);
      res.redirect(303, '/');
    } catch (error) { next(error); }
  });

  app.get('/api/auth/session', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    const result = token ? auth.verifyToken(token) : { valid: false as const };
    if (!result.valid || !result.user) {
      res.status(401).json({ authenticated: false });
      return;
    }
    const { user_id, tenant_id, email, role } = result.user;
    res.json({ authenticated: true, user: { user_id, tenant_id, email, role } });
  });

  app.get('/api/auth/authorize', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    const result = token ? auth.verifyToken(token) : { valid: false as const };
    if (!result.valid || !result.user) {
      res.status(401).json({ authorized: false, error: 'UNAUTHENTICATED' });
      return;
    }
    const action = typeof req.query.action === 'string' ? req.query.action : '';
    const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : undefined;
    const decision = auth.authorize(result.user, action, tenantId);
    res.status(decision.authorized ? 200 : 403).json(decision);
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.get('origin') !== APP_ORIGIN) {
      res.status(403).json({ error: 'ORIGIN_CHECK_FAILED' });
      return;
    }
    const token = readCookie(req, SESSION_COOKIE);
    if (token) auth.revokeLocalOidcTestSession(token);
    clearCookie(res, SESSION_COOKIE);
    res.status(204).end();
  });

  const vite = await createViteServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[full-build-dev] request failed:', error instanceof Error ? error.message : 'unknown error');
    if (!res.headersSent) res.status(500).json({ error: 'LOCAL_AUTH_FLOW_FAILED' });
  });

  const appServer = app.listen(3000, '127.0.0.1', () => {
    console.log('[full-build-dev] app: http://127.0.0.1:3000');
    console.log(`[full-build-dev] local synthetic OIDC issuer: ${LOCAL_OIDC_ISSUER}`);
    console.log('[full-build-dev] login: /auth/login; test subjects: test-admin, test-customer, test-customer-b');
    console.log('[full-build-dev] production startup is intentionally blocked.');
  });

  const shutdown = async () => {
    await vite.close();
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => issuerServer.close(() => resolve()));
  };
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
}

void main().catch((error) => {
  console.error('[full-build-dev] startup blocked:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
