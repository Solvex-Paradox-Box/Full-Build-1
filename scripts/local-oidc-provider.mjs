import { generateKeyPairSync } from 'node:crypto';
import { Provider } from 'oidc-provider';

export const LOCAL_OIDC_ISSUER = 'http://127.0.0.1:3001';
export const LOCAL_OIDC_CLIENT_ID = 'full-build-local-dev';
export const LOCAL_OIDC_CLIENT_SECRET = 'local-only-not-a-production-secret';
export const LOCAL_OIDC_CALLBACK = 'http://127.0.0.1:3000/auth/callback';

// Synthetic fixtures only. No account lookup or enrollment is allowed beyond
// this allowlist, and every email uses the reserved .invalid top-level domain.
const TEST_IDENTITIES = new Map([
  ['test-admin', {
    email: 'admin@example.invalid',
    name: 'Synthetic FULL-BUILD Admin',
    role: 'ADMIN',
    tenant_id: 'TENANT_DEV_A',
  }],
  ['test-customer', {
    email: 'customer@example.invalid',
    name: 'Synthetic FULL-BUILD Customer',
    role: 'CUSTOMER',
    tenant_id: 'TENANT_DEV_A',
  }],
  ['test-customer-b', {
    email: 'customer-b@example.invalid',
    name: 'Synthetic FULL-BUILD Customer B',
    role: 'CUSTOMER',
    tenant_id: 'TENANT_DEV_B',
  }],
]);

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) reject(new Error('interaction body too large'));
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

function interactionPage(prompt, uid) {
  if (prompt === 'login') {
    const choices = [...TEST_IDENTITIES.keys()].map((id) =>
      `<button type="submit" name="account_id" value="${id}">${id}</button>`,
    ).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>FULL-BUILD local test sign-in</title></head><body><h1>Local synthetic-account sign-in</h1><p>Development fixtures only; no real identity is authenticated.</p><form method="post" action="/interaction/${encodeURIComponent(uid)}"><input type="hidden" name="prompt" value="login">${choices}</form></body></html>`;
  }
  if (prompt === 'consent') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>FULL-BUILD local test consent</title></head><body><h1>Authorize the local test client</h1><form method="post" action="/interaction/${encodeURIComponent(uid)}"><input type="hidden" name="prompt" value="consent"><button type="submit">Continue</button></form></body></html>`;
  }
  return '';
}

function ephemeralSigningKey() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = privateKey.export({ format: 'jwk' });
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, kid: 'full-build-local-ephemeral', use: 'sig', alg: 'RS256' }] },
  };
}

export async function startLocalOidcProvider() {
  const signingKey = ephemeralSigningKey();
  const provider = new Provider(LOCAL_OIDC_ISSUER, {
    jwks: signingKey.jwks,
    clients: [{
      client_id: LOCAL_OIDC_CLIENT_ID,
      client_secret: LOCAL_OIDC_CLIENT_SECRET,
      redirect_uris: [LOCAL_OIDC_CALLBACK],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'client_secret_basic',
    }],
    scopes: ['openid', 'profile', 'email', 'fullbuild'],
    claims: {
      openid: ['sub'],
      profile: ['name'],
      email: ['email', 'email_verified'],
      fullbuild: ['tenant_id', 'role'],
    },
    findAccount: async (_ctx, accountId) => {
      const identity = TEST_IDENTITIES.get(accountId);
      if (!identity) return undefined;
      return {
        accountId,
        claims: async () => ({
          sub: accountId,
          email: identity.email,
          email_verified: true,
          name: identity.name,
          role: identity.role,
          tenant_id: identity.tenant_id,
        }),
      };
    },
    pkce: {
      required: () => true,
      methods: ['S256'],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: false },
      introspection: { enabled: false },
    },
    ttl: {
      AuthorizationCode: 120,
      AccessToken: 300,
      IdToken: 300,
      Interaction: 300,
      Session: 300,
    },
  });

  // Custom local interaction UI exposes only the fixed synthetic account list.
  provider.use(async (ctx, next) => {
    if (!/^\/interaction\/[A-Za-z0-9_-]+\/?$/.test(ctx.path)) return next();
    const details = await provider.interactionDetails(ctx.req, ctx.res);
    const uid = ctx.path.split('/')[2];
    ctx.set('cache-control', 'no-store');
    ctx.set('content-type', 'text/html; charset=utf-8');
    if (ctx.method === 'GET') {
      ctx.status = 200;
      ctx.body = interactionPage(details.prompt.name, uid) || '<h1>Unsupported interaction</h1>';
      return;
    }
    if (ctx.method !== 'POST') {
      ctx.status = 405;
      ctx.body = 'Method not allowed';
      return;
    }
    const body = await readFormBody(ctx.req);
    if (body.get('prompt') === 'login' && details.prompt.name === 'login') {
      const accountId = body.get('account_id') ?? '';
      if (!TEST_IDENTITIES.has(accountId)) {
        ctx.status = 400;
        ctx.body = 'Unknown synthetic test account';
        return;
      }
      await provider.interactionFinished(ctx.req, ctx.res, {
        login: { accountId },
      }, { mergeWithLastSubmission: false });
      ctx.respond = false;
      return;
    }
    if (body.get('prompt') === 'consent' && details.prompt.name === 'consent') {
      const grant = details.grantId
        ? await provider.Grant.find(details.grantId)
        : new provider.Grant({ accountId: details.session.accountId, clientId: details.params.client_id });
      if (details.prompt.details.missingOIDCScope) {
        grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(' '));
      }
      if (details.prompt.details.missingOIDCClaims) {
        grant.addOIDCClaims(details.prompt.details.missingOIDCClaims);
      }
      const grantId = await grant.save();
      await provider.interactionFinished(ctx.req, ctx.res, {
        consent: { grantId },
      }, { mergeWithLastSubmission: true });
      ctx.respond = false;
      return;
    }
    ctx.status = 400;
    ctx.body = 'Interaction rejected';
  });

  // Bind only to loopback. The ephemeral key and local adapter are not
  // production key storage or a production session provider.
  const server = provider.listen(3001, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { provider, server, signingPrivateKey: signingKey.privateKey };
}
