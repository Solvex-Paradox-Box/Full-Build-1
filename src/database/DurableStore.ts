import {
  computeSha256,
  TenantEntity,
  ProblemEntity,
  SolutionEntity,
  OfferEntity,
  ProofBundleEntity,
  AuditRecordEntity,
  CheckpointEntity
} from './DatabaseSchema';
import { SqliteStore } from './SqliteStore';

export interface DurableState {
  tenants: Record<string, TenantEntity>;
  problems: Record<string, ProblemEntity>;
  solutions: Record<string, SolutionEntity>;
  offers: Record<string, OfferEntity>;
  proof_bundles: Record<string, ProofBundleEntity>;
  audit_chain: AuditRecordEntity[];
  checkpoints: Record<string, CheckpointEntity>;
}

export class DurableStore {
  private static instance: DurableStore | null = null;
  private state: DurableState;
  private readonly STORAGE_KEY = 'SOLVEX_SOVEREIGN_DURABLE_STATE';

  private constructor() {
    this.state = {
      tenants: {},
      problems: {},
      solutions: {},
      offers: {},
      proof_bundles: {},
      audit_chain: [],
      checkpoints: {}
    };
    this.load();
  }

  public static getInstance(): DurableStore {
    if (!DurableStore.instance) {
      DurableStore.instance = new DurableStore();
    }
    return DurableStore.instance;
  }

  public getState(): DurableState {
    return this.state;
  }

  public appendAudit(
    tenantId: string,
    actor: string,
    action: string,
    targetEntity: string,
    targetId: string,
    payload: any
  ): AuditRecordEntity {
    const timestamp = Date.now();
    const indexNum = this.state.audit_chain.length;
    const previousHash = indexNum > 0 ? this.state.audit_chain[indexNum - 1].record_hash : '0'.repeat(64);
    const payloadHash = computeSha256(JSON.stringify(payload));
    const recordHash = computeSha256(
      `${indexNum}:${timestamp}:${tenantId}:${actor}:${action}:${targetEntity}:${targetId}:${previousHash}:${payloadHash}`
    );

    const record: AuditRecordEntity = {
      id: `audit_${timestamp}_${indexNum}`,
      tenant_id: tenantId,
      index_num: indexNum,
      timestamp,
      actor,
      action,
      target_entity: targetEntity,
      target_id: targetId,
      payload,
      payload_hash: payloadHash,
      previous_hash: previousHash,
      record_hash: recordHash
    };

    // Persist the audit event in SQLite before acknowledging the append.
    // The hash chain is not digitally signed; do not mark it sealed.
    SqliteStore.getInstance().insertTenantRecord('audit_records', tenantId, {
      id: record.id,
      index_num: record.index_num,
      timestamp: record.timestamp,
      actor: record.actor,
      action: record.action,
      target_entity: record.target_entity,
      target_id: record.target_id,
      payload: record.payload,
      payload_hash: record.payload_hash,
      previous_hash: record.previous_hash,
      record_hash: record.record_hash
    });
    this.state.audit_chain.push(record);

    // This chain is hash-linked but not digitally signed. Do not mark it sealed
    // or write a fabricated signature into the SQLite audit table.
    this.persist();
    return record;
  }

  public verifyChain(): { valid: boolean; total_records: number; reason?: string } {
    const chain = this.state.audit_chain;
    if (chain.length === 0) return { valid: true, total_records: 0 };

    for (let i = 0; i < chain.length; i++) {
      const rec = chain[i];
      if (i > 0) {
        if (rec.previous_hash !== chain[i - 1].record_hash) {
          return {
            valid: false,
            total_records: chain.length,
            reason: `Broken link at index ${i}: previous_hash does not match prior record_hash`
          };
        }
      } else {
        if (rec.previous_hash !== '0'.repeat(64)) {
          return {
            valid: false,
            total_records: chain.length,
            reason: `Genesis block at index 0 invalid previous_hash: ${rec.previous_hash}`
          };
        }
      }

      const expectedPayloadHash = computeSha256(JSON.stringify(rec.payload));
      if (rec.payload_hash !== expectedPayloadHash) {
        return {
          valid: false,
          total_records: chain.length,
          reason: `Payload tamper detected at index ${i}: payload_hash mismatch`
        };
      }

      const expectedRecordHash = computeSha256(
        `${rec.index_num}:${rec.timestamp}:${rec.tenant_id}:${rec.actor}:${rec.action}:${rec.target_entity}:${rec.target_id}:${rec.previous_hash}:${rec.payload_hash}`
      );
      if (rec.record_hash !== expectedRecordHash) {
        return {
          valid: false,
          total_records: chain.length,
          reason: `Block hash mismatch at index ${i}: calculated does not match stored record_hash`
        };
      }
    }
    return { valid: true, total_records: chain.length };
  }

  public createCheckpoint(
    tenantId: string,
    targetMutation: string,
    classification: 'ATOMIC_DATABASE_RESTORE' | 'IRREVERSIBLE_EXTERNAL_ACTION' = 'ATOMIC_DATABASE_RESTORE'
  ): CheckpointEntity {
    const id = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const checkpoint: CheckpointEntity = {
      id,
      checkpoint_id: id,
      tenant_id: tenantId,
      target_mutation: targetMutation,
      classification,
      snapshot_state: JSON.parse(JSON.stringify({
        problems: this.state.problems,
        solutions: this.state.solutions,
        offers: this.state.offers,
        tenants: this.state.tenants
      })),
      timestamp: Date.now()
    };
    this.state.checkpoints[id] = checkpoint;
    this.persist();
    return checkpoint;
  }

  public rollbackToCheckpoint(checkpointId: string, reason: string): { success: boolean; error?: string } {
    const chk = this.state.checkpoints[checkpointId];
    if (!chk) {
      return { success: false, error: `Checkpoint ${checkpointId} not found` };
    }
    if (chk.classification === 'IRREVERSIBLE_EXTERNAL_ACTION') {
      return {
        success: false,
        error: `Cannot rollback checkpoint marked IRREVERSIBLE_EXTERNAL_ACTION. Reversibility guarantee rejected: ${reason}`
      };
    }
    if (chk.snapshot_state) {
      this.state.problems = JSON.parse(JSON.stringify(chk.snapshot_state.problems || {}));
      this.state.solutions = JSON.parse(JSON.stringify(chk.snapshot_state.solutions || {}));
      this.state.offers = JSON.parse(JSON.stringify(chk.snapshot_state.offers || {}));
      this.state.tenants = JSON.parse(JSON.stringify(chk.snapshot_state.tenants || {}));
      this.persist();
      return { success: true };
    }
    return { success: false, error: 'Snapshot state missing from checkpoint' };
  }

  private load(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(this.STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed) {
            this.state = { ...this.state, ...parsed };
          }
        }
      } catch {}
    }
  }

  public persist(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
      } catch {}
    }
  }
}
