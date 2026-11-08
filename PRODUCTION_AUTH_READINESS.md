# Production Identity Integration Readiness

Branch: `integration/uarefake-identity-oidc-full`

## What this branch contains

- Enhanced `AuthService` with three gated modes:
  - `local_oidc_test` (existing PR #72 behaviour, never active in production)
  - Production OIDC path (activates only when OIDC / Google client credentials are present)
  - First-party session path (activates when `SOVEREIGN_AUTH_SECRET` ≥ 32 chars is present)
- First-party foundation files from PR #71 (service, Neon repository, invitation admin, TenantContextToken, router)
- Fail-closed handling for subject, email, tenant, role and membership on every verification path
- `SessionGuard` updated to reject partial claims and enforce tenant isolation

## Required environment variables (never commit secrets)

```
# Production OIDC (Google recommended)
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=<google-client-id>
OIDC_CLIENT_SECRET=<google-client-secret>
# or the Google-prefixed aliases
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# First-party session / RLS HMAC
SOVEREIGN_AUTH_SECRET=<random 32+ byte secret matching the DB verifier>

# Neon least-privilege runtime (must be provisioned by admin)
DATABASE_URL=postgresql://solvex_runtime_login_v2:...@.../neondb?sslmode=require

# Optional
AUTH_MODE=local_oidc_test   # only for non-production automated tests
NODE_ENV=production
```

## Remaining human / external steps (cannot be automated safely)

1. **Provision Neon role**  
   Create `solvex_runtime_login_v2` with `LOGIN NOINHERIT NOBYPASSRLS NOCREATEROLE`, member only of `solvex_app_runtime`. Do not use elevated Neon roles.

2. **Apply migration**  
   Run `db/migrations/20261029_first_party_auth.sql` first on a disposable / rehearsal branch, verify, then promote.

3. **Bootstrap roles & first owner**  
   The inspected schema had zero rows in `public.roles`. Human-controlled process must create CUSTOMER and the initial OWNER.

4. **Set Vercel env vars**  
   Inject the values above into the Vercel project. Neon is already connected via Vercel.

5. **Authorize redirect URIs**  
   Register the production callback URL with the Google (or chosen) OIDC client.

6. **Mount FirstPartyAuthRouter** (optional, after live tests)  
   The router remains unmounted by design. Mount only after origin allowlist, CSRF, cookie and Neon integration tests pass.

7. **Run live test matrix**  
   New registration, existing login, OIDC callback, invalid/expired tokens, signatures, cross-tenant rejection, role enforcement, logout, session persistence, regression.

## Safety invariants preserved

- Local synthetic OIDC never runs when `NODE_ENV=production`.
- No tokens are minted locally for production.
- Partial claims (missing subject / email / tenant / role) are rejected.
- Cross-tenant access is denied.
- Unknown actions are denied (fail-closed policy).
- Secrets never appear in source or logs.

## Status

Code scaffolding and fail-closed boundary are complete on this branch.  
Live production authentication will remain **BLOCKED** until the external steps above are completed and verified.
