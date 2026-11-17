import assert from 'node:assert/strict';
import { SolutionPipeline } from '../src/solutions/SolutionPipeline';

async function main() {
  // This test specifically verifies the missing-sandbox fail-closed path.
  // The CI readiness run builds and supplies a pinned sandbox image separately.
  const configuredSandboxImage = process.env.SOLVEX_SANDBOX_IMAGE;
  delete process.env.SOLVEX_SANDBOX_IMAGE;
  const pipeline = SolutionPipeline.getInstance();

  const sentinel = await pipeline.runPipeline('DH-P-001', '/* FAIL_STAGE_9 */ return false;');
  assert.equal(sentinel.overall_success, false, 'sentinel run must never succeed');
  assert.equal(sentinel.total_stages, 21);
  assert.equal(sentinel.stage_traces.length, 21);
  assert.equal(sentinel.stage_traces[8].status, 'FAILED');
  assert.equal(sentinel.stage_traces[8].reason, 'Sentinel detected fatal specification anomaly');
  assert.equal(sentinel.rejection_reason, 'Sentinel detected fatal specification anomaly');
  assert.ok(sentinel.stage_traces.slice(9).every(stage => stage.status === 'BLOCKED'),
    'circuit breaker must block all stages after stage 9');

  const normal = await pipeline.runPipeline('DH-P-001', 'export function solve() { return true; }');
  assert.equal(normal.total_stages, 21);
  assert.equal(normal.stage_traces.length, 21);
  assert.equal(normal.stage_traces[0].status, 'PASSED');
  assert.equal(normal.stage_traces[1].status, 'PASSED');
  assert.equal(normal.stage_traces[5].status, 'BLOCKED', 'cleanroom isolation must block the pipeline');
  assert.equal(normal.stage_traces[6].status, 'BLOCKED', 'downstream checks must not run after a blocker');
  assert.equal(normal.stage_traces[7].status, 'BLOCKED', 'downstream checks must not run after a blocker');
  assert.equal(normal.stage_traces[8].status, 'PASSED', 'independent sentinel must still inspect the input');
  assert.ok(normal.stage_traces.slice(9).every(stage => stage.status === 'BLOCKED'),
    'no downstream solver, ledger, checkpoint, or publication side effects may run after the cleanroom blocker');
  assert.equal(normal.overall_success, false, 'unavailable cleanroom must keep closure fail-closed');
  if (configuredSandboxImage) process.env.SOLVEX_SANDBOX_IMAGE = configuredSandboxImage;
  console.log(JSON.stringify({
    test: 'solution-pipeline-execution',
    sentinel_circuit_breaker: 'PASS',
    stage_trace_count: normal.stage_traces.length,
    normal_run_overall_success: normal.overall_success,
    blocked_stages: normal.stage_traces.filter(stage => stage.status === 'BLOCKED').map(stage => stage.stage),
    claim_scope: 'LOCAL_TEST_ONLY'
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
