import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import * as oidcClient from 'openid-client';

const APP = 'http://127.0.0.1:3000';
const ISSUER = 'http://127.0.0.1:3001';
const CALLBACK = `${APP}/auth/callback`;
const cli = resolve('node_modules/tsx/dist/cli.mjs');
const cookieJar = new Map();

function saveCookies(url, response) {
  const host = new URL(url).hostname;
  const cookies = cookieJar.get(host) ?? new Map();
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(';');
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    const maxAge = attributes.find((item) => item.trim().toLowerCase().startsWith('max-age='));
    if (maxAge?.trim().toLowerCase() === 'max-age=0') cookies.delete(name);
    else cookies.set(name, value);
  }
  cookieJar.set(host, cookies);
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers);
  const cookies = cookieJar.get(new URL(url).hostname);
  if (cookies?.size && !headers.has('cookie')) {
    headers.set('cookie', [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '));
  }
  const response = await fetch(url, { ...options, headers, redirect: 'manual' });
  saveCookies(url, response);
  return response;
}

async function beginLogin() {
  const response = await request(`${APP}/auth/login`);
  assert.equal(response.status, 302, 'login endpoint must issue an authorization redirect');
  const authorizationUrl = new URL(response.headers.get('location'));
  assert.equal(authorizationUrl.origin, ISSUER);
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), CALLBACK, 'callback must be an exact pre-registered URI');
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorizationUrl.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
  assert.ok((authorizationUrl.searchParams.get('state') ?? '').length >= 20);
  assert.ok((authorizationUrl.searchParams.get('nonce') ?? '').length >= 20);
  assert.match(authorizationUrl.searchParams.get('scope') ?? '', /\bopenid\b/);
  return authorizationUrl;
}

async function submitInteraction(url, html, prompt) {
  const actionMatch = html.match(/action="([^"]+)"/);
  assert.ok(actionMatch, 'synthetic test interaction should have a form action');
  const action = new URL(actionMatch[1].replaceAll('&amp;', '&'), url).href;
  const body = new URLSearchParams();
  if (prompt === 'login') {
    body.set('prompt', 'login');
    body.set('account_id', 'test-admin');
  } else {
    body.set('prompt', 'consent');
  }
  return request(action, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

async function completeAuthorization(authorizationUrl) {
  let current = authorizationUrl.href;
  for (let step = 0; step < 20; step += 1) {
    const url = new URL(current);
    if (url.origin === APP && url.pathname === '/auth/callback') {
      return request(current);
    }
    const response = await request(current);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      assert.ok(location, `redirect at ${url.pathname} must include Location`);
      current = new URL(location, url).href;
      continue;
    }
    if (url.origin === ISSUER && url.pathname.startsWith('/interaction/') && response.status === 200) {
      const html = await response.text();
      if (html.includes('name="account_id"')) {
        const submitted = await submitInteraction(url.href, html, 'login');
        assert.equal(submitted.status, 303, 'login choice should complete the OIDC interaction');
        current = new URL(submitted.headers.get('location'), url).href;
        continue;
      }
      if (html.includes('name="prompt" value="consent"')) {
        const submitted = await submitInteraction(url.href, html, 'consent');
        assert.equal(submitted.status, 303, 'consent should complete the OIDC interaction');
        current = new URL(submitted.headers.get('location'), url).href;
        continue;
      }
      throw new Error('issuer returned an unrecognized local interaction page');
    }
    throw new Error(`unexpected response ${response.status} from ${url.origin}${url.pathname}`);
  }
  throw new Error('OIDC interaction exceeded redirect limit');
}

async function expectNoSession() {
  const response = await request(`${APP}/api/auth/session`);
  assert.equal(response.status, 401, 'invalid flow must not create an application session');
}

async function withRuntime(tamperMode, callback) {
  cookieJar.clear();
  const env = { ...process.env, NODE_ENV: 'development', AUTH_MODE: 'local_oidc_test', HOST: '127.0.0.1' };
  delete env.OIDC_TEST_TAMPER;
  if (tamperMode) env.OIDC_TEST_TAMPER = tamperMode;
  let startupError = '';
  const child = spawn(process.execPath, [cli, 'server.ts'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (startupError.length < 3000) startupError += text.slice(0, 3000 - startupError.length);
  });
  try {
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      if (child.exitCode !== null) throw new Error(`local test runtime exited before readiness${startupError ? `: ${startupError}` : ''}`);
      try {
        const response = await fetch(`${APP}/api/auth/session`);
        if (response.status === 401) { ready = true; break; }
      } catch { /* wait for loopback listeners */ }
      await delay(250);
    }
    assert.ok(ready, 'loopback app runtime did not become ready');
    await callback();
  } finally {
    const exitPromise = child.exitCode !== null
      ? Promise.resolve()
      : new Promise((resolveExit) => child.once('exit', resolveExit));
    child.kill('SIGTERM');
    const exited = await Promise.race([exitPromise.then(() => true), delay(5000).then(() => false)]);
    if (!exited) {
      child.kill('SIGKILL');
      await exitPromise;
    }
  }
}

async function testInvalidTokenMode(mode) {
  await withRuntime(mode, async () => {
    await expectNoSession();
    const authorization = await beginLogin();
    const callback = await completeAuthorization(authorization);
    assert.equal(callback.status, 500, `${mode} tampering must be rejected during OIDC validation`);
    await expectNoSession();
  });
}

async function main() {
  const productionGuard = spawnSync(process.execPath, [cli, 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', AUTH_MODE: 'local_oidc_test' },
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  assert.notEqual(productionGuard.status, 0, 'production startup must reject local OIDC mode');

  for (const mode of ['signature', 'issuer', 'audience', 'expiration', 'userinfo-sub']) {
    await testInvalidTokenMode(mode);
  }

  await withRuntime('', async () => {
    await expectNoSession();
    const discoveryResponse = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    assert.equal(discoveryResponse.status, 200);
    const metadata = await discoveryResponse.json();
    assert.equal(metadata.issuer, ISSUER);
    assert.equal(metadata.authorization_endpoint, `${ISSUER}/auth`);
    assert.equal(metadata.token_endpoint, `${ISSUER}/token`);
    assert.equal(metadata.jwks_uri, `${ISSUER}/jwks`);
    assert.ok(metadata.code_challenge_methods_supported.includes('S256'));

    const badPkce = await beginLogin();
    const wrongVerifier = oidcClient.randomPKCECodeVerifier();
    badPkce.searchParams.set('code_challenge', await oidcClient.calculatePKCECodeChallenge(wrongVerifier));
    const pkceFailure = await completeAuthorization(badPkce);
    assert.equal(pkceFailure.status, 500, 'mismatched PKCE challenge/verifier must fail the code exchange');
    await expectNoSession();

    const badState = await beginLogin();
    badState.searchParams.set('state', 'attacker-controlled-state');
    const stateFailure = await completeAuthorization(badState);
    assert.equal(stateFailure.status, 400, 'altered state must be rejected');
    await expectNoSession();

    const badNonce = await beginLogin();
    badNonce.searchParams.set('nonce', 'attacker-controlled-nonce');
    const nonceFailure = await completeAuthorization(badNonce);
    assert.equal(nonceFailure.status, 500, 'nonce mismatch must fail ID-token validation');
    await expectNoSession();

    const normal = await beginLogin();
    const callback = await completeAuthorization(normal);
    assert.equal(callback.status, 303, 'valid authorization should create a local session and return to the app');
    assert.equal(new URL(callback.headers.get('location'), APP).pathname, '/');

    const sessionResponse = await request(`${APP}/api/auth/session`);
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.deepEqual(session, {
      authenticated: true,
      user: {
        user_id: 'test-admin',
        tenant_id: 'TENANT_DEV_A',
        email: 'admin@example.invalid',
        role: 'ADMIN',
      },
    }, 'OIDC claims must map to the FULL-BUILD UserContext shape');

    const sameTenant = await request(`${APP}/api/auth/authorize?action=VIEW_EVIDENCE&tenant_id=TENANT_DEV_A`);
    assert.equal(sameTenant.status, 200);
    assert.equal((await sameTenant.json()).authorized, true);
    const crossTenant = await request(`${APP}/api/auth/authorize?action=VIEW_EVIDENCE&tenant_id=TENANT_DEV_B`);
    assert.equal(crossTenant.status, 403, 'tenant mismatch must fail closed');

    const logout = await request(`${APP}/api/auth/logout`, {
      method: 'POST',
      headers: { origin: APP },
    });
    assert.equal(logout.status, 204);
    await expectNoSession();
  });

  console.log('PASS local OIDC E2E: discovery, exact callback, PKCE, state, nonce, signature/issuer/audience/expiry and UserInfo-sub rejection, claim mapping, tenant denial, logout, production guard');
}

main().catch((error) => {
  console.error(`FAIL local OIDC E2E: ${error instanceof Error ? error.message : 'unexpected error'}`);
  process.exitCode = 1;
});
