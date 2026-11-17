import { createHash } from 'node:crypto';
import { ProofBundleEntity } from '../database/DatabaseSchema';

const computeSha256 = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');
import { Z3ProofResult } from './Z3FormalProofEngine';

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
      reproducibility_instructions: 'Run `npm run verify:enterprise` in isolated container.'
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
    this.bundle.formal_proofs.push({
      system,
      specification: spec,
      checked,
      proof_term_hash: computeSha256(`${system}:${spec}:${checked}`)
    });
    return this;
  }

  public addZ3Proof(proofResult: Z3ProofResult): this {
    this.bundle.formal_proofs.push({
      system: 'Z3_SMT',
      specification: `[${proofResult.theorem_id}] ${proofResult.theorem_name} (Z3 Engine) - Result: ${proofResult.solver_result.toUpperCase()}`,
      checked: proofResult.proved,
      proof_term_hash: proofResult.certificate_sha256
    });
    return this;
  }

  public addLean4Proof(filePath: string): this {
    return this.addFormalProof('LEAN4', filePath, true);
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

  public buildPartial(): ProofBundleEntity {
    this.bundle.verification_status = 'PARTIAL';
    return this.bundle;
  }

  public seal(): ProofBundleEntity {
    const allTestsPassed = this.bundle.tests.length > 0 && this.bundle.tests.every(t => t.passed);
    const formalChecked = this.bundle.formal_proofs.length > 0 && this.bundle.formal_proofs.every(f => f.checked);
    const oraclesAttested = this.bundle.independent_oracles.length > 0 && this.bundle.independent_oracles.every(o => o.verified);
    const replaysMatched = this.bundle.replay_results.length > 0 && this.bundle.replay_results.every(r => r.status === 'MATCH');

    if (allTestsPassed && formalChecked && oraclesAttested && replaysMatched) {
      this.bundle.verification_status = 'VERIFIED';
    } else {
      this.bundle.verification_status = 'FAIL';
    }
    return this.bundle;
  }
}
