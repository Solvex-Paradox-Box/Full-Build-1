import { DurableStore } from './DurableStore';
import { SqliteStore } from './SqliteStore';
import { computeSha256 } from './DatabaseSchema';

export interface DiversionResult {
  fail_closed_enforced: boolean;
  rollback_status: 'ROLLED_BACK' | 'FAILED' | 'REJECTED';
  failure_id: string;
  evidence_hash: string;
}

export class ReversibilityEngine {
  private static instance: ReversibilityEngine | null = null;
  private durableStore: DurableStore;
  private sqlite: SqliteStore;

  private constructor() {
    this.durableStore = DurableStore.getInstance();
    this.sqlite = SqliteStore.getInstance();
  }

  public static getInstance(): ReversibilityEngine {
    if (!ReversibilityEngine.instance) {
      ReversibilityEngine.instance = new ReversibilityEngine();
    }
    return ReversibilityEngine.instance;
  }

  public createCheckpoint(
    tenantId: string,
    targetMutation: string,
    classification: 'ATOMIC_DATABASE_RESTORE' | 'IRREVERSIBLE_EXTERNAL_ACTION' = 'ATOMIC_DATABASE_RESTORE'
  ) {
    // DurableStore persists the full snapshot under this checkpoint ID.
    // Do not overwrite that row with a metadata-only record.
    return this.durableStore.createCheckpoint(tenantId, targetMutation, classification);
  }

  public executeRollback(checkpointId: string, reason: string, tenantId: string): { success: boolean; error?: string } {
    const checkpoint = this.durableStore.getState().checkpoints[checkpointId];
    if (!checkpoint || checkpoint.tenant_id !== tenantId) {
      return { success: false, error: 'Checkpoint tenant does not match rollback tenant.' };
    }
    return this.durableStore.rollbackToCheckpoint(checkpointId, reason);
  }

  public divertFailure(
    failedGate: string,
    triggerReason: string,
    tenantId: string,
    executionId: string,
    checkpointId?: string,
    evidencePayload?: any
  ): DiversionResult {
    const failureId = `fail_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const evidenceHash = computeSha256(JSON.stringify(evidencePayload || { failedGate, triggerReason, executionId }));
    let rollbackStatus: 'ROLLED_BACK' | 'FAILED' | 'REJECTED' = 'REJECTED';

    if (checkpointId) {
      const rollback = this.executeRollback(checkpointId, `Automatic fail-closed diversion: ${triggerReason}`, tenantId);
      rollbackStatus = rollback.success ? 'ROLLED_BACK' : 'FAILED';
    }

    let evidencePersisted = false;
    let auditPersisted = false;
    try {
      this.sqlite.insertRecord('failures', {
        id: failureId,
        tenant_id: tenantId,
        failed_gate: failedGate,
        trigger_reason: triggerReason,
        evidence_hash: evidenceHash,
        reverted_to_checkpoint: checkpointId || null,
        fail_closed_enforced: rollbackStatus === 'ROLLED_BACK',
        status: rollbackStatus === 'ROLLED_BACK' ? 'QUARANTINED' : 'BLOCKED'
      });
      evidencePersisted = Boolean(this.sqlite.findTenantRecordById('failures', tenantId, failureId));
      if (!evidencePersisted) throw new Error('Failure evidence read-back failed.');

      this.durableStore.appendAudit(
        tenantId,
        'FAIL_CLOSED_SENTINEL',
        'FAILURE_DIVERSION',
        'FAILURE',
        failureId,
        { failedGate, triggerReason, rollbackStatus, evidenceHash }
      );
      auditPersisted = true;
    } catch {
      evidencePersisted = false;
    }

    return {
      fail_closed_enforced: rollbackStatus === 'ROLLED_BACK' && evidencePersisted && auditPersisted,
      rollback_status: rollbackStatus,
      failure_id: failureId,
      evidence_hash: evidenceHash
    };
  }
}
