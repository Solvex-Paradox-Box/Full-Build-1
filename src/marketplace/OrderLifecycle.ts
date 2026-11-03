import { SqliteStore } from '../database/SqliteStore';
import { DurableStore } from '../database/DurableStore';
import { AuthService, UserContext } from '../auth/AuthService';

export class OrderLifecycleManager {
  private static instance: OrderLifecycleManager | null = null;
  private sqlite: SqliteStore;
  private durableStore: DurableStore;

  private validTransitions: Record<string, string[]> = {
    OFFER: ['ORDER_CREATED', 'FAILED'],
    ORDER_CREATED: ['ESCROW_FUNDED', 'FAILED'],
    ESCROW_FUNDED: ['SANDBOX_PROVISIONED', 'FAILED'],
    SANDBOX_PROVISIONED: ['REPLAY_VERIFIED', 'FAILED'],
    REPLAY_VERIFIED: ['DEPLOYED', 'FAILED'],
    DEPLOYED: ['ROLLED_BACK'],
    FAILED: [],
    ROLLED_BACK: []
  };

  private constructor() {
    this.sqlite = SqliteStore.getInstance();
    this.durableStore = DurableStore.getInstance();
  }

  public static getInstance(): OrderLifecycleManager {
    if (!OrderLifecycleManager.instance) {
      OrderLifecycleManager.instance = new OrderLifecycleManager();
    }
    return OrderLifecycleManager.instance;
  }

  public transitionOrder(
    orderId: string,
    targetState: string,
    user?: UserContext,
    evidencePayload?: any
  ): { success: boolean; order?: any; error?: string } {
    const rawDb = this.sqlite.getRawDb();
    const order = rawDb.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) {
      return { success: false, error: `Order [${orderId}] not found in SQLite store` };
    }

    const authorization = AuthService.getInstance().authorize(user, 'ORDER_TRANSITION', order.tenant_id);
    if (!authorization.authorized) {
      return { success: false, error: authorization.reason || 'BLOCKED: verified authorization required.' };
    }

    const currentStatus = order.status;
    const allowed = this.validTransitions[currentStatus] || [];
    if (!allowed.includes(targetState)) {
      return {
        success: false,
        error: `Illegal state transition: Cannot transition order from [${currentStatus}] directly to [${targetState}]. Allowed: [${allowed.join(', ')}]`
      };
    }

    if (!this.sqlite.isDiskBacked()) {
      return { success: false, error: 'BLOCKED: order transitions require disk-backed SQLite transactions.' };
    }

    const auditLengthBefore = this.durableStore.getState().audit_chain.length;
    try {
      rawDb.exec('BEGIN IMMEDIATE;');
      const changed = this.sqlite.updateTenantRecord('orders', order.tenant_id, orderId, {
        status: targetState,
        evidence_reference: evidencePayload ? JSON.stringify(evidencePayload) : null
      });
      if (changed !== 1) throw new Error('Order row update did not affect exactly one tenant-scoped record.');

      const persisted = this.sqlite.findTenantRecordById<any>('orders', order.tenant_id, orderId);
      if (!persisted || persisted.status !== targetState) {
        throw new Error('Order transition read-back did not match the requested target state.');
      }

      this.durableStore.appendAudit(
        order.tenant_id,
        user?.email || 'SYSTEM_LIFECYCLE',
        'ORDER_TRANSITION',
        'ORDER',
        orderId,
        { from: currentStatus, to: targetState, evidence: evidencePayload }
      );
      rawDb.exec('COMMIT;');
      return { success: true, order: { ...order, status: targetState } };
    } catch (error) {
      try { rawDb.exec('ROLLBACK;'); } catch {}
      const chain = this.durableStore.getState().audit_chain;
      if (chain.length > auditLengthBefore) chain.splice(auditLengthBefore);
      return {
        success: false,
        error: `Order transition failed closed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
