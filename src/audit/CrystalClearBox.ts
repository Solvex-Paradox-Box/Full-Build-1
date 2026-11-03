import { ProofBundleEntity, computeSha256 } from '../database/DatabaseSchema';

export interface CustomerEvidenceView {
  proof_id: string;
  claim: string;
  claim_hash: string;
  verification_verdict: string;
  proprietary_weights_redacted: boolean;
  internal_reasoning_redacted: boolean;
  public_audit_token: string;
  public_audit_token_kind: 'UNSIGNED_SHA256_COMMITMENT';
  public_audit_token_signed: false;
  verified_tests_count: number;
  formal_proofs_count: number;
  oracle_attestations_count: number;
  replay_verification_status: string;
  evidence_statements: string[];
  reproducibility_instructions: string;
  timestamp: number;
}

export class CrystalClearBox {
  public static projectCustomerEvidence(bundle: ProofBundleEntity): CustomerEvidenceView {
    const publicToken = computeSha256(
      `CCB_TOKEN:${bundle.proof_id}:${bundle.claim_hash}:${bundle.verification_status}:${bundle.timestamp}`
    );
    const replayStatus = bundle.replay_results && bundle.replay_results.length > 0 && bundle.replay_results.every(r => r.status === 'MATCH')
      ? 'DETERMINISTIC_MATCH_CONFIRMED'
      : 'PENDING_OR_UNAVAILABLE';

    return {
      proof_id: bundle.proof_id,
      claim: bundle.claim,
      claim_hash: bundle.claim_hash,
      verification_verdict: bundle.verification_status,
      proprietary_weights_redacted: true,
      internal_reasoning_redacted: true,
      public_audit_token: publicToken,
      public_audit_token_kind: 'UNSIGNED_SHA256_COMMITMENT',
      public_audit_token_signed: false,
      verified_tests_count: bundle.tests ? bundle.tests.filter(t => t.passed).length : 0,
      formal_proofs_count: bundle.formal_proofs ? bundle.formal_proofs.filter(f => f.checked).length : 0,
      oracle_attestations_count: bundle.independent_oracles ? bundle.independent_oracles.filter(o => o.verified).length : 0,
      replay_verification_status: replayStatus,
      evidence_statements: bundle.evidence || [],
      reproducibility_instructions: bundle.reproducibility_instructions || 'Cleanroom verification via proof bundle manifest.',
      timestamp: bundle.timestamp
    };
  }
}
