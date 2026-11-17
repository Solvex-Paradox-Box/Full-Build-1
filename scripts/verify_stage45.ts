import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Stage45Readiness } from '../src/proofs/Stage45Readiness';
import { AuthoritativeVerificationPipeline } from '../src/tests/authoritativeVerificationPipeline';
import { setDiskDbChecker } from '../src/tests/persistenceVerification';

async function main() {
  const root = process.cwd();
  const artifactsDir = path.join(root, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  AuthoritativeVerificationPipeline.setNodePlatform({ execSync: cp.execSync, fs, path });
  setDiskDbChecker((file: string) => fs.existsSync(file));

  const sourceCommitSha = cp.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config/verification/phase-wiring.json'), 'utf8'));
  const expectedIds = [...manifest.pre_production.system_gate_ids, ...manifest.pre_production.enterprise_invariant_ids];
  const report = await Stage45Readiness.getInstance().evaluateStage45();

  const observedIds = report.gates.map(g => g.gate_id);
  const exactInventory = expectedIds.length === 44 &&
    new Set(expectedIds).size === 44 &&
    observedIds.length === 44 &&
    new Set(observedIds).size === 44 &&
    expectedIds.every(id => observedIds.includes(id)) &&
    observedIds.every(id => expectedIds.includes(id));
  const commitMatched = report.commit_sha === sourceCommitSha;
  const evidenceComplete = [...report.gates, report.stage_45].every(g => /^[a-f0-9]{64}$/i.test(g.evidence_hash));
  const allChecksPassed = report.gates.every(g => g.status === 'PASSED');
  const stage45Passed = exactInventory && commitMatched && evidenceComplete &&
    allChecksPassed && report.stage_45.status === 'PASSED' && report.all_pre_production_passed &&
    report.stage_45.details.release_artifact_present === true && report.stage_45.details.deployment_target_validated === true;

  const artifact = {
    ...report,
    source_commit_sha: sourceCommitSha,
    exact_inventory: exactInventory,
    commit_matched: commitMatched,
    evidence_hashes_complete: evidenceComplete,
    all_44_checks_passed: allChecksPassed,
    deployment_authorized: stage45Passed,
    stage_45: {
      ...report.stage_45,
      status: stage45Passed ? 'PASSED' : 'BLOCKED',
      deployment_authorized: stage45Passed
    },
    isolated_process: true
  };

  const output = path.join(artifactsDir, 'stage-45-readiness.json');
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2), 'utf8');
  fs.writeFileSync(path.join(artifactsDir, 'stage-45-readiness.md'), [
    '# SolveX Stage 45 — Production Readiness',
    '',
    '- Commit: ' + sourceCommitSha,
    '- Pre-production checks: ' + report.gates_passed + ' / 44 passed',
    '- Inventory exact: ' + exactInventory,
    '- Commit matched: ' + commitMatched,
    '- Evidence hashes complete: ' + evidenceComplete,
    '- Release artifact: ' + (report.stage_45.details.release_artifact_present ? 'verified' : 'missing'),
    '- Deployment target: ' + (report.stage_45.details.deployment_target_validated ? 'identified and verified' : 'not verified'),
    '- Stage 45: ' + (stage45Passed ? 'PASSED — DEPLOYMENT AUTHORIZED' : 'BLOCKED — DEPLOYMENT NOT AUTHORIZED'),
    '',
    '| Check | Status | Scope | Evidence hash |',
    '|---|---|---|---|',
    ...report.gates.map(g => '| ' + g.gate_id + ' — ' + g.name + ' | ' + g.status + ' | ' + g.claim_scope + ' | ' + g.evidence_hash + ' |')
  ].join('\n') + '\n', 'utf8');

  console.log('[STAGE-45]', JSON.stringify({
    total_checks: report.gates.length,
    passed: report.gates.filter(g => g.status === 'PASSED').length,
    blocked: report.blocked_count,
    external_provider_required: report.external_provider_required_count,
    failed: report.failed_count,
    exact_inventory: exactInventory,
    commit_matched: commitMatched,
    verdict: artifact.stage_45.status,
    deployment_authorized: stage45Passed,
    source_commit_sha: sourceCommitSha
  }));

  if (!stage45Passed) process.exitCode = 1;
}

main().catch(error => {
  console.error('[FATAL] Stage 45 readiness verification failed:', error);
  process.exit(1);
});
