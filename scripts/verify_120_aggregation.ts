import fs from 'fs';
import path from 'path';
import cp from 'child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DFRLFormalVerifier } from '../src/proofs/DFRLFormalVerifier';
import { DHFormalVerifier } from '../src/proofs/DHFormalVerifier';
import { computeSha256 } from '../src/database/DatabaseSchema';
import { REAL_88_PARADOX_REGISTRY } from '../src/data/paradoxData';
import { AUTHORITATIVE_32_DH_CONTRACTS } from '../src/formal/dhAuthoritativeFormalContracts';
import { DaisyActivationGate, DaisyActivationAuthorization } from '../src/brain/DaisyActivationGate';
import type { DFRL88VerificationReport } from '../src/proofs/DFRLFormalVerifier';
import type { DH32VerificationReport } from '../src/proofs/DHFormalVerifier';

export interface FormalEvidenceValidation {
  dfrlIds: string[];
  dhIds: string[];
  dfrlRootMatches: boolean;
  dhRootMatches: boolean;
  dfrlCasesValid: boolean;
  dhCasesValid: boolean;
  contractHashIntegrity: boolean;
  sourceHashIntegrity: boolean;
  replayIntegrity: boolean;
}

export function validateFormalEvidence(
  dfrlReport: DFRL88VerificationReport | null | undefined,
  dhReport: DH32VerificationReport | null | undefined,
  commitSha: string,
  readSource: (sourcePath: string) => string = sourcePath => fs.readFileSync(sourcePath, 'utf8')
): FormalEvidenceValidation {
  const invalid: FormalEvidenceValidation = {
    dfrlIds: [], dhIds: [], dfrlRootMatches: false, dhRootMatches: false,
    dfrlCasesValid: false, dhCasesValid: false, contractHashIntegrity: false,
    sourceHashIntegrity: false, replayIntegrity: false
  };
  if (!dfrlReport || !dhReport || !Array.isArray(dfrlReport.results) ||
    !Array.isArray(dfrlReport.replays) || !Array.isArray(dhReport.results) || !Array.isArray(dhReport.replays)) {
    return invalid;
  }

  const dfrlIds = dfrlReport.results.map(r => r.operator_id || r.code || '');
  const dhIds = dhReport.results.map(r => r.case_id || '');
  const matchesIds = (observed: string[], expected: string[]) =>
    observed.length === expected.length && new Set(observed).size === expected.length &&
    expected.every(id => observed.includes(id));
  const dfrlById = new Map(REAL_88_PARADOX_REGISTRY.map(item => [item.code, item]));
  const dhById = new Map(AUTHORITATIVE_32_DH_CONTRACTS.map(item => [item.case_id, item]));
  const expectedDfrlIds = REAL_88_PARADOX_REGISTRY.map(item => item.code);
  const expectedDhIds = AUTHORITATIVE_32_DH_CONTRACTS.map(item => item.case_id);
  const dfrlReplayById = new Map(dfrlReport.replays.map(replay => [replay.operator_id, replay]));
  const dhReplayById = new Map(dhReport.replays.map(replay => [replay.case_id, replay]));
  const dfrlRootMatches = dfrlReport.verification_root_sha256 === computeSha256(
    dfrlReport.results.map(r => `${r.operator_id}:${r.actual_smt_assertion_hash}:${r.solver_result}:${r.certificate_sha256}`).join('|')
  );
  const dhRootMatches = dhReport.verification_root_sha256 === computeSha256(
    dhReport.results.map(r => `${r.case_id}:${r.contract_hash}:${r.evidence_hash}:${r.actual_result}`).join('|')
  );
  const dfrlCasesValid = dfrlReport.results.length === 88 && matchesIds(dfrlIds, expectedDfrlIds) &&
    dfrlReport.results.every(r => {
      const id = r.operator_id || r.code || '';
      const contract = dfrlById.get(id);
      const replay = dfrlReplayById.get(id);
      if (!contract || !replay) return false;
      const assertionHash = computeSha256(contract.formal_invariant);
      const smtHash = computeSha256(contract.z3_smt_assertion);
      const certificateHash = computeSha256(`${id}:${contract.formal_invariant}:${smtHash}:${r.solver_result}:${r.execution_id}`);
      return Boolean(r.execution_id && r.expected_solver_result === contract.expected_solver_result &&
        r.assertion_hash === assertionHash && r.actual_smt_assertion_hash === smtHash &&
        r.certificate_sha256 === certificateHash && r.solver_result === contract.expected_solver_result && r.proved &&
        replay.replay_match && replay.original_result === r.solver_result && replay.replay_result === r.solver_result &&
        replay.original_assertion_hash === smtHash && replay.replay_assertion_hash === smtHash &&
        replay.original_evidence_hash === r.certificate_sha256 &&
        replay.replay_evidence_hash === computeSha256(`${id}:${contract.formal_invariant}:${smtHash}:${replay.replay_result}`));
    }) && dfrlReport.attempted === 88 && dfrlReport.executed === 88 &&
    dfrlReport.replays.length === 88 && dfrlRootMatches;
  const contractHashIntegrity = dhReport.results.length === 32 && matchesIds(dhIds, expectedDhIds) &&
    dhReport.results.every(r => {
      const contract = dhById.get(r.case_id);
      if (!contract) return false;
      const { contract_hash: _storedHash, ...canonicalContract } = contract;
      const expectedHash = computeSha256(JSON.stringify(canonicalContract));
      return r.contract_hash === contract.contract_hash && r.contract_hash === expectedHash;
    });
  const sourceHashIntegrity = dhReport.results.length === 32 && dhReport.results.every(r => {
    const contract = dhById.get(r.case_id);
    if (!contract || r.commit_sha !== commitSha) return false;
    try {
      const sourceContentHash = computeSha256(readSource(contract.source_file));
      const sourceHash = computeSha256(`${contract.source_file}:${sourceContentHash}:${contract.contract_hash}:${commitSha}`);
      return r.source_content_hash === sourceContentHash && r.source_hash === sourceHash;
    } catch {
      return false;
    }
  });
  const replayIntegrity = dhReport.results.length === 32 && dhReport.replays.length === 32 &&
    matchesIds(dhReport.replays.map(replay => replay.case_id), expectedDhIds) &&
    dhReport.results.every(r => {
      const replay = dhReplayById.get(r.case_id);
      if (!replay) return false;
      const expectedReplayEvidence = computeSha256(
        `${r.case_id}:${replay.cleanroom_context_id}:${r.contract_hash}:${r.replay_result}:${commitSha}`
      );
      return Boolean(r.replay_match && r.replay_result === r.actual_result &&
        replay.original_result === r.actual_result && replay.replay_result === r.actual_result && replay.replay_match &&
        replay.original_evidence_hash === r.evidence_hash && replay.cleanroom_context_id.length > 0 &&
        replay.replay_evidence_hash === expectedReplayEvidence);
    });
  const dhCasesValid = dhReport.results.length === 32 && matchesIds(dhIds, expectedDhIds) &&
    dhReport.results.every(r => r.verified &&
      r.actual_result === dhById.get(r.case_id)?.expected_result &&
      r.expected_result === dhById.get(r.case_id)?.expected_result &&
      r.replay_result === r.actual_result && r.replay_match &&
      ['MODEL_VERIFIED', 'MODEL_VERIFIED_BOUNDED', 'MODEL_VERIFIED_AXIOMATIC'].includes(r.scope) &&
      (r.actual_result === 'unsat' || r.actual_result === 'sat') &&
      r.evidence_integrity === 'PASS' && r.source_integrity === 'PASS' && r.commit_sha === commitSha &&
      r.evidence_hash === computeSha256(`${r.case_id}:${r.contract_hash}:${r.source_hash}:${r.actual_result}:${r.replay_result}:${commitSha}`) &&
      /^[a-f0-9]{64}$/i.test(r.evidence_hash)) && dhReport.attempted === 32 && dhReport.executed === 32 && dhRootMatches;
    const dhCasesWithIntegrity = dhCasesValid && contractHashIntegrity && sourceHashIntegrity && replayIntegrity;

  return {
      dfrlIds, dhIds, dfrlRootMatches, dhRootMatches, dfrlCasesValid, dhCasesValid: dhCasesWithIntegrity,
    contractHashIntegrity, sourceHashIntegrity, replayIntegrity
  };
}

async function main() {
  console.log('================================================================');
  console.log(' PROJECT AGATE / DAISY / SOLVEX — 120-CASE FORMAL Z3 AGGREGATION');
  console.log(' (88 DFRL OPERATORS + 32 DH PARADOX CONTRACTS)');
  console.log('================================================================');

  DHFormalVerifier.setPlatform({
    execSync: cp.execSync,
    fs
  });

  const dhVerifier = DHFormalVerifier.getInstance();
  const commitSha = dhVerifier.getCommitSha();
  console.log(`Current Git Commit SHA: ${commitSha}`);

  const startTime = Date.now();
  const outDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('\n[STAGE 1/2] Executing 88 DFRL Operators through Microsoft Research Z3...');
  const dfrlVerifier = DFRLFormalVerifier.getInstance();
  const dfrlReport = await dfrlVerifier.verifyAll88();
  console.log(` -> DFRL Executed:       ${dfrlReport.executed} / ${dfrlReport.total_operators}`);
  console.log(` -> DFRL status:         ${dfrlReport.overall_status}`);
  console.log(` -> DFRL Replays:        ${dfrlReport.deterministic_replays_matched} / ${dfrlReport.total_operators}`);

  console.log('\n[STAGE 2/2] Executing 32 DH Formal Contracts through Microsoft Research Z3...');
  const dhReport = await dhVerifier.verifyAll32();
  console.log(` -> DH Executed:         ${dhReport.executed} / ${dhReport.total_cases}`);
  console.log(` -> DH Expected Matches: ${dhReport.expected_result_matches} / ${dhReport.total_cases}`);
  console.log(` -> DH Replays:          ${dhReport.replay_matches} / ${dhReport.total_cases}`);
  console.log(` -> DH Blocked:          ${dhReport.blocked_count}`);

  const totalZ3Executions = dfrlReport.executed + dhReport.executed;
  const dfrlExpectedMatches = dfrlReport.results.filter(r =>
    r.proved && (r.solver_result === 'unsat' || r.solver_result === 'sat') && r.claim_scope === 'MODEL_VERIFIED'
  ).length;
  const totalExpectedMatches = dfrlExpectedMatches + dhReport.expected_result_matches;
  const totalReplays = dfrlReport.replays.length + dhReport.replays.length;
  const totalReplayMatches = dfrlReport.deterministic_replays_matched + dhReport.replay_matches;
  const totalUnknown = dfrlReport.unknown_count + dhReport.unknown_count;
  const totalError = dfrlReport.error_count + dhReport.error_count;

  const validation = validateFormalEvidence(dfrlReport, dhReport, commitSha);
  const {
    dfrlIds,
    dhIds,
    dfrlRootMatches,
    dhRootMatches,
    dfrlCasesValid,
    dhCasesValid,
    contractHashIntegrity,
    sourceHashIntegrity,
    replayIntegrity
  } = validation;

  // Bind this run to the exact checkout and preserve expected SAT case identities.
  const dfrlRootSha256 = dfrlReport.verification_root_sha256;
  const dhRootSha256 = dhReport.verification_root_sha256;
  const combinedRootSha256 = computeSha256(JSON.stringify({
    schema: 'SOLVEX_DAISY_FORMAL_CORPUS_ROOT_V1',
    source_commit_sha: commitSha,
    dfrl_root_sha256: dfrlRootSha256,
    dh_root_sha256: dhRootSha256
  }));
  const expectedDfrlSatCaseIds = REAL_88_PARADOX_REGISTRY.filter(r => r.expected_solver_result === 'sat').map(r => r.code).sort();
  const observedDfrlSatCaseIds = dfrlReport.results.filter(r => r.solver_result === 'sat').map(r => r.operator_id || r.code || '').sort();
  const replayedDfrlSatCaseIds = dfrlReport.replays.filter(r => r.replay_result === 'sat').map(r => r.operator_id).sort();
  const expectedDhSatCaseIds = dhReport.results.filter(r => r.expected_result === 'sat').map(r => r.case_id).sort();
  const observedDhSatCaseIds = dhReport.results.filter(r => r.actual_result === 'sat').map(r => r.case_id).sort();
  const replayedDhSatCaseIds = dhReport.results.filter(r => r.replay_result === 'sat').map(r => r.case_id).sort();
  const satIdentityMatches = JSON.stringify(expectedDfrlSatCaseIds) === JSON.stringify(observedDfrlSatCaseIds) &&
    JSON.stringify(expectedDfrlSatCaseIds) === JSON.stringify(replayedDfrlSatCaseIds) &&
    JSON.stringify(expectedDhSatCaseIds) === JSON.stringify(observedDhSatCaseIds) &&
    JSON.stringify(expectedDhSatCaseIds) === JSON.stringify(replayedDhSatCaseIds);

  const passed120 = satIdentityMatches && totalZ3Executions === 120 && totalExpectedMatches === 120 &&
    totalReplays === 120 && totalReplayMatches === 120 && totalUnknown === 0 && totalError === 0 &&
    dfrlReport.overall_status === 'VERIFIED' && dhReport.overall_status === 'VERIFIED' &&
    dhReport.blocked_count === 0 && dfrlCasesValid && dhCasesValid &&
    contractHashIntegrity && sourceHashIntegrity && replayIntegrity;

  console.log('\n[STAGE 3] Adversarial mutation / fail-closed checks...');
  const mutation = await dfrlVerifier.runSmtMutationTest();
  const fault = await dfrlVerifier.runZ3FailureInjectionTest();
  const tamper = dfrlVerifier.runArtifactTamperTest(dfrlReport);
  const dhMutation = await dhVerifier.runSmtMutationTest();
  const dhFault = await dhVerifier.runFailureInjectionTest();
  const dhTamper = dhVerifier.runArtifactTamperTest(dhReport);
  const adversarialOk = mutation.passed && fault.passed && tamper.passed &&
    dhMutation.passed && dhFault.passed && dhTamper.passed &&
    contractHashIntegrity && sourceHashIntegrity && replayIntegrity;
  const runEvidenceSha256 = computeSha256(JSON.stringify({
    schema: 'SOLVEX_DAISY_FORMAL_RUN_RECEIPT_V2',
    source_commit_sha: commitSha,
    dfrl_execution_id: dfrlReport.execution_id,
    dfrl_timestamp: dfrlReport.timestamp,
    dh_execution_id: dhReport.execution_id,
    dh_timestamp: dhReport.timestamp,
    dfrl_root_sha256: dfrlRootSha256,
    dh_root_sha256: dhRootSha256,
    expected_matches: totalExpectedMatches,
    replay_matches: totalReplayMatches,
    unknown: totalUnknown,
    errors: totalError,
    adversarial: { mutation, fault, tamper, dhMutation, dhFault, dhTamper },
    integrity: { contractHashIntegrity, sourceHashIntegrity, replayIntegrity }
  }));
  console.log(` -> DFRL mutation/fault/tamper: ${mutation.passed}/${fault.passed}/${tamper.passed}`);
  console.log(` -> DH mutation/fault/tamper:   ${dhMutation.passed}/${dhFault.passed}/${dhTamper.passed}`);
  console.log(` -> DH contract/source/replay integrity: ${contractHashIntegrity}/${sourceHashIntegrity}/${replayIntegrity}`);

  console.log('[120-GATE-DIAGNOSTICS]', JSON.stringify({
    totalZ3Executions,
    totalExpectedMatches,
    totalReplays,
    totalReplayMatches,
    totalUnknown,
    totalError,
    dfrlOverallStatus: dfrlReport.overall_status,
    dhOverallStatus: dhReport.overall_status,
    dfrlResultsCount: dfrlReport.results.length,
    dfrlUniqueIds: new Set(dfrlIds).size,
    dfrlAllProved: dfrlReport.results.every(r => r.proved),
    dfrlAllResultsSatOrUnsat: dfrlReport.results.every(r => r.solver_result === 'unsat' || r.solver_result === 'sat'),
    dfrlReplayCount: dfrlReport.replays.length,
    dfrlReplayIntegrity: dfrlReport.replays.every(r => r.replay_match &&
      (r.original_result === 'unsat' || r.original_result === 'sat') &&
      r.replay_result === r.original_result &&
      r.original_assertion_hash === r.replay_assertion_hash),
    dhResultsCount: dhReport.results.length,
    dhUniqueIds: new Set(dhIds).size,
    dfrlCasesValid,
    dhCasesValid,
    contractHashIntegrity,
    sourceHashIntegrity,
    replayIntegrity,
    passed120,
    adversarialOk
  }));

  // Print precise failing DFRL identities before the separate 46-gate process starts.
  // This preserves actionable evidence even if a later stage exhausts memory.
  const dfrlFailures = dfrlReport.results.flatMap((r, index) => {
    const replay = dfrlReport.replays[index];
    if (r.proved && replay?.replay_match) return [];
    return [{
      case_id: r.operator_id || r.code,
      expected: r.expected_solver_result,
      observed: r.solver_result,
      proved: r.proved,
      replay_result: replay?.replay_result,
      replay_match: replay?.replay_match,
      assertion_hash: r.actual_smt_assertion_hash,
      replay_assertion_hash: replay?.replay_assertion_hash,
      error: r.error
    }];
  });
  console.log('[DFRL-CASE-FAILURES]', JSON.stringify(dfrlFailures));

  // 46-gate suite is required for ACTIVE; if unavailable, stay BLOCKED.
  let gatesPassed = 0;
  let gatesTotal = 0;
  let gatesFailed = 0;
  let gatesReport: any = null;
  try {
    // Remove any checked-in or stale result first: a child crash must never
    // let this run accept gate evidence from an earlier commit or workflow.
    const gateArtifactPath = path.join(outDir, 'system-46-gates.json');
    if (fs.existsSync(gateArtifactPath)) fs.unlinkSync(gateArtifactPath);

    // Run the 46-gate suite in a child process. The 120-case WASM corpus creates
    // many solver contexts; re-running the authoritative pipeline in this same
    // process can exhaust the WASM heap (~2 GiB) after the corpus has completed.
    // A separate process gives the gate suite a fresh WASM heap; any child failure
    // remains BLOCKED and is never treated as a pass.
    cp.execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/verify_46_gates.ts'], {
      stdio: 'inherit',
      timeout: 80 * 60 * 1000
    });
    if (!fs.existsSync(gateArtifactPath)) throw new Error('Isolated 46-gate process produced no system-46-gates.json artifact');
    gatesReport = JSON.parse(fs.readFileSync(gateArtifactPath, 'utf8'));
    if (gatesReport.source_commit_sha !== commitSha || gatesReport.isolated_process !== true) {
      throw new Error('Isolated 46-gate artifact provenance mismatch; activation remains BLOCKED');
    }
    gatesTotal = gatesReport.total_gates;
    gatesPassed = gatesReport.gates.filter((g: any) => g.status === 'PASSED').length;
    // BLOCKED and EXTERNAL_PROVIDER_REQUIRED are not passes; never exclude them.
    gatesFailed = gatesReport.gates.filter((g: any) => g.status !== 'PASSED').length;
    console.log('[46-GATE-DIAGNOSTICS]', JSON.stringify({
      total: gatesTotal,
      passed: gatesPassed,
      notPassed: gatesFailed,
      blocked: gatesReport.blocked_count,
      externalProviderRequired: gatesReport.external_provider_required_count,
      failed: gatesReport.failed_count,
      verdict: gatesReport.overall_verdict,
      nonPassedGateIds: gatesReport.gates.filter((g: any) => g.status !== 'PASSED').map((g: any) => ({
        gate_number: g.gate_number, gate_id: g.gate_id, status: g.status, name: g.name
      }))
    }));
  } catch (e: any) {
    console.warn('System46Gates isolated process not completed; activation remains BLOCKED:', e?.message || e);
  }

  let activationAuthorization: DaisyActivationAuthorization | undefined;
  const activationAuthorizationPath = path.join(outDir, 'daisy-activation-authorization.json');
  if (fs.existsSync(activationAuthorizationPath)) {
    try {
      activationAuthorization = JSON.parse(fs.readFileSync(activationAuthorizationPath, 'utf8')) as DaisyActivationAuthorization;
    } catch {}
  }
  const activationAuthorizationValid = Boolean(activationAuthorization &&
    DaisyActivationGate.verifyAuthorization(
      activationAuthorization,
      commitSha,
      combinedRootSha256,
      runEvidenceSha256
    ));
  const brainActive =
    passed120 &&
    satIdentityMatches &&
    adversarialOk &&
    gatesTotal > 0 &&
    gatesPassed === gatesTotal &&
    gatesFailed === 0 &&
    activationAuthorizationValid;

  const activationGate = {
    schema_version: '1.0.0',
    status: brainActive ? 'ACTIVE' : 'BLOCKED',
    reason: brainActive
      ? 'Formal, adversarial, 46-gate, and signed human-root authorization evidence passed.'
      : activationAuthorizationValid
        ? 'Activation blocked until formal corpus, adversarial checks, and all 46 system gates pass; no provider or blocked gate may be excluded.'
        : 'Activation blocked: fresh signed human-root authorization for this source commit and run evidence is unavailable or invalid.',
    commit_sha: commitSha,
    source_commit_sha: commitSha,
    verification_root_sha256: combinedRootSha256,
    run_evidence_sha256: runEvidenceSha256,
    activation_authorization: activationAuthorization ?? null,
    timestamp: new Date().toISOString(),
    corpus: {
      total_required: 120,
      dfrl_required: 88,
      dh_required: 32,
      executed: totalZ3Executions,
      deterministic_replays: totalReplayMatches,
      unknown: totalUnknown,
      errors: totalError,
      dfrl_cases_valid: dfrlCasesValid,
      dh_cases_valid: dhCasesValid,
      passed_120: passed120,
      sat_case_identities_match: satIdentityMatches
    },
    adversarial_verification: {
      passed: adversarialOk,
      dfrl_mutation: mutation.passed,
      dfrl_failure_injection: fault.passed,
      dfrl_tamper_alarm: tamper.passed,
      dh_smt_mutation: dhMutation.passed,
      dh_failure_injection: dhFault.passed,
      dh_artifact_tamper: dhTamper.passed,
      contract_hash_integrity: contractHashIntegrity,
      source_hash_integrity: sourceHashIntegrity,
      replay_integrity: replayIntegrity
    },
    mandatory_gates: {
      total: 46,
      observed: gatesReport?.gates?.length ?? gatesTotal,
      passed: gatesPassed,
      failed: gatesReport?.failed_count ?? 0,
      blocked: gatesReport?.blocked_count ?? 0,
      external_provider_required: gatesReport?.external_provider_required_count ?? 0,
      non_passed: gatesFailed
    }
  };

  // Write the canonical closure artifact names consumed by scripts/ci_proof_closure_check.ts.
  // All values below are derived from this run's verifier outputs; no result is hand-edited.
  const totalUnsat = dfrlReport.unsat_count + dhReport.unsat_count;
  const totalSat = dfrlReport.sat_count + dhReport.sat_count;
  const dfrlReplayMatches = dfrlReport.deterministic_replays_matched;
  const dhReplayMatches = dhReport.replay_matches;
  const sourceCommitSha = commitSha;
  const formalAggregationArtifact = {
    aggregation_name: 'Z3_120_FORMAL_AGGREGATION',
    commit_sha: sourceCommitSha,
    source_commit_sha: sourceCommitSha,
    verification_root_sha256: combinedRootSha256,
    run_evidence_sha256: runEvidenceSha256,
    sat_case_identities: {
      dfrl: { expected: expectedDfrlSatCaseIds, observed: observedDfrlSatCaseIds, replayed: replayedDfrlSatCaseIds },
      dh: { expected: expectedDhSatCaseIds, observed: observedDhSatCaseIds, replayed: replayedDhSatCaseIds },
      identities_match: satIdentityMatches
    },
    integrity_checks: { contractHashIntegrity, sourceHashIntegrity, replayIntegrity },
    timestamp: new Date().toISOString(),
    dfrl: {
      required: 88, actual_z3_executions: dfrlReport.executed,
      replays: dfrlReport.replays.length, replay_matches: dfrlReplayMatches,
      unsat_count: dfrlReport.unsat_count, sat_count: dfrlReport.sat_count,
      unknown_count: dfrlReport.unknown_count, error_count: dfrlReport.error_count,
      root_hash: dfrlReport.verification_root_sha256, status: dfrlReport.overall_status
    },
    dh: {
      required: 32, actual_z3_executions: dhReport.executed,
      replays: dhReport.replays.length, replay_matches: dhReplayMatches,
      unsat_count: dhReport.unsat_count, sat_count: dhReport.sat_count,
      unknown_count: dhReport.unknown_count, error_count: dhReport.error_count,
      status: dhReport.overall_status
    },
    total: {
      required: 120, actual_z3_executions: totalZ3Executions,
      replays: totalReplays, replay_matches: totalReplayMatches,
      distribution: { unsat: totalUnsat, sat: totalSat, unknown: totalUnknown, error: totalError },
      closure_verdict: passed120 ? 'PROVEN_120_FORMAL_CLOSURE' : 'BLOCKED'
    }
  };
  fs.writeFileSync(path.join(outDir, 'formal-aggregation.json'), JSON.stringify(formalAggregationArtifact, null, 2));

  const summaryArtifact = {
    aggregation_name: 'Z3_120_FORMAL_VERIFICATION_SUMMARY',
    commit_sha: sourceCommitSha,
    source_commit_sha: sourceCommitSha,
    verification_root_sha256: combinedRootSha256,
    run_evidence_sha256: runEvidenceSha256,
    sat_case_identities: {
      dfrl: { expected: expectedDfrlSatCaseIds, observed: observedDfrlSatCaseIds, replayed: replayedDfrlSatCaseIds },
      dh: { expected: expectedDhSatCaseIds, observed: observedDhSatCaseIds, replayed: replayedDhSatCaseIds },
      identities_match: satIdentityMatches
    },
    integrity_checks: { contractHashIntegrity, sourceHashIntegrity, replayIntegrity },
    timestamp: new Date().toISOString(),
    total_z3_executions: totalZ3Executions,
    expected_result_matches: totalExpectedMatches,
    cleanroom_replays: totalReplays,
    replay_matches: totalReplayMatches,
    distribution: { unsat: totalUnsat, sat: totalSat, unknown: totalUnknown, error: totalError },
    subsystems: {
      dfrl: { total_required: 88, executed: dfrlReport.executed, expected_matches: dfrlExpectedMatches, replays_matched: dfrlReplayMatches, root_hash: dfrlReport.verification_root_sha256, status: dfrlReport.overall_status },
      dh: { total_required: 32, executed: dhReport.executed, expected_matches: dhReport.expected_result_matches, replays_matched: dhReplayMatches, sat_count: dhReport.sat_count, unsat_count: dhReport.unsat_count, status: dhReport.overall_status }
    },
    activation_gate: passed120 ? 'PROVEN_120_FORMAL_CLOSURE' : 'BLOCKED'
  };
  fs.writeFileSync(path.join(outDir, 'z3-120-formal-verification-summary.json'), JSON.stringify(summaryArtifact, null, 2));

  if (!gatesReport || gatesTotal !== 46 || gatesReport.gates?.length !== 46 || new Set(gatesReport.gates.map((g: any) => g.gate_id)).size !== 46) {
    console.error('[46-GATE-INVENTORY] BLOCKED: expected exactly 46 unique gate records from System46Gates; no synthetic inventory is accepted.');
  }
  const executionGatesPath = path.join(outDir, 'execution-gates.json');
  if (!fs.existsSync(executionGatesPath)) {
    console.warn('[CLOSURE-ARTIFACT] execution-gates.json must be generated by verify:authoritative before closure; not fabricated by the aggregation stage.');
  }

  // ALWAYS write — CI checks for this path even when status is BLOCKED.
  const gatePath = path.join(outDir, 'daisy-brain-activation-gate.json');
  fs.writeFileSync(gatePath, JSON.stringify(activationGate, null, 2));
  console.log(`Wrote ${gatePath} status=${activationGate.status}`);

  const durationMs = Date.now() - startTime;
  const outPath = path.join(outDir, `verify-120-aggregation-${commitSha.slice(0, 12)}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        commit_sha: commitSha,
        timestamp: new Date().toISOString(),
        duration_ms: durationMs,
        passed_120: passed120,
        adversarial_ok: adversarialOk,
        brain_active: brainActive,
        dfrl: dfrlReport,
        dh: dhReport,
        totals: {
          totalZ3Executions,
          totalExpectedMatches,
          totalReplays,
          totalReplayMatches,
          totalUnknown,
          totalError,
          dfrlCasesValid,
          dhCasesValid
        },
        adversarial: { mutation, fault, tamper, dhMutation, dhFault, dhTamper },
        integrity_checks: { contractHashIntegrity, sourceHashIntegrity, replayIntegrity },
        activation_gate: activationGate
      },
      null,
      2
    )
  );
  console.log(`Wrote ${outPath}`);

  // Hash the exact generated artifact bytes after all writers have completed.
  // This manifest excludes itself to avoid a self-referential hash.
  const hashTargets = [
    'formal-aggregation.json',
    'z3-120-formal-verification-summary.json',
    'daisy-brain-activation-gate.json',
    'system-46-gates.json',
    'execution-gates.json',
    path.basename(outPath)
  ];
  const artifactHashes: Record<string, string> = {};
  for (const name of hashTargets) {
    const file = path.join(outDir, name);
    if (fs.existsSync(file)) artifactHashes[name] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  const artifactHashManifest = {
    schema: 'SOLVEX_DAISY_GENERATED_ARTIFACT_HASH_MANIFEST_V1',
    source_commit_sha: commitSha,
    generated_at: new Date().toISOString(),
    verification_root_sha256: combinedRootSha256,
    run_evidence_sha256: runEvidenceSha256,
    artifact_sha256: artifactHashes,
    missing_expected_artifacts: hashTargets.filter(name => !artifactHashes[name])
  };
  fs.writeFileSync(path.join(outDir, 'formal-artifact-sha256.json'), JSON.stringify(artifactHashManifest, null, 2));
  console.log('[ARTIFACT-SHA256]', JSON.stringify(artifactHashManifest));
  console.log(`Activation Gate Verdict:   ${activationGate.status}`);
  console.log(passed120 && adversarialOk ? 'AGGREGATION: corpus+adversarial OK' : 'AGGREGATION: FAIL');

  // Formal verification success ≠ Daisy activation.
  // Exit 0 when the 120 corpus + adversarial checks pass and the activation artifact
  // was written. brainActive may still be BLOCKED (e.g. GATE-11 EXTERNAL_PROVIDER_REQUIRED).
  // Never force ACTIVE; never treat intentional BLOCKED activation as a formal failure.
  const formalOk = passed120 && adversarialOk && fs.existsSync(gatePath);
  if (formalOk && !brainActive) {
    console.log(
      'FORMAL_OK_ACTIVATION_BLOCKED: 120/adversarial passed; activation remains BLOCKED until all 46 gates PASS (including external providers when required).'
    );
  }
  process.exit(formalOk ? 0 : 1);
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  main().catch((e) => {
    console.error(e);
    try {
      const outDir = path.join(process.cwd(), 'artifacts');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'daisy-brain-activation-gate.json'),
        JSON.stringify(
          {
            schema_version: '1.0.0',
            status: 'BLOCKED',
            reason: `verify_120 crashed: ${e?.message || String(e)}`,
            timestamp: new Date().toISOString()
          },
          null,
          2
        )
      );
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}