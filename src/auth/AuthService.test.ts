import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService, type UserContext } from './AuthService.ts';
import { SessionGuard } from './SessionGuard.ts';

const priorMode = process.env.AUTH_MODE;
const priorNodeEnv = process.env.NODE_ENV;
const auth = AuthService.getInstance();
const token = 'synthetic-session-token-'.padEnd(48, 'x');
const syntheticUser: UserContext = {
  user_id: 'test-customer',
  tenant_id: 'TENANT_DEV_A',
  email: 'customer@example.invalid',
  role: 'CUSTOMER',
  issued_at: Math.floor(Date.now() / 1000),
};

function setMode(mode: string, nodeEnv: string): void {
  process.env.AUTH_MODE = mode;
  process.env.NODE_ENV = nodeEnv;
}

test('local OIDC sessions are accepted only after registration and remain tenant/action scoped', () => {
  try {
    setMode('oidc', 'production');
    assert.throws(() => auth.registerLocalOidcTestSession(token, syntheticUser), /BLOCKED/);
    assert.equal(auth.verifyToken(token).valid, false);
    assert.equal(auth.authorize(syntheticUser, 'ORDER_TRANSITION', 'TENANT_DEV_A').authorized, false);

    setMode('local_oidc_test', 'development');
    auth.registerLocalOidcTestSession(token, syntheticUser);
    const verified = auth.verifyToken(token);
    assert.equal(verified.valid, true);
    assert.equal(verified.user?.user_id, 'test-customer');

    assert.equal(auth.authorize(verified.user, 'ORDER_TRANSITION', 'TENANT_DEV_A').authorized, true);
    assert.equal(auth.authorize(verified.user, 'ORDER_TRANSITION', 'TENANT_DEV_B').authorized, false);
    assert.equal(auth.authorize(verified.user, 'VIEW_EVIDENCE', 'TENANT_DEV_A').authorized, false);
    assert.equal(auth.authorize({ ...syntheticUser }, 'ORDER_TRANSITION', 'TENANT_DEV_A').authorized, false);

    const guard = SessionGuard.requireVerifiedSession(verified.user, 'ORDER_TRANSITION', 'TENANT_DEV_A');
    assert.equal(guard.authenticated, true);
    assert.equal(guard.authorized, true);
    assert.equal(guard.status, 'AUTHENTICATED');

    auth.revokeLocalOidcTestSession(token);
    assert.equal(auth.verifyToken(token).valid, false);
    assert.equal(SessionGuard.requireVerifiedSession(verified.user, 'ORDER_TRANSITION', 'TENANT_DEV_A').authenticated, false);

    setMode('oidc', 'production');
    assert.equal(auth.verifyToken(token).valid, false);
    assert.equal(auth.authorize(verified.user, 'ORDER_TRANSITION', 'TENANT_DEV_A').authorized, false);
    assert.throws(() => auth.createSignedToken('u', 't', 'e@example.invalid', 'CUSTOMER'), /BLOCKED/);
  } finally {
    if (priorMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = priorMode;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  }
});
