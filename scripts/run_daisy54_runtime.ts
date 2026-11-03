import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// This CI run is intentionally provider-isolated. Never inherit credentials from
// a runner environment and never contact live payment or hosted database services.
for (const key of [
  'NEON_DATABASE_URL', 'DATABASE_URL', 'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET', 'PAYPAL_ENVIRONMENT', 'COINBASE_API_KEY',
  'ETH_RPC_URL'
]) delete process.env[key];

const { runDaisy54NodeCoverage } = await import('../src/tests/daisy54NodeCoverage');
const report = await runDaisy54NodeCoverage();
const counts = Object.fromEntries(
  ['SUCCESS', 'PROHIBITED_BLOCKED', 'PROVIDER_REQUIRED', 'FAIL_CLOSED', 'FAIL']
    .map(status => [status, report.results.filter(r => r.status === status).length])
);
const output = {
  generated_at: new Date().toISOString(),
  scope: 'Credential-stripped local invocation of all 54 handlers. Provider adapters are inventory-only in this runner; no provider authentication or payment call is made.',
  total_nodes: report.total_nodes,
  executed_count: report.executed_count,
  runtime_integrity_passed: report.total_nodes === 54 && report.executed_count === 54 && counts.FAIL === 0,
  status_counts: counts,
  results: report.results.map(r => ({
    node_id: r.node_id,
    name: r.name,
    executed: r.executed,
    status: r.status,
    claim_scope: r.claim_scope,
    duration_ms: r.duration_ms,
    evidence: r.evidence,
    error: r.error ?? null
  })),
  caveat: 'This runner does not provide an OS-level network sandbox. It removes known provider credentials and the node handlers do not invoke provider connections. Runtime integrity is distinct from functional readiness: PROVIDER_REQUIRED, PROHIBITED_BLOCKED, and FAIL_CLOSED remain non-success outcomes.'
};
await mkdir(resolve('artifacts'), { recursive: true });
await writeFile(resolve('artifacts/daisy-54-runtime-report.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({
  total_nodes: output.total_nodes,
  executed_count: output.executed_count,
  status_counts: output.status_counts,
  runtime_integrity_passed: output.runtime_integrity_passed,
  report: 'artifacts/daisy-54-runtime-report.json'
}, null, 2));

// Fail only when the 54-handler invocation is incomplete or a handler throws.
// Fail-closed/provider-required statuses remain visible in the artifact and do
// not masquerade as functional SUCCESS. The workflow always uploads the report.
if (!output.runtime_integrity_passed) {
  process.exitCode = 1;
}
