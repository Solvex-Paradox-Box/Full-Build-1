import { ProofBundleEntity } from '../database/DatabaseSchema';
import { DurableStore } from '../database/DurableStore';

export class ProofEngine {
  private static instance: ProofEngine | null = null;
  private bundles: Map<string, ProofBundleEntity> = new Map();

  private constructor() {
    const store = DurableStore.getInstance();
    const persisted = store.getState().proof_bundles;
    let changed = false;
    for (const [id, bundle] of Object.entries(persisted)) {
      const assessment = this.verifyBundleIntegrity(bundle);
      if (bundle.verification_status === 'VERIFIED' && !assessment.verified) {
        const safeBundle = {
          ...bundle,
          verification_status: 'PARTIAL' as const,
          limitations: [...new Set([...(bundle.limitations || []), ...assessment.reasons])]
        };
        store.getState().proof_bundles[id] = safeBundle;
        this.bundles.set(id, safeBundle);
        changed = true;
      } else {
        this.bundles.set(id, bundle);
      }
    }
    if (changed) store.persist();
  }

  public static getInstance(): ProofEngine {
    if (!ProofEngine.instance) {
      ProofEngine.instance = new ProofEngine();
    }
    return ProofEngine.instance;
  }

  public getBundle(proofId: string): ProofBundleEntity | undefined {
    return this.bundles.get(proofId);
  }

  public getAllBundles(): ProofBundleEntity[] {
    return Array.from(this.bundles.values());
  }

  public registerBundle(bundle: ProofBundleEntity): void {
    const assessment = this.verifyBundleIntegrity(bundle);
    const storedBundle: ProofBundleEntity = {
      ...bundle,
      verification_status: bundle.verification_status === 'FAIL' || bundle.verification_status === 'REJECTED'
        ? bundle.verification_status
        : assessment.verified ? 'VERIFIED' : 'PARTIAL',
      limitations: [...new Set([...(bundle.limitations || []), ...assessment.reasons])]
    };
    this.bundles.set(storedBundle.proof_id, storedBundle);
    const store = DurableStore.getInstance();
    store.getState().proof_bundles[storedBundle.proof_id] = storedBundle;
    store.persist();
  }

  public verifyBundleIntegrity(bundle: ProofBundleEntity): { verified: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!Array.isArray(bundle.tests) || bundle.tests.length === 0) {
      reasons.push('Zero empirical tests provided');
    } else if (bundle.tests.some(test => !test.passed)) {
      reasons.push('One or more empirical tests failed');
    }
    if (!Array.isArray(bundle.formal_proofs) || bundle.formal_proofs.length === 0) {
      reasons.push('Zero machine-checked formal proofs');
    } else if (bundle.formal_proofs.some(proof => !proof.checked)) {
      reasons.push('One or more formal proof terms failed verification');
    }
    if (!Array.isArray(bundle.independent_oracles) || bundle.independent_oracles.length === 0) {
      reasons.push('Missing independent oracle attestation');
    } else if (bundle.independent_oracles.some(oracle => !oracle.verified)) {
      reasons.push('One or more oracle attestations rejected');
    }
    if (!Array.isArray(bundle.replay_results) || bundle.replay_results.length === 0) {
      reasons.push('Missing deterministic replay runs');
    } else if (bundle.replay_results.some(replay => replay.status !== 'MATCH')) {
      reasons.push('Replay trace divergence observed');
    }
    reasons.push('Persisted checked flags are not revalidated against a serialized signed Z3 receipt; in-process receipt authenticity does not survive reload.');
    reasons.push('No independently verifiable oracle signature, key identity, or trust chain is represented by the current proof-bundle schema.');

    return {
      verified: reasons.length === 0,
      reasons
    };
  }
}
