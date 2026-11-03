import { ProofBundleEntity, computeSha256 } from '../database/DatabaseSchema';
import { Z3FormalProofEngine, Z3ProofResult } from './Z3FormalProofEngine';

export class ProofBundleBuilder {
  private bundle: ProofBundleEntity;

  constructor(proofId: string, subjectId: string, claim: string) {
    this.bundle = {
      proof_id: proofId,
      subject_id: subjectId,
      claim,
      claim_hash: computeSha256(claim),
      evidence: [],
      tests: [],
      formal_proofs: [],
      independent_oracles: [],
      replay_results: [],
      implementation_hash: computeSha256('EMPTY_IMPL'),
      environment_hash: computeSha256('SOVEREIGN_NODE_SANDBOX'),
      dependency_hash: computeSha256('ZERO_SPECULATIVE_DEPS'),
      source_references: [],
      timestamp: Date.now(),
      verifier_identity: 'DAISY_HAMINJA_PROOF_ENGINE_V1',
      verification_status: 'PARTIAL',
      limitations: [],
      reproducibility_instructions: 'No isolated cleanroom is configured; do not treat this bundle as deployment or marketplace evidence.'
    };
  }

  public setImplementation(sourceCode: string): this {
    this.bundle.implementation_hash = computeSha256(sourceCode);
    return this;
  }

  public addTest(testId: string, description: string, passed: boolean, durationMs: number): this {
    this.bundle.tests.push({
      test_id: testId,
      description,
      passed,
      duration_ms: durationMs,
      receipt_hash: computeSha256(`${testId}:${passed}:${durationMs}`)
    });
    return this;
  }

  public addFormalProof(system: 'Z3_SMT' | 'LEAN4' | 'ISABELLE' | 'NOPOT' | 'TYPE_THEORY', spec: string, checked: boolean): this {
    // A caller-supplied boolean is a claim, not a machine-checkable proof
    // receipt. Only addZ3Proof accepts a result produced by the Z3 engine.
    this.bundle.formal_proofs.push({
      system,
      specification: spec,
      checked: false,
      proof_term_hash: computeSha256(`UNVERIFIED_CALLER_CLAIM:${system}:${spec}:${checked}`)
    });
    this.bundle.limitations.push(`Formal proof ${system} was declared by caller metadata; no independently verifiable proof receipt was supplied.`);
    return this;
  }

  public addZ3Proof(proofResult: Z3ProofResult): this {
    const authentic = Z3FormalProofEngine.getInstance().isAuthenticResult(proofResult);
    this.bundle.formal_proofs.push({
      system: 'Z3_SMT',
      specification: `[${proofResult.theorem_id}] ${proofResult.theorem_name} (Z3 Engine) - Result: ${proofResult.solver_result.toUpperCase()}`,
      checked: authentic,
      proof_term_hash: authentic
        ? proofResult.certificate_sha256
        : computeSha256(`UNAUTHENTICATED_Z3_RECEIPT:${proofResult.theorem_id}:${proofResult.certificate_sha256}`)
    });
    if (!authentic) {
      this.bundle.limitations.push('Z3 result object was not issued by the active Z3FormalProofEngine instance or did not match its expected solver result.');
    }
    return this;
  }

  public addLean4Proof(filePath: string): this {
    this.bundle.limitations.push(`Lean4 proof at [${filePath}] was referenced but not executed or independently verified by this builder.`);
    return this;
  }

  public addOracle(oracleId: string, name: string, method: string, verified: boolean): this {
    this.bundle.independent_oracles.push({
      oracle_id: oracleId,
      name,
      method,
      attestation_hash: computeSha256(`${oracleId}:${name}:${verified}`),
      verified
    });
    return this;
  }

  public addReplay(replayId: string, expectedHash: string, observedHash: string): this {
    const match = expectedHash === observedHash;
    this.bundle.replay_results.push({
      replay_id: replayId,
      status: match ? 'MATCH' : 'MISMATCH',
      expected_hash: expectedHash,
      observed_hash: observedHash
    });
    return this;
  }

  public addEvidence(item: string): this {
    this.bundle.evidence.push(item);
    return this;
  }

  public addSourceReference(ref: string): this {
    this.bundle.source_references.push(ref);
    return this;
  }

  public addLimitation(limitation: string): this {
    this.bundle.limitations.push(limitation);
    return this;
  }

  public seal(): ProofBundleEntity {
    const hasFailingTest = this.bundle.tests.some(test => !test.passed);
    const hasFailedZ3Proof = this.bundle.formal_proofs.some(proof => proof.system === 'Z3_SMT' && !proof.checked);
    const hasReplayMismatch = this.bundle.replay_results.some(replay => replay.status !== 'MATCH');
    if (hasFailingTest || hasFailedZ3Proof || hasReplayMismatch) {
      this.bundle.verification_status = 'FAIL';
      return this.bundle;
    }

    const completeLocalEvidence =
      this.bundle.tests.length > 0 &&
      this.bundle.formal_proofs.some(proof => proof.system === 'Z3_SMT' && proof.checked) &&
      !this.bundle.formal_proofs.some(proof => proof.system !== 'Z3_SMT' && !proof.checked) &&
      this.bundle.replay_results.length > 0 &&
      this.bundle.replay_results.every(replay => replay.status === 'MATCH');
    const hasOracleMetadata = this.bundle.independent_oracles.length > 0 &&
      this.bundle.independent_oracles.every(oracle => oracle.verified);

    // Oracle records currently contain only caller-controlled booleans and
    // hashes of public metadata. They have no signature, key identity, or
    // trust-chain verification. Therefore this schema cannot seal VERIFIED.
    this.bundle.verification_status = 'PARTIAL';
    if (!completeLocalEvidence) {
      this.bundle.limitations.push('Required local evidence is incomplete: tests, an executed Z3 receipt, and deterministic replay are all required.');
    }
    this.bundle.limitations.push(
      hasOracleMetadata
        ? 'Oracle records are self-asserted metadata; no independently verifiable signature or trust chain is represented.'
        : 'Independent oracle attestation is absent or not verified.'
    );
    this.bundle.limitations.push('VERIFIED sealing is disabled until the proof schema supports cryptographically verifiable independent attestations.');
    this.bundle.limitations.push('Environment and dependency hash fields are static markers; no measured runtime or dependency-manifest fingerprint is captured.');
    return this.bundle;
  }
}
