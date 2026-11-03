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
    const sqlite = SqliteStore.getInstance();
    sqlite.insertTenantRecord('audit_records', tenantId, record);
    this.state.audit_chain.push(record);

    // This chain is hash-linked but not digitally signed. Do not mark it sealed
    // or write a fabricated signature into the SQLite audit table.
    try {
      this.persist();
      return record;
    } catch (error) {
      this.state.audit_chain.pop();
      sqlite.deleteTenantRecord('audit_records', tenantId, record.id);
      throw error;
    }
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
    try {
      this.persist();
      return checkpoint;
    } catch (error) {
      delete this.state.checkpoints[id];
      SqliteStore.getInstance().deleteRecordById('checkpoints', id);
      throw error;
    }
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
      const previous = {
        problems: this.state.problems,
        solutions: this.state.solutions,
        offers: this.state.offers,
        tenants: this.state.tenants
      };
      this.state.problems = JSON.parse(JSON.stringify(chk.snapshot_state.problems || {}));
      this.state.solutions = JSON.parse(JSON.stringify(chk.snapshot_state.solutions || {}));
      this.state.offers = JSON.parse(JSON.stringify(chk.snapshot_state.offers || {}));
      this.state.tenants = JSON.parse(JSON.stringify(chk.snapshot_state.tenants || {}));
      const sqlite = SqliteStore.getInstance();
      const rawDb = sqlite.getRawDb();
      const transactional = sqlite.isDiskBacked();
      try {
        if (transactional) rawDb.exec('BEGIN IMMEDIATE;');
        this.deleteRemovedRows('problems', previous.problems, this.state.problems);
        this.deleteRemovedRows('solutions', previous.solutions, this.state.solutions);
        this.deleteRemovedRows('offers', previous.offers, this.state.offers);
        this.deleteRemovedRows('tenants', previous.tenants, this.state.tenants);
        this.persist();
        if (transactional) rawDb.exec('COMMIT;');
        return { success: true };
      } catch (error) {
        if (transactional) {
          try { rawDb.exec('ROLLBACK;'); } catch {}
        }
        this.state.problems = previous.problems;
        this.state.solutions = previous.solutions;
        this.state.offers = previous.offers;
        this.state.tenants = previous.tenants;
        if (!transactional) {
          try { this.persist(); } catch {}
        }
        return {
          success: false,
          error: `Checkpoint restore failed closed: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
    return { success: false, error: 'Snapshot state missing from checkpoint' };
  }

  private load(): void {
    // Browser storage remains a fallback. In Node, SQLite is the authoritative
    // persistence source whenever the native disk-backed adapter is available.
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.state = { ...this.state, ...parsed };
      }
    }

    const sqlite = SqliteStore.getInstance();
    const hydrateMap = <T>(table: string): Record<string, T> => {
      const rows = sqlite.findAllRecords<Record<string, any>>(table);
      return Object.fromEntries(rows.map(row => [String(row.id), row as T]));
    };
    const tenants = hydrateMap<TenantEntity>('tenants');
    const problems = hydrateMap<ProblemEntity>('problems');
    const solutions = hydrateMap<SolutionEntity>('solutions');
    const offers = hydrateMap<OfferEntity>('offers');
    const proofBundles = hydrateMap<ProofBundleEntity>('proof_bundles');
    const checkpoints = hydrateMap<CheckpointEntity>('checkpoints');
    const auditRows = sqlite.findAllRecords<AuditRecordEntity>('audit_records')
      .sort((a, b) => a.index_num - b.index_num);

    if (Object.keys(tenants).length) this.state.tenants = tenants;
    if (Object.keys(problems).length) this.state.problems = problems;
    if (Object.keys(solutions).length) this.state.solutions = solutions;
    if (Object.keys(offers).length) this.state.offers = offers;
    if (Object.keys(proofBundles).length) this.state.proof_bundles = proofBundles;
    if (Object.keys(checkpoints).length) this.state.checkpoints = checkpoints;
    if (auditRows.length) this.state.audit_chain = auditRows;
  }

  private persistMap<T>(table: string, records: Record<string, T>): void {
    const sqlite = SqliteStore.getInstance();
    for (const [key, value] of Object.entries(records)) {
      const row = value as any;
      const id = String(row.id || row.offer_id || key);
      sqlite.insertRecord(table, { ...row, id });
    }
  }

  private deleteRemovedRows<T>(
    table: string,
    previous: Record<string, T>,
    restored: Record<string, T>
  ): void {
    const sqlite = SqliteStore.getInstance();
    for (const [key, value] of Object.entries(previous)) {
      if (!Object.prototype.hasOwnProperty.call(restored, key)) {
        const row = value as any;
        sqlite.deleteRecordById(table, String(row.id || row.offer_id || key));
      }
    }
  }

  public getPersistenceMode(): 'SQLITE_DISK' | 'BROWSER_LOCAL_STORAGE' | 'PROCESS_MEMORY_ONLY' {
    const sqlite = SqliteStore.getInstance();
    if (sqlite.isDiskBacked()) return 'SQLITE_DISK';
    if (typeof window !== 'undefined' && Boolean(window.localStorage)) return 'BROWSER_LOCAL_STORAGE';
    return 'PROCESS_MEMORY_ONLY';
  }

  public persist(): void {
    // Persist canonical entities and the hash-linked audit records to SQLite.
    // isDiskBacked() must be checked by callers before making a disk-durability
    // claim; the fallback adapter is intentionally only process-local memory.
    this.persistMap('tenants', this.state.tenants);
    this.persistMap('problems', this.state.problems);
    this.persistMap('solutions', this.state.solutions);
    this.persistMap('offers', this.state.offers);
    this.persistMap('proof_bundles', this.state.proof_bundles);
    this.persistMap('checkpoints', this.state.checkpoints);
    for (const record of this.state.audit_chain) {
      SqliteStore.getInstance().insertTenantRecord('audit_records', record.tenant_id, record);
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
    }
  }
}
