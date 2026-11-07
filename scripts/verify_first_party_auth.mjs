import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const auth = read('src/auth/AuthService.ts');
const sessionGuard = read('src/auth/SessionGuard.ts');
const api = read('src/api/ApiRouter.ts');

assert.match(auth, /throw new Error\('BLOCKED: local token issuance is disabled/,
  'AuthService must reject local token issuance.');
assert.match(auth, /valid: false, error: 'BLOCKED: no configured production OIDC verifier is available\./,
  'AuthService must reject unverified tokens.');
assert.match(auth, /AUTH_MODE === 'local_oidc_test' && env\?\.NODE_ENV !== 'production'/,
  'The test-session mode must be unavailable in production.');
assert.match(auth, /registerLocalOidcTestSession\(/,
  'Only the validated local OIDC callback may register a test session.');
assert.match(auth, /isActiveLocalOidcTestContext\(user\)/,
  'Authorization must require a live server-registered context.');
assert.match(auth, /BLOCKED: verified OIDC session required\./,
  'AuthService must reject unverified or forged contexts.');
assert.match(auth, /BLOCKED: tenant mismatch\./,
  'AuthService must reject cross-tenant access.');
assert.match(auth, /requireVerifiedSession\(/,
  'AuthService must expose a verified-session check.');
assert.match(sessionGuard, /status: 'BLOCKED'/,
  'SessionGuard must remain fail-closed.');
assert.match(sessionGuard, /isActiveLocalOidcTestContext\(session\)/,
  'SessionGuard must require a verified first-party session.');
assert.match(api, /readiness: 'BLOCKED'/,
  'System status must remain read-only and blocked until verified auth is implemented.');
console.log('PASS: first-party auth/session layer remains fail-closed and does not advertise production identity or session authorization.');
