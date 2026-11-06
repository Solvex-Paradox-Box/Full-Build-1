import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { System46Gates } from '../src/proofs/System46Gates';
import { AuthoritativeVerificationPipeline } from '../src/tests/authoritativeVerificationPipeline';
import { setDiskDbChecker } from '../src/tests/persistenceVerification';

async function main() {
  const root = process.cwd();
  const artifactsDir = path.join(root, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  AuthoritativeVerificationPipeline.setNodePlatform({ execSync: cp.execSync, fs, path });
  setDiskDbChecker((file: string) => fs.existsSync(file));

  const sourceCommitSha = cp.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const report = await System46Gates.getInstance().evaluateAll46Gates();
  const artifact = {
    ...report,
    source_commit_sha: sourceCommitSha,
    isolated_process: true
  };
  const persistenceGate = artifact.gates.find(g => g.gate_id === 'GATE-10');
  const masterGate = artifact.gates.find(g => g.gate_id === 'GATE-46');
  console.log('[GATE-10-DIAGNOSTICS]', JSON.stringify(persistenceGate?.details ?? { missing: true }));
  console.log('[GATE-46-DIAGNOSTICS]', JSON.stringify(masterGate?.details ?? { missing: true }));

  const output = path.join(artifactsDir, 'system-46-gates.json');
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2), 'utf8');

  console.log('[46-GATE-DIAGNOSTICS]', JSON.stringify({
    total: artifact.total_gates,
    observed: artifact.gates.length,
    passed: artifact.gates.filter(g => g.status === 'PASSED').length,
    blocked: artifact.blocked_count,
    external_provider_required: artifact.external_provider_required_count,
    failed: artifact.failed_count,
    verdict: artifact.overall_verdict,
    source_commit_sha: sourceCommitSha,
    isolated_process: true
  }));

  if (artifact.total_gates !== 46 || artifact.gates.length !== 46 ||
      new Set(artifact.gates.map(g => g.gate_id)).size !== 46) {
    throw new Error('Authoritative 46-gate inventory is incomplete or contains duplicate IDs');
  }
}
main().catch(error => {
  console.error('[FATAL] Isolated 46-gate verification failed:', error);
  process.exit(1);
});
