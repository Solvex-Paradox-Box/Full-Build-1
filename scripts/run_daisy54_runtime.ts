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
  scope: 'Isolated runtime invocation of all 54 registered node handlers; external provider credentials removed.',
  total_nodes: report.total_nodes,
  executed_count: report.executed_count,
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
  caveat: 'This is a runtime observation report, not proof that every subsystem is fully implemented or production-ready. PROVIDER_REQUIRED, PROHIBITED_BLOCKED, and FAIL_CLOSED are reported separately and are not counted as functional SUCCESS.'
};
await mkdir(resolve('artifacts'), { recursive: true });
await writeFile(resolve('artifacts/daisy-54-runtime-report.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({
  total_nodes: output.total_nodes,
  executed_count: output.executed_count,
  status_counts: output.status_counts,
  report: 'artifacts/daisy-54-runtime-report.json'
}, null, 2));

// A nonzero status is intentional when any node is not a positive functional
// SUCCESS. The workflow uploads the report even when this step fails.
if (report.total_nodes !== 54 || report.executed_count !== 54 || counts.SUCCESS !== 54) {
  process.exitCode = 1;
}
