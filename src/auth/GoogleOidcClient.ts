/**
 * Production Google OIDC client (authorization-code + PKCE S256).
 *
 * Uses openid-client for:
 * - Discovery + issuer validation
 * - JWKS signature verification
 * - State + nonce
 * - PKCE S256
 * - Audience / azp validation
 * - Verified email requirement
 *
 * Never falls back to the synthetic local OIDC provider.
 * Fail-closed if configuration or validation fails.
 */
import * as oidc from 'openid-client';
import { createHash, randomBytes } from 'node:crypto';

export interface GoogleOidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope?: string;
}

export interface OidcAuthorizationRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface VerifiedOidcIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  rawClaims: Record<string, unknown>;
}

export interface OidcCallbackInput {
  code: string;
  state: string;
  expectedState: string;
  expectedNonce: string;
  codeVerifier: string;
}

const GOOGLE_ISSUER = 'https://accounts.google.com';
const DEFAULT_SCOPE = 'openid email profile';

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

export function loadGoogleOidcConfig(): GoogleOidcConfig | null {
  const clientId = env('OIDC_CLIENT_ID') || env('GOOGLE_CLIENT_ID');
  const clientSecret = env('OIDC_CLIENT_SECRET') || env('GOOGLE_CLIENT_SECRET');
  const redirectUri = env('OIDC_REDIRECT_URI') || env('GOOGLE_REDIRECT_URI');
  const issuer = env('OIDC_ISSUER') || env('GOOGLE_OIDC_ISSUER') || GOOGLE_ISSUER;

  if (!clientId || !clientSecret || !redirectUri) return null;
  if (!redirectUri.startsWith('https://') && process.env.NODE_ENV === 'production') {
    return null;
  }
  return { issuer, clientId, clientSecret, redirectUri, scope: env('OIDC_SCOPE') || DEFAULT_SCOPE };
}

export class GoogleOidcClient {
  private config: GoogleOidcConfig;
  private configuration: oidc.Configuration | null = null;

  constructor(config: GoogleOidcConfig) {
    this.config = config;
  }

  async discover(): Promise<oidc.Configuration> {
    if (this.configuration) return this.configuration;

    const server = new URL(this.config.issuer);
    const configuration = await oidc.discovery(
      server,
      this.config.clientId,
      this.config.clientSecret,
    );

    const expectedIssuer = this.config.issuer.replace(/\/$/, '');
    const discoveredIssuer = String(configuration.serverMetadata().issuer || '').replace(/\/$/, '');
    if (discoveredIssuer !== expectedIssuer) {
      throw new Error(`BLOCKED: OIDC issuer mismatch (expected ${expectedIssuer}, got ${discoveredIssuer}).`);
    }

    this.configuration = configuration;
    return configuration;
  }

  async createAuthorizationRequest(): Promise<OidcAuthorizationRequest> {
    const configuration = await this.discover();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');

    const parameters: Record<string, string> = {
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope || DEFAULT_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      response_type: 'code',
    };

    const authorizationUrl = oidc.buildAuthorizationUrl(configuration, parameters).href;
    return { authorizationUrl, state, nonce, codeVerifier };
  }

  async handleCallback(input: OidcCallbackInput): Promise<VerifiedOidcIdentity> {
    if (input.state !== input.expectedState) {
      throw new Error('BLOCKED: OIDC state mismatch (possible CSRF).');
    }
    if (!input.code || typeof input.code !== 'string') {
      throw new Error('BLOCKED: missing authorization code.');
    }

    const configuration = await this.discover();
    const currentUrl = new URL(this.config.redirectUri);
    currentUrl.searchParams.set('code', input.code);
    currentUrl.searchParams.set('state', input.state);

    const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: input.codeVerifier,
      expectedState: input.expectedState,
      expectedNonce: input.expectedNonce,
      idTokenExpected: true,
    });

    const claims = tokens.claims();
    if (!claims) {
      throw new Error('BLOCKED: ID token claims missing after verification.');
    }

    return this.validateClaims(claims as Record<string, unknown>);
  }

  validateClaims(claims: Record<string, unknown>): VerifiedOidcIdentity {
    const now = Math.floor(Date.now() / 1000);
    const skew = 60;

    if (typeof claims.iss !== 'string' || claims.iss.replace(/\/$/, '') !== this.config.issuer.replace(/\/$/, '')) {
      throw new Error('BLOCKED: ID token issuer invalid.');
    }

    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.config.clientId)) {
      throw new Error('BLOCKED: ID token audience invalid.');
    }
    if (audiences.length > 1 && claims.azp !== this.config.clientId) {
      throw new Error('BLOCKED: ID token authorized-party (azp) invalid.');
    }

    if (typeof claims.exp !== 'number' || claims.exp <= now - skew) {
      throw new Error('BLOCKED: ID token expired.');
    }
    if (typeof claims.iat !== 'number' || claims.iat > now + skew) {
      throw new Error('BLOCKED: ID token issued-at invalid.');
    }

    if (typeof claims.sub !== 'string' || !claims.sub) {
      throw new Error('BLOCKED: ID token subject missing.');
    }

    if (typeof claims.email !== 'string' || !claims.email.includes('@')) {
      throw new Error('BLOCKED: verified email claim missing or invalid.');
    }
    if (claims.email_verified !== true && claims.email_verified !== 'true') {
      throw new Error('BLOCKED: email is not verified by the identity provider.');
    }

    return {
      sub: claims.sub,
      email: claims.email.toLowerCase().trim(),
      emailVerified: true,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      picture: typeof claims.picture === 'string' ? claims.picture : undefined,
      iss: claims.iss,
      aud: claims.aud as string | string[],
      exp: claims.exp,
      iat: claims.iat,
      rawClaims: claims,
    };
  }

  async buildLogoutUrl(postLogoutRedirectUri?: string): Promise<string | null> {
    try {
      const configuration = await this.discover();
      const meta = configuration.serverMetadata();
      const endSession = meta.end_session_endpoint;
      if (!endSession) {
        const url = new URL('https://accounts.google.com/Logout');
        if (postLogoutRedirectUri) url.searchParams.set('continue', postLogoutRedirectUri);
        return url.href;
      }
      const url = new URL(String(endSession));
      if (postLogoutRedirectUri) url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
      url.searchParams.set('client_id', this.config.clientId);
      return url.href;
    } catch {
      return null;
    }
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateOpaqueSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
