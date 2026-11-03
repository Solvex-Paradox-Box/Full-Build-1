import { SqliteStore } from '../database/SqliteStore';
import { NeonStore } from '../database/NeonPersistence';
import { DurableStore } from '../database/DurableStore';
import { computeSha256 } from '../database/DatabaseSchema';

let diskDbChecker: ((path: string) => boolean) | null = null;

export function setDiskDbChecker(fn: (path: string) => boolean) {
  diskDbChecker = fn;
}

async function checkDiskDbExists(dbPath: string): Promise<boolean> {
  if (diskDbChecker) {
    try {
      return diskDbChecker(dbPath);
    } catch {}
  }
  return false;
}

export interface SinglePersistenceTestResult {
  step: string;
  passed: boolean;
  duration_ms: number;
  details: Record<string, any>;
  error?: string;
}

export interface PersistenceVerificationReport {
  timestamp: string;
  claim_scope: 'LOCAL' | 'SANDBOX' | 'PRODUCTION';
  sqlite: {
    status: 'VERIFIED' | 'FAILED';
    tables_created: number;
    required_tables: number;
    migration_passed: boolean;
    schema_creation_passed: boolean;
    insert_passed: boolean;
    select_passed: boolean;
    update_passed: boolean;
    transaction_rollback_passed: boolean;
    restart_readback_passed: boolean;
    tenant_isolation_passed: boolean;
    audit_chain_passed: boolean;
    evidence_persistence_passed: boolean;
    steps: SinglePersistenceTestResult[];
  };
  neon: {
    configured: boolean;
    connected: boolean;
    status: 'VERIFIED' | 'PROVIDER_REQUIRED' | 'FAILED' | 'BLOCKED';
    claim_scope: 'LOCAL' | 'PRODUCTION';
    notes: string;
    steps: SinglePersistenceTestResult[];
  };
  all_local_passed: boolean;
  production_persistence_ready: boolean;
}

export async function runPersistenceVerification(): Promise<PersistenceVerificationReport> {
  const timestamp = new Date().toISOString();
  const sqliteSteps: SinglePersistenceTestResult[] = [];
  const neonSteps: SinglePersistenceTestResult[] = [];

  // ==========================================
  // 1. LOCAL SQLITE VERIFICATION
  // ==========================================
  const dbPath = './.sovereign_data/sovereign.sqlite';
  const sqlite = SqliteStore.getInstance();
  const db = sqlite.getRawDb();
  const diskDbExists = await checkDiskDbExists(dbPath);
  const diskBacked = sqlite.isDiskBacked() && diskDbExists;

  // Step 1: Migration & Schema Creation (27 tables)
  const t0 = performance.now();
  let schemaOk = false;
  let tableCount = 0;
  try {
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    tableCount = tables.length;
    schemaOk = diskBacked && tableCount === 27;
    sqliteSteps.push({
      step: 'MIGRATION_AND_SCHEMA_CREATION',
      passed: schemaOk,
      duration_ms: performance.now() - t0,
      details: { table_count: tableCount, required: 27, disk_file_exists: diskDbExists, disk_backed: sqlite.isDiskBacked() }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'MIGRATION_AND_SCHEMA_CREATION',
      passed: false,
      duration_ms: performance.now() - t0,
      details: { error: err.message }
    });
  }

  // Step 2: INSERT
  const t1 = performance.now();
  const testSolutionId = `sol_test_${Date.now()}`;
  let insertOk = false;
  try {
    sqlite.insertTenantRecord('solutions', 'TENANT_ALPHA', {
      id: testSolutionId,
      title: 'Persistence Test Invariant',
      domain: 'SET_THEORY',
      status: 'PENDING_AUDIT',
      price_cents: 15000,
      author_id: 'usr_alpha'
    });
    const persisted = db.get('SELECT id, tenant_id, status FROM solutions WHERE id = ?', [testSolutionId]);
    insertOk = diskBacked && persisted?.id === testSolutionId && persisted?.tenant_id === 'TENANT_ALPHA';
    sqliteSteps.push({
      step: 'RECORD_INSERT',
      passed: insertOk,
      duration_ms: performance.now() - t1,
      details: { tenant_id: 'TENANT_ALPHA', id: testSolutionId, persisted_readback: insertOk }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'RECORD_INSERT',
      passed: false,
      duration_ms: performance.now() - t1,
      details: { error: err.message }
    });
  }

  // Step 3: SELECT
  const t2 = performance.now();
  let selectOk = false;
  try {
    const persisted = db.get('SELECT id FROM solutions WHERE id = ? AND tenant_id = ?', [testSolutionId, 'TENANT_ALPHA']);
    const found = persisted?.id === testSolutionId;
    selectOk = diskBacked && found;
    sqliteSteps.push({
      step: 'RECORD_SELECT',
      passed: selectOk,
      duration_ms: performance.now() - t2,
      details: { record_matched: found, disk_file_exists: diskDbExists, disk_backed: sqlite.isDiskBacked() }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'RECORD_SELECT',
      passed: false,
      duration_ms: performance.now() - t2,
      details: { error: err.message }
    });
  }

  // Step 4: UPDATE
  const t3 = performance.now();
  let updateOk = false;
  try {
    sqlite.updateTenantRecord('solutions', 'TENANT_ALPHA', testSolutionId, { status: 'VERIFIED_ACTIVE' });
    const updated = db.get('SELECT id, status FROM solutions WHERE id = ? AND tenant_id = ?', [testSolutionId, 'TENANT_ALPHA']);
    updateOk = diskBacked && Boolean(updated && updated.status === 'VERIFIED_ACTIVE');
    sqliteSteps.push({
      step: 'RECORD_UPDATE',
      passed: updateOk,
      duration_ms: performance.now() - t3,
      details: { target_id: testSolutionId, updated_status: updated?.status, disk_file_exists: diskDbExists, disk_backed: sqlite.isDiskBacked() }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'RECORD_UPDATE',
      passed: false,
      duration_ms: performance.now() - t3,
      details: { error: err.message }
    });
  }

  // Step 5: TRANSACTION & ROLLBACK
  const t4 = performance.now();
  let rollbackOk = false;
  const rollbackId = `sol_rb_${Date.now()}`;
  try {
    if (!diskBacked) throw new Error('BLOCKED: disk-backed SQLite is unavailable.');
    db.exec('BEGIN TRANSACTION;');
    db.run('INSERT INTO solutions (id, tenant_id, status) VALUES (?, ?, ?)', [rollbackId, 'TENANT_ALPHA', 'CANCELLED']);
    db.exec('ROLLBACK;');

    const afterRollback = db.get('SELECT id FROM solutions WHERE id = ?', [rollbackId]);
    const rolledBack = !afterRollback;
    rollbackOk = rolledBack;
    sqliteSteps.push({
      step: 'TRANSACTION_ROLLBACK',
      passed: rollbackOk,
      duration_ms: performance.now() - t4,
      details: { rolled_back_id: rollbackId, record_absent_after_rollback: rolledBack, disk_file_exists: diskDbExists, disk_backed: sqlite.isDiskBacked() }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'TRANSACTION_ROLLBACK',
      passed: false,
      duration_ms: performance.now() - t4,
      details: { error: err.message }
    });
  }

  // Step 6: RESTART READBACK
  const t5 = performance.now();
  let restartReadbackOk = false;
  try {
    // Re-instantiate sqlite database reader from disk file
    if (diskBacked) {
      // @ts-ignore
      const nodeSqlite = typeof require === 'function' ? require('node:sqlite') : null;
      if (nodeSqlite && nodeSqlite.DatabaseSync) {
        const freshDb = new nodeSqlite.DatabaseSync(dbPath);
        const rows = freshDb.prepare('SELECT id, status FROM solutions WHERE id = ?').all(testSolutionId);
        restartReadbackOk = rows.some((row: any) => row.id === testSolutionId);
      } else {
        restartReadbackOk = false;
      }
    } else {
      restartReadbackOk = false;
    }
    sqliteSteps.push({
      step: 'RESTART_READBACK',
      passed: restartReadbackOk,
      duration_ms: performance.now() - t5,
      details: { disk_file_exists: diskDbExists, disk_backed: sqlite.isDiskBacked(), readback_verified: restartReadbackOk }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'RESTART_READBACK',
      passed: false,
      duration_ms: performance.now() - t5,
      details: { error: err.message }
    });
  }

  // Step 7: TENANT ISOLATION
  const t6 = performance.now();
  let tenantIsolationOk = false;
  try {
    // Tenant B queries solutions - must NOT see Tenant A's private records
    const tenantARecord = db.get('SELECT id FROM solutions WHERE id = ? AND tenant_id = ?', [testSolutionId, 'TENANT_ALPHA']);
    const tenantBRecords = db.all('SELECT id FROM solutions WHERE tenant_id = ?', ['TENANT_BETA']);
    const leaked = tenantBRecords.some((r: any) => r.id === testSolutionId);
    tenantIsolationOk = diskBacked && tenantARecord?.id === testSolutionId && !leaked;
    sqliteSteps.push({
      step: 'TENANT_ISOLATION',
      passed: tenantIsolationOk,
      duration_ms: performance.now() - t6,
      details: {
        tenant_a: 'TENANT_ALPHA',
        tenant_b: 'TENANT_BETA',
        tenant_a_record_readback: tenantARecord?.id === testSolutionId,
        tenant_b_records_count: tenantBRecords.length,
        leak_detected: leaked,
        disk_file_exists: diskDbExists,
        disk_backed: sqlite.isDiskBacked()
      }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'TENANT_ISOLATION',
      passed: false,
      duration_ms: performance.now() - t6,
      details: { error: err.message }
    });
  }

  // Step 8: AUDIT CHAIN PERSISTENCE
  const t7 = performance.now();
  let auditOk = false;
  try {
    const durable = DurableStore.getInstance();
    const appended = durable.appendAudit(
      'TENANT_ALPHA',
      'DN-31',
      'PERSISTENCE_TEST_AUDIT',
      'TEST',
      testSolutionId,
      { timestamp }
    );
    const chainVerification = durable.verifyChain();
    const persistedAudit = db.get('SELECT id FROM audit_records WHERE id = ?', [appended.id]);
    auditOk = diskBacked && chainVerification.valid && Boolean(persistedAudit?.id === appended.id);
    sqliteSteps.push({
      step: 'AUDIT_CHAIN_PERSISTENCE',
      passed: auditOk,
      duration_ms: performance.now() - t7,
      details: {
        audit_record_id: appended.id,
        merkle_chain_valid: chainVerification.valid,
        chain_blocks: chainVerification.total_records,
        persisted_readback: Boolean(persistedAudit?.id === appended.id)
      }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'AUDIT_CHAIN_PERSISTENCE',
      passed: false,
      duration_ms: performance.now() - t7,
      details: { error: err.message }
    });
  }

  // Step 9: EVIDENCE PERSISTENCE
  const t8 = performance.now();
  let evidenceOk = false;
  try {
    const testBundle = {
      bundle_id: `ev_bundle_${Date.now()}`,
      test_id: 'PERSIST_EVIDENCE_TEST',
      hash: computeSha256(testSolutionId)
    };
    sqlite.insertTenantRecord('proof_evidence', 'TENANT_ALPHA', {
      id: testBundle.bundle_id,
      bundle_id: testBundle.bundle_id,
      solution_id: testSolutionId,
      claim_scope: 'LOCAL',
      hash: testBundle.hash,
      status: 'VERIFIED'
    });
    const readback = sqlite.findTenantRecords('proof_evidence', 'TENANT_ALPHA');
    const persistedEvidence = db.get('SELECT id FROM proof_evidence WHERE id = ?', [testBundle.bundle_id]);
    const persistedEvidenceReadback = diskBacked && persistedEvidence?.id === testBundle.bundle_id;
    evidenceOk = diskBacked && readback.some(b => b.bundle_id === testBundle.bundle_id && b.hash === testBundle.hash) &&
      persistedEvidence?.id === testBundle.bundle_id;
    sqliteSteps.push({
      step: 'EVIDENCE_PERSISTENCE',
      passed: evidenceOk,
      duration_ms: performance.now() - t8,
      details: {
        bundle_id: testBundle.bundle_id,
        verified: evidenceOk,
        persisted_readback: persistedEvidenceReadback,
        disk_backed: sqlite.isDiskBacked()
      }
    });
  } catch (err: any) {
    sqliteSteps.push({
      step: 'EVIDENCE_PERSISTENCE',
      passed: false,
      duration_ms: performance.now() - t8,
      details: { error: err.message }
    });
  }

  const allLocalPassed =
    schemaOk &&
    insertOk &&
    selectOk &&
    updateOk &&
    rollbackOk &&
    restartReadbackOk &&
    tenantIsolationOk &&
    auditOk &&
    evidenceOk;

  // ==========================================
  // 2. NEON POSTGRESQL GATEWAY VERIFICATION
  // ==========================================
  const neon = NeonStore.getInstance();
  const neonConfigured = neon.isConfigured();
  let neonConnected = false;
  let neonStatus: PersistenceVerificationReport['neon']['status'] = 'PROVIDER_REQUIRED';
  let neonNotes = 'NEON_DATABASE_URL not configured in environment. Local SQLite verified; Neon production persistence blocked.';

  if (neonConfigured) {
    const tNeon = performance.now();
    neonConnected = await neon.connect();
    if (neonConnected) {
      neonStatus = 'VERIFIED';
      neonNotes = 'Successfully connected and verified against live Neon Serverless PostgreSQL instance.';
      neonSteps.push({
        step: 'NEON_CONNECTION_AND_QUERY',
        passed: true,
        duration_ms: performance.now() - tNeon,
        details: { status: 'CONNECTED' }
      });
    } else {
      neonStatus = 'FAILED';
      neonNotes = 'NEON_DATABASE_URL configured but connection failed closed.';
      neonSteps.push({
        step: 'NEON_CONNECTION_AND_QUERY',
        passed: false,
        duration_ms: performance.now() - tNeon,
        details: { status: 'FAILED' }
      });
    }
  } else {
    neonSteps.push({
      step: 'NEON_PREFLIGHT_CHECK',
      passed: false,
      duration_ms: 0,
      details: { status: 'PROVIDER_REQUIRED', message: 'NEON_DATABASE_URL absent' }
    });
  }

  return {
    timestamp,
    claim_scope: 'LOCAL',
    sqlite: {
      status: allLocalPassed ? 'VERIFIED' : 'FAILED',
      tables_created: tableCount,
      required_tables: 27,
      migration_passed: schemaOk,
      schema_creation_passed: schemaOk,
      insert_passed: insertOk,
      select_passed: selectOk,
      update_passed: updateOk,
      transaction_rollback_passed: rollbackOk,
      restart_readback_passed: restartReadbackOk,
      tenant_isolation_passed: tenantIsolationOk,
      audit_chain_passed: auditOk,
      evidence_persistence_passed: evidenceOk,
      steps: sqliteSteps
    },
    neon: {
      configured: neonConfigured,
      connected: neonConnected,
      status: neonStatus,
      claim_scope: neonConnected ? 'PRODUCTION' : 'LOCAL',
      notes: neonNotes,
      steps: neonSteps
    },
    all_local_passed: allLocalPassed,
    production_persistence_ready: neonConnected
  };
}
