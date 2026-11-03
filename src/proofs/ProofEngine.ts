import { ProofBundleEntity } from '../database/DatabaseSchema';
import { DurableStore } from '../database/DurableStore';

export class ProofEngine {
  private static instance: ProofEngine | null = null;
  private bundles: Map<string, ProofBundleEntity> = new Map();

  private constructor() {
    const persisted = DurableStore.getInstance().getState().proof_bundles;
    for (const [id, bundle] of Object.entries(persisted)) this.bundles.set(id, bundle);
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
    this.bundles.set(bundle.proof_id, bundle);
    const store = DurableStore.getInstance();
    store.getState().proof_bundles[bundle.proof_id] = bundle;
    store.persist();
  }

  public verifyBundleIntegrity(bundle: ProofBundleEntity): { verified: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!bundle.tests || bundle.tests.length === 0) reasons.push('Zero empirical tests provided');
    if (bundle.tests.some(t => !t.passed)) reasons.push('One or more empirical tests failed');
    if (!bundle.formal_proofs || bundle.formal_proofs.length === 0) reasons.push('Zero machine-checked formal proofs');
    if (bundle.formal_proofs.some(f => !f.checked)) reasons.push('One or more formal proof terms failed verification');
    if (!bundle.independent_oracles || bundle.independent_oracles.length === 0) reasons.push('Missing independent oracle attestation');
    if (bundle.independent_oracles.some(o => !o.verified)) reasons.push('One or more oracle attestations rejected');
    if (!bundle.replay_results || bundle.replay_results.length === 0) reasons.push('Missing deterministic replay runs');
    if (bundle.replay_results.some(r => r.status !== 'MATCH')) reasons.push('Replay trace divergence observed');
    reasons.push('No independently verifiable oracle signature, key identity, or trust chain is represented by the current proof-bundle schema.');

    return {
      verified: reasons.length === 0,
      reasons
    };
  }
}
