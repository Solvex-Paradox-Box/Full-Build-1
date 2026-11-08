# Production Identity Integration Readiness

Branch: `integration/uarefake-identity-oidc-full`

## Corrections applied

1. **Real Google OIDC** (`src/auth/GoogleOidcClient.ts`)
   - openid-client discovery + issuer validation
   - JWKS signature verification via `authorizationCodeGrant` + `idTokenExpected`
   - State, nonce, PKCE S256
   - Audience and azp validation
   - Verified email required
   - Callback + logout helpers
   - Never uses the synthetic local OIDC provider

2. **Neon-backed sessions** (`src/auth/NeonSessionStore.ts`)
   - Cryptographically random opaque tokens
   - SHA-256 digests only stored
   - Expiration + revocation
   - Membership revalidation on every lookup
   - Multi-instance compatible (no process memory for correctness)
   - In-memory store retained solely for unit tests

3. **Explicit production activation**
   - Requires `AUTH_MODE=production`
   - `evaluateReadiness()` probes Google config + Neon connectivity + session store
   - Env vars alone never make production ready
   - Missing/invalid configuration → BLOCKED

4. **OIDC router** (`src/auth/OidcAuthRouter.ts`) — opt-in, unmounted
   - Secure / HttpOnly / SameSite=Lax cookies
   - Origin allowlist (CSRF protection)
   - Login, callback, logout, status

## Required environment variables

```
AUTH_MODE=production

OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=<google-client-id>
OIDC_CLIENT_SECRET=<google-client-secret>
OIDC_REDIRECT_URI=https://<your-domain>/auth/callback

SOVEREIGN_AUTH_SECRET=<random 32+ bytes>
DATABASE_URL=postgresql://solvex_runtime_login_v2:...@.../neondb?sslmode=require
```

## Remaining human steps

1. Provision Neon role `solvex_runtime_login_v2` (LOGIN NOINHERIT NOBYPASSRLS NOCREATEROLE)
2. Apply first-party auth migration on a disposable branch, verify, promote
3. Bootstrap CUSTOMER role + first OWNER
4. Set Vercel env vars
5. Register redirect URI with Google
6. Mount `createOidcAuthRouter` only after live tests pass
7. Run live test matrix against real Google + Neon

## Safety invariants

- Local synthetic OIDC never runs when NODE_ENV=production
- No local token minting for production
- Partial claims rejected
- Cross-tenant access denied
- Unknown actions denied
- Secrets never in source or logs
- Production remains BLOCKED until readiness validation succeeds
