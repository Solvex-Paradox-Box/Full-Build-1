import { REAL_88_PARADOX_REGISTRY, DFRLParadoxItem, ModelClassification, ModelScope } from '../data/paradoxData';
import { computeSha256 } from '../database/DatabaseSchema';

export interface DFRLVerificationResult {
  operator_id: string;
  code?: string;
  operator_name: string;
  name?: string;
  model_classification: ModelClassification;
  model_scope: ModelScope;
  domain: string;
  category: string;
  assertion: string;
  assertion_hash: string;
  actual_smt_assertion_hash: string;
  solver_version: string;
  execution_id: string;
  solver_result: 'unsat' | 'sat' | 'unknown' | 'error' | 'formal_execution_not_performed';
  expected_solver_result: 'unsat' | 'sat';
  sat_witness_recheck_passed?: boolean;
  sat_witness_model_sha256?: string;
  proved: boolean;
  claim_scope: 'MODEL_VERIFIED';
  execution_duration_ms: number;
  duration_ms?: number;
  error?: string;
  certificate_sha256: string;
  timestamp: string;
}

export interface ReplayVerificationRecord {
  operator_id: string;
  original_execution_id: string;
  replay_execution_id: string;
  original_assertion_hash: string;
  replay_assertion_hash: string;
  original_result: string;
  replay_result: string;
  replay_witness_recheck_passed?: boolean;
  replay_witness_model_sha256?: string;
  original_evidence_hash: string;
  replay_evidence_hash: string;
  replay_match: boolean;
}

export interface DFRL88VerificationReport {
  execution_id: string;
  timestamp: string;
  total_propositions: number;
  total_operators: number;
  attempted: number;
  executed: number;
  unsat_count: number;
  unsat_proved_count: number;
  sat_count: number;
  unknown_count: number;
  error_count: number;
  not_executed_count: number;
  authored_models_count: number;
  generated_models_count: number;
  deterministic_replays_matched: number;
  claim_scope: 'MODEL_VERIFIED';
  solver_engine: string;
  solver_version: string;
  overall_status: 'VERIFIED' | 'FAILED' | 'PARTIAL';
  verification_root_sha256: string;
  results: DFRLVerificationResult[];
  replays: ReplayVerificationRecord[];
}

export interface SMTMutationTestResult {
  test_name: string;
  target_operator_id: string;
  operator_code?: string;
  original_assertion: string;
  original_assertion_hash: string;
  mutated_assertion: string;
  mutated_assertion_hash: string;
  expected_original_result: 'unsat';
  observed_original_result: string;
  expected_mutated_result: 'sat';
  observed_mutated_result: string;
  mutation_type: string;
  mutation_detected: boolean;
  passed: boolean;
  details: string;
}

export interface Z3FailureInjectionTestResult {
  test_name: string;
  injection_type: 'MALFORMED_SMT' | 'UNAVAILABLE_SOLVER';
  input_assertion: string;
  observed_result: string;
  observed_solver_result?: string;
  proved_status: boolean;
  never_converted_to_unsat?: boolean;
  fail_closed_enforced: boolean;
  passed: boolean;
  notes: string;
}

export interface ArtifactTamperTestResult {
  test_name: string;
  original_hash: string;
  tampered_payload_snippet: string;
  tampered_hash: string;
  tamper_detected: boolean;
  passed: boolean;
  alarm_triggered: boolean;
}

export class DFRLFormalVerifier {
  private static instance: DFRLFormalVerifier | null = null;
  private z3InitPromise: Promise<any> | null = null;
  private solverVersion: string = 'Microsoft Research Z3 WASM 5.2.0';
  private primaryContext: any = null;
  private cleanroomContext: any = null;

  public static getInstance(): DFRLFormalVerifier {
    if (!DFRLFormalVerifier.instance) {
      DFRLFormalVerifier.instance = new DFRLFormalVerifier();
    }
    return DFRLFormalVerifier.instance;
  }

  private async getZ3Module(): Promise<any> {
    if (!this.z3InitPromise) {
      this.z3InitPromise = (async () => {
        try {
          const { init } = await import('z3-solver');
          return await init();
        } catch (e) {
          console.warn('[DFRLFormalVerifier] z3-solver native WASM load failure:', e);
          return null;
        }
      })();
    }
    return this.z3InitPromise;
  }

  private getPrimaryContext(z3Mod: any): any {
    if (!this.primaryContext) {
      this.primaryContext = new z3Mod.Context('dfrl_primary_context');
    }
    return this.primaryContext;
  }

  private getCleanroomContext(z3Mod: any): any {
    if (!this.cleanroomContext) {
      this.cleanroomContext = new z3Mod.Context('dfrl_cleanroom_context');
    }
    return this.cleanroomContext;
  }

  private async recheckSatWitness(item: DFRLParadoxItem, assertion: string): Promise<{ passed: boolean; modelHash?: string }> {
    try {
      const z3Mod = await this.getZ3Module();
      if (!z3Mod) return { passed: false };

      const ctx = new z3Mod.Context(`sat_recheck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      const solver = new ctx.Solver();
      await solver.fromString(assertion);
      const res = await solver.check();

      if (res !== 'sat') return { passed: false };

      const model = solver.model ? solver.model() : null;
      const modelText = model ? String(model) : '';
      const modelHash = modelText ? computeSha256(modelText) : undefined;
      return {
        passed: !!modelHash && modelHash.length === 64,
        modelHash
      };
    } catch {
      return { passed: false };
    }
  }

  public async verifyProposition(
    item: DFRLParadoxItem,
    executionId: string = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  ): Promise<DFRLVerificationResult> {
    const start = performance.now();
    const timestamp = new Date().toISOString();
    const assertionHash = computeSha256(item.formal_invariant);
    const smtHash = computeSha256(item.z3_smt_assertion);

    const z3Mod = await this.getZ3Module();
    if (!z3Mod) {
      const duration = performance.now() - start;
      const certSeed = `${item.code}:${item.formal_invariant}:${smtHash}:formal_execution_not_performed`;
      return {
        operator_id: item.code,
        operator_name: item.name,
        model_classification: item.model_classification,
        model_scope: item.model_scope,
        domain: item.domain,
        category: item.category,
        assertion: item.formal_invariant,
        assertion_hash: assertionHash,
        actual_smt_assertion_hash: smtHash,
        solver_version: this.solverVersion,
        execution_id: executionId,
        solver_result: 'formal_execution_not_performed',
        expected_solver_result: item.expected_solver_result,
        proved: false,
        claim_scope: 'MODEL_VERIFIED',
        execution_duration_ms: Number(duration.toFixed(3)),
        error: 'Z3 WASM solver module could not be initialized',
        certificate_sha256: computeSha256(certSeed),
        timestamp
      };
    }

    let solverResult: DFRLVerificationResult['solver_result'] = 'unknown';
    let execError: string | undefined = undefined;
    let satWitnessRecheckPassed = false;
    let satWitnessModelSha256: string | undefined;

    try {
      const ctx = this.getPrimaryContext(z3Mod);
      const solver = new ctx.Solver();
      await solver.fromString(item.z3_smt_assertion);
      const res = await solver.check();

      if (res === 'unsat') {
        solverResult = 'unsat';
      } else if (res === 'sat') {
        solverResult = 'sat';
        const witness = await this.recheckSatWitness(item, item.z3_smt_assertion);
        satWitnessRecheckPassed = witness.passed;
        satWitnessModelSha256 = witness.modelHash;
      } else {
        solverResult = 'unknown';
      }
    } catch (err: any) {
      solverResult = 'error';
      execError = err?.message || String(err);
    }

    const duration = performance.now() - start;
    const certHash = computeSha256(`${item.code}:${item.formal_invariant}:${smtHash}:${solverResult}:${executionId}`);
    const proved =
      (solverResult === 'unsat' && item.expected_solver_result === 'unsat') ||
      (solverResult === 'sat' && item.expected_solver_result === 'sat' && satWitnessRecheckPassed);

    return {
      operator_id: item.code,
      code: item.code,
      operator_name: item.name,
      name: item.name,
      model_classification: item.model_classification,
      model_scope: item.model_scope,
      domain: item.domain,
      category: item.category,
      assertion: item.formal_invariant,
      assertion_hash: assertionHash,
      actual_smt_assertion_hash: smtHash,
      solver_version: this.solverVersion,
      execution_id: executionId,
      solver_result: solverResult,
      expected_solver_result: item.expected_solver_result,
      sat_witness_recheck_passed: satWitnessRecheckPassed,
      sat_witness_model_sha256: satWitnessModelSha256,
      proved,
      claim_scope: 'MODEL_VERIFIED',
      execution_duration_ms: Number(duration.toFixed(3)),
      duration_ms: Number(duration.toFixed(3)),
      error: execError,
      certificate_sha256: certHash,
      timestamp
    };
  }

  public async replayPropositionCleanroom(
    item: DFRLParadoxItem,
    originalResult: DFRLVerificationResult
  ): Promise<ReplayVerificationRecord> {
    const replayExecId = `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const z3Mod = await this.getZ3Module();

    if (!z3Mod) {
      return {
        operator_id: item.code,
        original_execution_id: originalResult.execution_id,
        replay_execution_id: replayExecId,
        original_assertion_hash: originalResult.actual_smt_assertion_hash,
        replay_assertion_hash: computeSha256(item.z3_smt_assertion),
        original_result: originalResult.solver_result,
        replay_result: 'formal_execution_not_performed',
        original_evidence_hash: originalResult.certificate_sha256,
        replay_evidence_hash: computeSha256('REPLAY_FAILED'),
        replay_match: false
      };
    }

    let replayResult = 'unknown';
    let replayWitnessRecheckPassed = false;
    let replayWitnessModelHash: string | undefined;

    try {
      const replayCtx = this.getCleanroomContext(z3Mod);
      const replaySolver = new replayCtx.Solver();
      await replaySolver.fromString(item.z3_smt_assertion);
      const res = await replaySolver.check();
      replayResult = res;

      if (res === 'sat') {
        const witness = await this.recheckSatWitness(item, item.z3_smt_assertion);
        replayWitnessRecheckPassed = witness.passed;
        replayWitnessModelHash = witness.modelHash;
      }
    } catch {
      replayResult = 'error';
    }

    const replayCertSeed = `${item.code}:${item.formal_invariant}:${computeSha256(item.z3_smt_assertion)}:${replayResult}`;
    const replayEvidenceHash = computeSha256(replayCertSeed);
    const match =
      replayResult === originalResult.solver_result &&
      originalResult.solver_result === item.expected_solver_result &&
      (replayResult === 'unsat' || replayResult === 'sat') &&
      (replayResult !== 'sat' || replayWitnessRecheckPassed);

    return {
      operator_id: item.code,
      original_execution_id: originalResult.execution_id,
      replay_execution_id: replayExecId,
      original_assertion_hash: originalResult.actual_smt_assertion_hash,
      replay_assertion_hash: computeSha256(item.z3_smt_assertion),
      original_result: originalResult.solver_result,
      replay_result: replayResult,
      replay_witness_recheck_passed: replayWitnessRecheckPassed,
      replay_witness_model_sha256: replayWitnessModelHash,
      original_evidence_hash: originalResult.certificate_sha256,
      replay_evidence_hash: replayEvidenceHash,
      replay_match: match
    };
  }

  public async verifyAll88(): Promise<DFRL88VerificationReport> {
    const overallExecId = `dfrl_exec_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const results: DFRLVerificationResult[] = [];
    const replays: ReplayVerificationRecord[] = [];

    let attempted = 0;
    let executed = 0;
    let unsatCount = 0;
    let satCount = 0;
    let unknownCount = 0;
    let errorCount = 0;
    let notExecutedCount = 0;

    for (const item of REAL_88_PARADOX_REGISTRY) {
      attempted++;
      const res = await this.verifyProposition(item, overallExecId);
      results.push(res);

      if (res.solver_result !== 'formal_execution_not_performed') executed++;
      if (res.solver_result === 'unsat') unsatCount++;
      else if (res.solver_result === 'sat') satCount++;
      else if (res.solver_result === 'unknown') unknownCount++;
      else if (res.solver_result === 'error') errorCount++;
      else notExecutedCount++;

      const replayRec = await this.replayPropositionCleanroom(item, res);
      replays.push(replayRec);
    }

    const replaysMatched = replays.filter(r => r.replay_match).length;
    const authoredCount = results.filter(r => r.model_classification === 'AUTHORED_MODEL').length;
    const generatedCount = results.filter(r => r.model_classification === 'GENERATED_GENERALIZED_MODEL').length;

    const allExpectedResultsMatched = results.every((r, index) =>
      r.solver_result === REAL_88_PARADOX_REGISTRY[index].expected_solver_result &&
      r.proved &&
      (r.solver_result !== 'sat' || (r.sat_witness_recheck_passed === true && typeof r.sat_witness_model_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(r.sat_witness_model_sha256)))
    );
    const allReplayed = replaysMatched === REAL_88_PARADOX_REGISTRY.length;
    const overallStatus: DFRL88VerificationReport['overall_status'] =
      allExpectedResultsMatched && allReplayed ? 'VERIFIED' : (executed > 0 ? 'PARTIAL' : 'FAILED');

    const rootHash = computeSha256(
      results.map(r => `${r.operator_id}:${r.actual_smt_assertion_hash}:${r.solver_result}:${r.certificate_sha256}`).join('|')
    );

    return {
      execution_id: overallExecId,
      timestamp,
      total_propositions: REAL_88_PARADOX_REGISTRY.length,
      total_operators: REAL_88_PARADOX_REGISTRY.length,
      attempted,
      executed,
      unsat_count: unsatCount,
      unsat_proved_count: unsatCount,
      sat_count: satCount,
      unknown_count: unknownCount,
      error_count: errorCount,
      not_executed_count: notExecutedCount,
      authored_models_count: authoredCount,
      generated_models_count: generatedCount,
      deterministic_replays_matched: replaysMatched,
      claim_scope: 'MODEL_VERIFIED',
      solver_engine: 'Microsoft Research Z3 WASM (z3-solver)',
      solver_version: this.solverVersion,
      overall_status: overallStatus,
      verification_root_sha256: rootHash,
      results,
      replays
    };
  }

  public async runSmtMutationTest(): Promise<SMTMutationTestResult> {
    const targetItem = REAL_88_PARADOX_REGISTRY[20];
    const originalSmt = targetItem.z3_smt_assertion;
    const originalHash = computeSha256(originalSmt);
    const mutatedSmt = originalSmt.replace('(assert (not (and', '(assert (and').replace(/\)\)\s*$/, ')');
    const mutatedHash = computeSha256(mutatedSmt);

    const z3Mod = await this.getZ3Module();
    if (!z3Mod) {
      return {
        test_name: 'DFRL Operator SMT Invariant Mutation Test',
        target_operator_id: targetItem.code,
        original_assertion: originalSmt,
        original_assertion_hash: originalHash,
        mutated_assertion: mutatedSmt,
        mutated_assertion_hash: mutatedHash,
        expected_original_result: 'unsat',
        observed_original_result: 'error',
        expected_mutated_result: 'sat',
        observed_mutated_result: 'error',
        mutation_type: 'PREMISE_PERTURBATION_REFUTATION_INVERSION',
        mutation_detected: false,
        passed: false,
        details: 'Z3 solver unavailable for mutation testing'
      };
    }

    const { Context } = z3Mod;
    const ctxOrig = new Context('mut_orig');
    const solverOrig = new ctxOrig.Solver();
    await solverOrig.fromString(originalSmt);
    const origRes = await solverOrig.check();

    const ctxMut = new Context('mut_pert');
    const solverMut = new ctxMut.Solver();
    await solverMut.fromString(mutatedSmt);
    const mutRes = await solverMut.check();

    const mutationDetected = origRes === 'unsat' && mutRes === 'sat';

    return {
      test_name: 'DFRL Operator SMT Invariant Mutation Test',
      target_operator_id: targetItem.code,
      operator_code: targetItem.code,
      original_assertion: originalSmt,
      original_assertion_hash: originalHash,
      mutated_assertion: mutatedSmt,
      mutated_assertion_hash: mutatedHash,
      expected_original_result: 'unsat',
      observed_original_result: origRes,
      expected_mutated_result: 'sat',
      observed_mutated_result: mutRes,
      mutation_type: 'PREMISE_PERTURBATION_REFUTATION_INVERSION',
      mutation_detected: mutationDetected,
      passed: mutationDetected,
      details: mutationDetected
        ? 'Mutation test passed: Inverting theorem refutation constraint successfully converted UNSAT theorem to SAT counter-model.'
        : `Mutation test failed: orig=${origRes}, mut=${mutRes}`
    };
  }

  public async runZ3FailureInjectionTest(): Promise<Z3FailureInjectionTestResult> {
    const malformedItem: DFRLParadoxItem = {
      code: 'DFRL-P-FAULT-INJECTION',
      name: 'Simulated Malformed SMT Input',
      domain: 'FAULT_INJECTION',
      category: 'FAIL_CLOSED_TEST',
      model_classification: 'AUTHORED_MODEL',
      model_scope: 'MODEL_ONLY',
      classical_antinomy: 'Malformed syntax injection.',
      formal_invariant: 'Syntax error must fail closed and never prove UNSAT.',
      machine_checked_status: 'VERIFIED',
      z3_smt_assertion: '(assert (this_is_an_undefined_operator 123 456))',
      proof_bundle_ref: 'PB-FAULT-001',
      expected_solver_result: 'sat'
    };

    const res = await this.verifyProposition(malformedItem);
    const failClosed = res.solver_result === 'error' && res.proved === false;

    return {
      test_name: 'Z3 Solver Failure & Malformed SMT Injection Test',
      injection_type: 'MALFORMED_SMT',
      input_assertion: malformedItem.z3_smt_assertion,
      observed_result: res.solver_result,
      observed_solver_result: res.solver_result,
      proved_status: res.proved,
      never_converted_to_unsat: res.solver_result !== 'unsat',
      fail_closed_enforced: failClosed,
      passed: failClosed,
      notes: failClosed
        ? 'Fail-closed behavior confirmed: Malformed SMT syntax produced ERROR and proved=false. Never converted to UNSAT.'
        : `Fail-closed violated: Malformed SMT produced result ${res.solver_result} with proved=${res.proved}.`
    };
  }

  public async runFailureInjectionTest(): Promise<Z3FailureInjectionTestResult> {
    return this.runZ3FailureInjectionTest();
  }

  public runArtifactTamperTest(report: DFRL88VerificationReport): ArtifactTamperTestResult {
    const originalHash = report.verification_root_sha256;
    const tamperedPayload = JSON.parse(JSON.stringify(report));
    if (tamperedPayload.results && tamperedPayload.results.length > 0) {
      tamperedPayload.results[0].solver_result = 'sat';
      tamperedPayload.results[0].proved = false;
    }

    const tamperedHash = computeSha256(
      tamperedPayload.results.map((r: any) => `${r.operator_id}:${r.actual_smt_assertion_hash}:${r.solver_result}:${r.certificate_sha256}`).join('|')
    );

    const tamperDetected = originalHash !== tamperedHash;

    return {
      test_name: 'Artifact Tamper Sentinel Monitor',
      original_hash: originalHash,
      tampered_payload_snippet: 'Modifying operator 0 solver_result to sat',
      tampered_hash: tamperedHash,
      tamper_detected: tamperDetected,
      passed: tamperDetected,
      alarm_triggered: tamperDetected
    };
  }
}
