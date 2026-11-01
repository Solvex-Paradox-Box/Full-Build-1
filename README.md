# Full-Build

SolveX + Daisy Haminja full build: the web runtime, formal SAT-witness corpus, payments-disabled release gates, and the source archives used to reconcile it.

This repository is the working tree. The Daisy ISO was split into numbered parts because the files were too large for direct transfer; Smash was used as the transfer service. Do not interpret a single Smash ZIP containing only part-00 as evidence that part-01 is missing from the original build or its release assets.

## Source archives and split build

| Source | Contents | Notes |
| --- | --- | --- |
| [TADA.zip transfer](https://fromsmash.com/MzTZDszljz-ft) | Reported 756 MB ZIP with 63 files | Full-Build snapshots, including `Full-Build-SAT-Witness-Fix-production-hardening.zip`, plus related SolveX / UAREFAKE / Daisy bundles |
| [Smash transfer for the split archive](https://fromsmash.com/YBKjTiquq2-ft) | Reported 1.65 GB ZIP containing `Daisy-AI-OS-Complete-With-ISO.tar.part-00` | One transfer/archive package is not necessarily the complete multi-part source set |
| [Full-Build GitHub release](https://github.com/iamfather420-ctrl/Full-Build/releases/tag/v0.1.0-daisy-ai-os) | Recorded release assets: `Daisy-AI-OS-Complete-With-ISO.tar.part-00`, `Daisy-AI-OS-Complete-With-ISO.tar.part-01`, and SHA-256 file | The repository's recorded source identifies both split parts and the checksum. Use the release asset list as the authoritative location; do not label part-01 missing solely because a Smash package contained part-00 only. |

Archive provenance notes: [sources/smash-archive-manifest.txt](sources/smash-archive-manifest.txt).

## Multi-part archive handling

The split source consists of **part-00 and part-01**. They were split because of transfer-size limits. A transfer archive containing only one part is not the same thing as the original source set being incomplete. To verify a local reconstruction, concatenate the exact parts in numeric order, then check the resulting archive against the published SHA-256 before extracting it. This README does not claim that a new local concatenation or extraction was performed during this documentation correction.

## What landed from the hardening archive

`Full-Build-SAT-Witness-Fix-production-hardening.zip` (reported inside TADA.zip) was merged into this tree on 2026-10-21.

Brought in:

- Formal corpus stays the passing mixture: 88 DFRL refutations expected `unsat`, plus 30 DH `unsat` and 2 DH `sat`. The later all-SAT witness pass, and its second SAT-only Z3 recheck, were removed. Production hardening is unchanged.
- Production-hardening pass: public role-minting login retired, OIDC authorization-code + PKCE path, payments fail closed (HTTP 410), and an additive access-request migration. Actual live migration state must be checked before any migration is reapplied. See [PRODUCTION_READINESS_STATUS.md](PRODUCTION_READINESS_STATUS.md) and [docs/deployment/PRODUCTION_RELEASE_CHECKLIST.md](docs/deployment/PRODUCTION_RELEASE_CHECKLIST.md).

Kept from later commits already on `main` (2026-10-11 through 2026-10-21), which the October 10 archive does not contain:

- Agent, lifecycle, and MMTAI routes and the dashboard shell that links them
- Formal-evidence hash check (`npm run test:formal-hash`) and CI receipt closure script
- Neon `DATABASE_URL` alias, optional PayPal preflight, and the narrowed root `tsconfig.json`
- Backup, read-only audit, and non-production GATE-11 workflows

Release verdict is unchanged: **not production-ready**. `/readyz` is fail-closed until real OIDC configuration, schema/persistence reconciliation, and production gate evidence are verified. PayPal stays disabled.

## Scripts

Use only scripts that exist in the committed `package.json`:

```bash
bun install --frozen-lockfile
bun run lint
bun run verify:release-safety
bun run verify:payments-disabled
bun run verify:enterprise
bun run verify:120
bun run verify:proof-closure
bun run dev
```

`bun run verify:all` currently invokes only `scripts/verify_authoritative.ts`; it does not chain the other checks. Run the listed checks individually when you need their results.

The local `AuthService` boundary remains fail-closed without an approved, configured production identity verifier. Local or mocked checks do not prove that a real OIDC provider is configured.

Do not hand-edit generated evidence JSON to force a SAT result. Regenerate it with the verifier scripts.

## Layout

- `src/` — React UI, API router, Z3 formal verifiers, auth
- `server.ts` — local runtime
- `scripts/` — verification and release-safety checks
- `migrations/004_access_requests.sql` — additive migration; reconcile with live migration history before applying
- `app/` — Android shell
- `sources/` — archive provenance manifest
