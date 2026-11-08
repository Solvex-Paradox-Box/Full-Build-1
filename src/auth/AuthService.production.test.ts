/**
 * Unit tests for production auth path (AUTH_MODE=production).
 * Uses InMemorySessionStore only — never real Neon in unit tests.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { AuthService, type UserContext } from './AuthService.ts';
import { InMemorySessionStore } from './NeonSessionStore.ts';
import { GoogleOidcClient } from './GoogleOidcClient.ts';

describe('AuthService production path', () => {
  const priorMode = process.env.AUTH_MODE;
  const priorNode = process.env.NODE_ENV;
  const priorDb = process.env.DATABASE_URL;
  const priorNeon = process.env.NEON_DATABASE_URL;
  const priorGid = process.env.GOOGLE_OIDC_CLIENT_ID;
  const priorGsec = process.env.GOOGLE_OIDC_CLIENT_SECRET;
  const priorGredir = process.env.GOOGLE_OIDC_REDIRECT_URI;
  let auth: AuthService;
  let store: InMemorySessionStore;

  beforeEach(() => {
    process.env.AUTH_MODE = 'production';
    process.env.NODE_ENV = 'test';
    process.env.GOOGLE_OIDC_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OIDC_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_OIDC_REDIRECT_URI = 'https://app.example.com/auth/callback';
    delete process.env.DATABASE_URL;
    delete process.env.NEON_DATABASE_URL;
    auth = AuthService.getInstance();
    store = new InMemorySessionStore();
    store.seedMembership('user-1', 'tenant-1', 'CUSTOMER', true);
    auth.setSessionStoreForTests(store);
  });

  afterEach(() => {
    auth.setSessionStoreForTests(null);
    auth.setGoogleClientForTests(null);
    if (priorMode === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = priorMode;
    if (priorNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNode;
    if (priorDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorDb;
    if (priorNeon === undefined) delete process.env.NEON_DATABASE_URL; else process.env.NEON_DATABASE_URL = priorNeon;
    if (priorGid === undefined) delete process.env.GOOGLE_OIDC_CLIENT_ID; else process.env.GOOGLE_OIDC_CLIENT_ID = priorGid;
    if (priorGsec === undefined) delete process.env.GOOGLE_OIDC_CLIENT_SECRET; else process.env.GOOGLE_OIDC_CLIENT_SECRET = priorGsec;
    if (priorGredir === undefined) delete process.env.GOOGLE_OIDC_REDIRECT_URI; else process.env.GOOGLE_OIDC_REDIRECT_URI = priorGredir;
  });

  it('blocks when AUTH_MODE is not production', async () => {
    process.env.AUTH_MODE = 'something_else';
    const r = await auth.verifyToken('a'.repeat(40));
    assert.equal(r.valid, false);
    assert.match(r.error || '', /AUTH_MODE|BLOCKED/i);
  });

  it('rejects short tokens', async () => {
    const r = await auth.verifyToken('short');
    assert.equal(r.valid, false);
  });

  it('creates and looks up a session via store', async () => {
    const user: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: Date.now(), oidc_sub: 'sub-1',
    };
    const { token } = await store.createSession(user, 60_000);
    assert.ok(token.length >= 32);
    const found = await store.findSessionByToken(token);
    assert.ok(found);
    assert.equal(found!.userId, 'user-1');
  });

  it('rejects expired sessions', async () => {
    let now = Date.now();
    const timed = new InMemorySessionStore(() => now);
    timed.seedMembership('user-1', 'tenant-1', 'CUSTOMER', true);
    const user: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: now,
    };
    const { token } = await timed.createSession(user, 60_000);
    now += 120_000;
    assert.equal(await timed.findSessionByToken(token), null);
  });

  it('rejects revoked sessions', async () => {
    const user: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: Date.now(),
    };
    const { token } = await store.createSession(user, 60_000);
    assert.equal(await store.revokeSession(token), true);
    assert.equal(await store.findSessionByToken(token), null);
  });

  it('rejects missing membership', async () => {
    const user: UserContext = {
      user_id: 'no-member', tenant_id: 'tenant-1', email: 'x@y.com',
      role: 'CUSTOMER', issued_at: Date.now(),
    };
    await assert.rejects(() => store.createSession(user, 60_000), /membership/i);
  });

  it('rejects inactive membership on lookup', async () => {
    store.seedMembership('user-1', 'tenant-1', 'CUSTOMER', true);
    const user: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: Date.now(),
    };
    const { token } = await store.createSession(user, 60_000);
    store.seedMembership('user-1', 'tenant-1', 'CUSTOMER', false);
    assert.equal(await store.findSessionByToken(token), null);
  });

  it('enforces cross-tenant denial via token-backed session', async () => {
    const decision = await auth.authorize(null, 'ORDER_TRANSITION', 'other-tenant');
    assert.equal(decision.authorized, false);
    assert.match(decision.reason, /token|session/i);
  });

  it('rejects authorize without a session token', async () => {
    const decision = await auth.authorize(null, 'ORDER_TRANSITION');
    assert.equal(decision.authorized, false);
    assert.match(decision.reason, /token|session/i);
  });

  it('rejects authorize with caller-supplied UserContext alone (no token)', async () => {
    const decision = await auth.authorize(undefined, 'ADMIN_ACTION');
    assert.equal(decision.authorized, false);
  });

  it('enforces role policy only after token verification', async () => {
    assert.equal((await auth.authorize('x' * 40, 'ORDER_TRANSITION')).authorized, false);
    assert.equal((await auth.authorize(null, 'ADMIN_ACTION')).authorized, false);
  });

  it('GoogleOidcClient validates claims fail-closed', () => {
    const client = new GoogleOidcClient({
      issuer: 'https://accounts.google.com',
      clientId: 'test-client-id.apps.googleusercontent.com',
      clientSecret: 'secret',
      redirectUri: 'https://app.example.com/auth/callback',
    });
    const base = {
      iss: 'https://accounts.google.com',
      aud: 'test-client-id.apps.googleusercontent.com',
      sub: 'sub-1', email: 'a@b.com', email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    assert.equal(client.validateClaims(base).email, 'a@b.com');
    assert.throws(() => client.validateClaims({ ...base, iss: 'https://evil.example' }), /issuer/i);
    assert.throws(() => client.validateClaims({ ...base, aud: 'wrong' }), /audience/i);
    assert.throws(() => client.validateClaims({ ...base, email_verified: false }), /email/i);
    assert.throws(() => client.validateClaims({ ...base, exp: Math.floor(Date.now()/1000) - 3600 }), /expired/i);
    assert.throws(() => client.validateClaims({ ...base, aud: [base.aud, 'other'] }), /azp|authorized-party/i);
  });

  it('evaluateReadiness does not report ready without Neon', async () => {
    process.env.AUTH_MODE = 'production';
    process.env.NODE_ENV = 'test';
    delete process.env.DATABASE_URL;
    delete process.env.NEON_DATABASE_URL;
    auth.setSessionStoreForTests(null);
    const readiness = await auth.evaluateReadiness();
    assert.equal(readiness.productionReady, false);
    assert.ok(readiness.reasons.length > 0);
  });

  it('multi-instance: sessions are store-backed', async () => {
    const storeA = new InMemorySessionStore();
    const storeB = new InMemorySessionStore();
    storeA.seedMembership('user-1', 'tenant-1', 'CUSTOMER', true);
    storeB.seedMembership('user-1', 'tenant-1', 'CUSTOMER', true);
    const user: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: Date.now(),
    };
    const { token } = await storeA.createSession(user, 60_000);
    assert.equal(await storeB.findSessionByToken(token), null);
    assert.ok(await storeA.findSessionByToken(token));
  });
});
