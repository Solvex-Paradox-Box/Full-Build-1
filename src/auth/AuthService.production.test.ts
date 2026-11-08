/**
 * Production authentication unit tests.
 * Run with: AUTH_MODE=production NODE_ENV=test tsx --test src/auth/AuthService.production.test.ts
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, type UserContext } from './AuthService';
import { InMemorySessionStore } from './NeonSessionStore';
import { GoogleOidcClient } from './GoogleOidcClient';

process.env.AUTH_MODE = 'production';
process.env.NODE_ENV = 'test';
process.env.OIDC_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.OIDC_CLIENT_SECRET = 'test-secret-value-not-real';
process.env.OIDC_REDIRECT_URI = 'https://app.example.com/auth/callback';
process.env.OIDC_ISSUER = 'https://accounts.google.com';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1/unused';

describe('AuthService production path', () => {
  let auth: AuthService;
  let store: InMemorySessionStore;

  beforeEach(() => {
    auth = AuthService.getInstance();
    store = new InMemorySessionStore();
    store.seedMembership('user-1', 'tenant-1', 'CUSTOMER', true);
    auth.setSessionStoreForTests(store);
  });

  it('blocks when AUTH_MODE is not production', async () => {
    const prev = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'something_else';
    const result = await auth.verifyToken('a'.repeat(40));
    process.env.AUTH_MODE = prev;
    assert.equal(result.valid, false);
    assert.match(result.error || '', /AUTH_MODE|BLOCKED/);
  });

  it('rejects short tokens', async () => {
    const result = await auth.verifyToken('short');
    assert.equal(result.valid, false);
    assert.equal(result.error, 'INVALID_SESSION');
  });

  it('creates and looks up a session via store', async () => {
    const user: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: Date.now(), oidc_sub: 'google-sub-123',
    };
    const { token } = await store.createSession(user, 60_000);
    assert.ok(token.length >= 32);
    const record = await store.findSessionByToken(token);
    assert.ok(record);
    assert.equal(record!.userId, 'user-1');
  });

  it('rejects expired sessions', async () => {
    let now = Date.now();
    const timedStore = new InMemorySessionStore(() => now);
    timedStore.seedMembership('user-1', 'tenant-1', 'CUSTOMER', true);
    const user: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: now,
    };
    const { token } = await timedStore.createSession(user, 1_000);
    now += 5_000;
    assert.equal(await timedStore.findSessionByToken(token), null);
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
      user_id: 'no-member', tenant_id: 'tenant-1', email: 'x@example.com',
      role: 'CUSTOMER', issued_at: Date.now(),
    };
    await assert.rejects(() => store.createSession(user, 60_000), /membership/i);
  });

  it('rejects inactive membership on lookup', async () => {
    store.seedMembership('user-2', 'tenant-1', 'CUSTOMER', true);
    const user: UserContext = {
      user_id: 'user-2', tenant_id: 'tenant-1', email: 'u2@example.com',
      role: 'CUSTOMER', issued_at: Date.now(),
    };
    const { token } = await store.createSession(user, 60_000);
    store.seedMembership('user-2', 'tenant-1', 'CUSTOMER', false);
    assert.equal(await store.findSessionByToken(token), null);
  });

  it('enforces cross-tenant denial', () => {
    const user: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: Date.now(),
    };
    const decision = auth.authorize(user, 'ORDER_TRANSITION', 'other-tenant');
    assert.equal(decision.authorized, false);
    assert.match(decision.reason, /tenant mismatch/i);
  });

  it('enforces role policy and unknown actions', () => {
    const customer: UserContext = {
      user_id: 'user-1', tenant_id: 'tenant-1', email: 'user@example.com',
      role: 'CUSTOMER', issued_at: Date.now(),
    };
    assert.equal(auth.authorize(customer, 'ADMIN_ACTION').authorized, false);
    assert.equal(auth.authorize(customer, 'ORDER_TRANSITION').authorized, true);
    assert.equal(auth.authorize({ ...customer, role: 'ADMIN' }, 'ADMIN_ACTION').authorized, true);
    assert.equal(auth.authorize({ ...customer, role: 'OWNER' }, 'UNKNOWN_ACTION').authorized, false);
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
