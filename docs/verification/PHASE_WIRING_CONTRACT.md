# SolveX verification sequence: 44 checks → Stage 45 → post-production

Status: the 45-stage sequence is the governing release sequence. Pre-production checks 1–44 feed Stage 45. Post-production verification is a separate operational evidence set after deployment; it is not another numbered stage.

## Agreed execution order

1. **Pre-production checks 1–44:** execute the 15 authoritative system checks (GATE-00 through GATE-14) and the 29 pre-production enterprise invariants (INV-01 through INV-29). Daisy's 54-node architecture is verified within this phase and is not an additional gate count.
2. **Stage 45 — production readiness:** the final numbered stage. It consumes exactly 44 unique, current, commit-matched results. It passes only when every check passes, evidence hashes are present, and no pre-production blocker remains. A pass authorizes deployment; a failure blocks deployment.
3. **Post-production verification:** only after deployment, run the live provider, trusted-identity lifecycle, production health/telemetry, failure diversion, rollback/recovery, and whole-product checks. These are operational checks outside the numbered 45-stage sequence. Their results must never be used to backfill or change Stage 45.

## Check assignment

The machine-readable source of truth is config/verification/phase-wiring.json.

- Pre-production checks 1–44: GATE-00 through GATE-14 (15 checks) plus INV-01 through INV-29 (29 checks).
- Stage 45: STAGE-45, the final pre-production readiness decision after all 44 checks.
- Post-production: the live portions of GATE-11, GATE-12, and GATE-14; PIPE-14 independent model oracle attestation; INV-30 failure diversion/rollback; deployment health; failure/recovery; and whole-product checks. The local adapter contracts, local pipeline, and fail-closed identity behavior are checked before deployment. Live provider connectivity and deployed lifecycle completion are not.

The pre-production memory gate requires measured process RSS/heap telemetry and sandbox-container cgroup peak/limit/OOM telemetry. If the CI host does not expose cgroup v2, the orchestrator measurement is explicitly labeled PROCESS rather than being misrepresented as cgroup evidence; production cgroup enforcement is checked after deployment. The 54 Daisy nodes remain part of the architecture under test. Their registration, execution, output assertions, and evidence generation are verified before deployment; deployed whole-product handoffs are exercised again after deployment.

## Runtime and evidence rules

The Stage 45 runner executes the authoritative pipeline once, consumes its 29 invariant results without rerunning them, and requires exactly 44 unique IDs. Within the 21-stage SolutionPipeline, 20 local stages must pass; Stage 14 is recorded as EXTERNAL_PROVIDER_REQUIRED and is verified separately after deployment as PIPE-14. Each result includes status, claim scope, duration, details, and a SHA-256 evidence hash. The report is bound to the exact source commit and environment. Stage 45 also hashes the built dist/index.html release artifact and requires SOLVEX_DEPLOYMENT_TARGET plus SOLVEX_DEPLOYMENT_TARGET_VERIFIED=true. The target variables must be populated only after the actual deployment project/target has been confirmed. CI builds the isolated sandbox from a digest-pinned Node base image. The live independent-oracle image, oracle ID, and Ed25519 public key are not Stage 45 prerequisites; they are required for the separate post-production PIPE-14 check.

EXTERNAL_PROVIDER_REQUIRED, PENDING, BLOCKED, and failed results are never promoted to PASSED. Live provider credentials, deployed lifecycle completion, production failure injection, rollback/recovery, and post-deployment monitoring are excluded from Stage 45. They remain separately recorded as post-production evidence.

## Safety boundaries

A Stage 45 pass authorizes deployment; it does not claim deployment has occurred or that post-production checks have passed. This workflow does not activate payment processing, write to production databases, run live migrations, or start production machines. Those actions remain separately authorized.

## Execution

- bun run verify:phase-wiring validates the 44-check inventory and phase boundaries.
- bun run verify:stage45 executes the 44 checks, evaluates Stage 45, and writes artifacts/stage-45-readiness.json and artifacts/stage-45-readiness.md.
- CI runs Stage 45 on pull requests and on pushes to main. Deployment is not triggered automatically by this verification job.
