# SOLVEX + Daisy Haminja repository reconciliation
Date: 2026-10-27

## Scope and rule

The target remains `iamfather420-ctrl/Full-Build` on `main`. The current Vercel production project previously inspected is sourced from `iamfather420-ctrl/Uarefake-1`; merging this repository does not deploy it.

This is an inventory plus a targeted code-level review of the largest and most relevant repositories, not a claim that every file in every repository has been exhaustively audited. No code was imported during this pass. The import rule is: preserve source provenance and import only a non-overlapping module whose real implementation, dependencies, authorization boundaries, and tests are verified and which is needed by the canonical build.

## Reviewed candidates and decisions

| Repository | Finding | Decision |
|---|---|---|
| `agate-core-build` | Its `package.json` blob matches `solvex-react-build` (SHA `136ae2e59677b41bd82849a9bea5510be0d7804d`); `server.ts` is also identical (SHA `41223bef9ce27a0c77cad348c0f4a3484e428b30`). The server labels itself a mock server, returns hardcoded `VERIFIED` health data, enforces a fixed 380-byte POST, and exposes GET routes that execute shell test scripts. | Do not import as production logic; duplicated and contains mock/status and execution risks. |
| `solvex-react-build` | Same package/server blobs as `agate-core-build`; no unique core implementation found in the inspected paths. | Do not import; duplicate. |
| `agate-unified-monorepo` and `agate-master-build` | Both workspace roots list the same broad apps/packages layout; their `apps/agate-core-build/server.ts` blob is the same SHA as the standalone `agate-core-build` server. | Do not import duplicate workspace copies; require a source-level diff and provenance check before considering any package. |
| `SOLVEX-PARADOX-BOX` | Contains an alternate `src/brain/DaisyBrain.ts`, but it hardcodes active goals, a sovereign-admin role, a sandbox count of 1, derived cycle/memory metrics, and a list of proof systems as online. It lacks the canonical Full-Build activation-gate and typed Neon adapter files at the checked paths. | Do not transplant the alternate brain; its telemetry and authorization claims are not evidence-backed and overlap with the canonical brain. |
| `Paradox-compliance-dashboard` | `scripts/verify_proofs.ts` does call Z3 `solver.check()` and can serve as a candidate independent verifier. However, `src/services/dfrlFormalArtifacts.ts` also contains a separate generator that hardcodes an UNSAT transcript and emits replay evidence by copying expected state into observed state. Its provenance helper can synthesize default source paths and version labels. Full-Build already runs its own 120-case Z3 verification and 45-stage release sequence (44 pre-production checks plus Stage 45). | Do not import the synthetic artifact/replay generator. A future independent-verifier comparison must use the actual Z3 execution path and compare against the canonical registry without replacing it. |
| `SolveXRepoUnify` | Server depends on `@google/genai` and calls Gemini; the README instructs the operator to provide `GEMINI_API_KEY`. | Do not import as Daisy's first-party inference runtime. External model use is now disabled by default in Full-Build unless explicitly authorized. |
| `Pro-Validator` | Server uses `@google/genai` and a Gemini fallback. The inspected app is an AI guest/logic-validator UI, not a proven first-party runtime. | Do not import into the sovereign runtime. |
| `AI-Linkey`, `SolveX`, `FREEDOM-SIM-AI-OS`, `AGate-Sovergine-Wallet`, `Anonymous-Identity-Financial`, `Reclamation-Experts` | Inspected repository metadata/entry documentation points to AI Studio-style projects; the reviewed README templates require a Gemini API key. These are not demonstrated, tested drop-in modules for the canonical OS. | Keep separate until source, licensing/provenance, external calls, dependencies, and a real integration contract are audited. |
| `Uarefake-1` and `web-build` | Both contain self-hosted Better Auth code and share the same `email-password.ts` and `verify.server.ts` blobs. Local email/password is disabled; the production auth path is intentionally gated. `Uarefake-1` is the previously verified Vercel source repository. | Do not copy auth code blindly into Full-Build. First-party account lifecycle, recovery, tenant claims, and production enablement need one end-to-end implementation and tests. |
| `uarefake` | Next.js starter with standard scaffold scripts; no relevant OS/auth/proof implementation found in the inspected root files. | No import. |
| `uarefake-solvex-archive` | README describes extracted reports, status materials, and verification notes; the original large binaries and nested archives were not committed there. | Use as documentary evidence only, not as source-code replacement. Preserve the original large release parts and checksums. |
| `proof-before-power` | README is AI Studio boilerplate and `package.json` contains only a minimal package declaration. | Not a complete verifier; no import. |
| `Base-Waste-Harvester`, `Planetary-Harvester` | Separate harvester/Android-oriented products; no verified typed integration boundary to the canonical runtime was established in this pass. | Keep separate until their code, build, permissions, and interfaces are audited. |
| `agate-veritas`, `SolveX-Crystal-Clear-Box-Compliance-Immutibility`, `Crystal-Clear-Box`, `bloom-clear-tiger-meadow`, `Bdc-Project`, `swarm-rebuilder`, `Swarm`, `Mod_Aud_Xp_Studio_V1` | Repository metadata or the standard root files checked did not establish a complete, non-overlapping module that is required by Full-Build. Some repositories lack a root README/package manifest at the expected path; that is unresolved, not proof of emptiness. | No import in this pass. Continue targeted tree/source inspection before making any completeness claim. |

## Canonical build changes verified separately

- The foundational Daisy instruction is committed and wired into the native server path.
- Payment creation and the native UI's fabricated settlement response are blocked; browser-only mode no longer simulates native execution.
- External Gemini use is default-off and requires explicit `ALLOW_EXTERNAL_MODEL_PROVIDER=true`; a first-party inference runtime is still missing.
- Generic Neon schema migration and writes are blocked until typed domain repositories exist.
- Activation evidence must be fresh, complete, and bound to the current source revision.
- Runtime status claims now report blocked/disabled/unverified states rather than implying verified reasoning or escrow.

## Still unresolved

1. Recover the missing native UI source modules from verified history or the preserved original archive; do not invent replacements.
2. Implement and independently test first-party inference.
3. Complete first-party authentication, recovery, session revocation, and tenant authorization.
4. Build typed Neon repositories and run staging tenant-isolation/restart/restore tests.
5. Reconcile the canonical deployment source with Full-Build and verify the actual deployed revision.
6. Regenerate current 44-check/Stage 45 readiness evidence, then complete separate post-production operational recovery checks.
7. Only then revisit PayPal. PayPal is not the only current blocker.

No live database migration, credential change, payment, or production deployment was performed as part of this repository scan.
