import { DurableStore } from '../database/DurableStore';
import { NodeRegistry } from '../nodes/NodeRegistry';
import { ParadoxRegistry } from '../paradoxes/ParadoxRegistry';
import { MMTAIProtocol } from '../mmtai/MMTAIProtocol';
import { NOPOTVerifier } from '../proofs/NOPOTProof';
import { ProofEngine } from '../proofs/ProofEngine';
import { ProofBundleBuilder } from '../proofs/ProofBundle';
import { SolutionPipeline } from '../solutions/SolutionPipeline';
import { MarketplaceEngine } from '../marketplace/MarketplaceEngine';
import { PayPalAdapter } from '../payments/PayPalAdapter';
import { ExternalAdapterRegistry } from '../adapters/ExternalAdapters';
import { CrystalClearBox } from '../audit/CrystalClearBox';
import { computeSha256 } from '../database/DatabaseSchema';
import { SqliteStore } from '../database/SqliteStore';
import { AuthService } from '../auth/AuthService';
import { OrderLifecycleManager } from '../marketplace/OrderLifecycle';
import { ReversibilityEngine } from '../database/ReversibilityEngine';

export interface EnterpriseTestResult {
  test_number: number;
  name: string;
  category: string;
  passed: boolean;
  duration_ms: number;
  details: any;
  error?: string;
}

export async function runEnterpriseVerification() {
  const testResults: EnterpriseTestResult[] = [];
  const testQueue: Array<() => Promise<void>> = [];
  let testCounter = 1;

  function runTest(name: string, category: string, fn: () => void | Promise<void>) {
    testQueue.push(async () => {
      const start = Date.now();
      try {
        await fn();
        const dur = Date.now() - start;
        testResults.push({
          test_number: testCounter++,
          name,
          category,
          passed: true,
          duration_ms: dur,
          details: { status: 'PASSED' }
        });
      } catch (e: any) {
        const dur = Date.now() - start;
        testResults.push({
          test_number: testCounter++,
          name,
          category,
          passed: false,
          duration_ms: dur,
          details: { status: 'FAILED' },
          error: e.message || String(e)
        });
      }
    });
  }

  // 1. Authentication & RBAC Test
  runTest('MMTAI Token Minting Requires Human-Root Approval', 'SECURITY', () => {
    const mmtai = MMTAIProtocol.getInstance();
    let blocked = false;
    try {
      mmtai.issueAuthorizationToken('ROLE_VERIFIER', 'CAP_SANDBOX_EXECUTE', 'TENANT_TEST');
    } catch (error) {
      blocked = error instanceof Error && error.message.startsWith('BLOCKED:');
    }
    if (!blocked) throw new Error('MMTAI minted an authorization token without a verified human-root grant');
  });

  // 2. Unknown or fabricated authority tokens must never authorize execution.
  runTest('MMTAI Rejects Unissued Tokens and Preserves Fail-Closed Boundary', 'SECURITY', () => {
    const mmtai = MMTAIProtocol.getInstance();
    const fabricated = computeSha256('UNAPPROVED_TEST_TOKEN');
    const first = mmtai.authorizeExecution('CAP_SANDBOX_EXECUTE', 'ROLE_VERIFIER', fabricated, 'ATTEMPT_1', 'TENANT_REPLAY');
    const replay = mmtai.authorizeExecution('CAP_SANDBOX_EXECUTE', 'ROLE_VERIFIER', fabricated, 'ATTEMPT_2', 'TENANT_REPLAY');
    if (first.permitted || replay.permitted) {
      throw new Error('An unissued token authorized an operation');
    }
  });

  // 3. Tenant isolation is tested at the actual row-filtering boundary.
  runTest('Multi-Tenant Row-Level Storage Partition Isolation', 'SECURITY', () => {
    const sqlite = SqliteStore.getInstance();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tenantA = `TENANT_A_${suffix}`;
    const tenantB = `TENANT_B_${suffix}`;
    const rowA = `ROW_A_${suffix}`;
    const rowB = `ROW_B_${suffix}`;
    let isolated = false;
    try {
      sqlite.insertTenantRecord('problems', tenantA, { id: rowA, marker: 'A' });
      sqlite.insertTenantRecord('problems', tenantB, { id: rowB, marker: 'B' });
      let crossTenantCollisionBlocked = false;
      try {
        sqlite.insertTenantRecord('problems', tenantB, { id: rowA, marker: 'OVERWRITE_ATTEMPT' });
      } catch (error) {
        crossTenantCollisionBlocked = error instanceof Error && error.message.includes('Tenant-scoped primary-key collision');
      }
      const rowsA = sqlite.findTenantRecords<any>('problems', tenantA, 100);
      const rowsB = sqlite.findTenantRecords<any>('problems', tenantB, 100);
      isolated = crossTenantCollisionBlocked &&
        rowsA.some(row => row.id === rowA && row.marker === 'A') &&
        !rowsA.some(row => row.id === rowB || row.tenant_id === tenantB) &&
        rowsB.some(row => row.id === rowB) &&
        !rowsB.some(row => row.id === rowA || row.tenant_id === tenantA);
    } finally {
      sqlite.deleteTenantRecord('problems', tenantA, rowA);
      sqlite.deleteTenantRecord('problems', tenantB, rowB);
    }
    if (!isolated) throw new Error('Tenant-scoped storage queries exposed a cross-tenant row.');
    // This test establishes row filtering only; it does not establish cryptographic key isolation.
  });

  // 4. SHA-256 Linear Audit Chain Continuity
  runTest('Audit Chain Cryptographic Hash Continuity', 'AUDIT', () => {
    const store = DurableStore.getInstance();
    const auditRecord = store.appendAudit('TENANT_AUDIT', 'TEST_HARNESS', 'TEST_ACTION', 'ENTITY', 'ID_1', { hello: 'world' });
    if (!auditRecord.record_hash || auditRecord.record_hash.length !== 64) {
      throw new Error('Audit record produced invalid SHA-256 hash');
    }
    const verification = store.verifyChain();
    if (!verification.valid) {
      throw new Error(`Audit chain verification failed: ${verification.reason}`);
    }
  });

  // 5. Anti-Tamper Sentinel Detection
  runTest('Anti-Tamper Sentinel Active Tamper Detection', 'AUDIT', () => {
    const store = DurableStore.getInstance();
    const chain = store.getState().audit_chain;
    if (chain.length < 2) {
      store.appendAudit('TENANT_SENTINEL', 'SENTINEL', 'GENERATE_BLOCK', 'ENTITY', 'ID_SENTINEL', {});
    }
    const targetIdx = chain.length - 1;
    const originalHash = chain[targetIdx].payload_hash;
    // Inject subtle byte mutation
    chain[targetIdx].payload_hash = 'f'.repeat(64);
    const tamperCheck = store.verifyChain();
    // Restore original immediately
    chain[targetIdx].payload_hash = originalHash;
    if (tamperCheck.valid) {
      throw new Error('Tampered block failed to trigger cryptographic validation alarm!');
    }
  });

  // 6. Atomic State Checkpoint and Verified Rollback
  runTest('Atomic State Checkpoint & Reversibility Engine', 'PERSISTENCE', () => {
    const store = DurableStore.getInstance();
    const checkpoint = store.createCheckpoint('TENANT_ROLLBACK', 'MUTATION_TEST', 'ATOMIC_DATABASE_RESTORE');
    store.getState().problems['prob_mutated'] = {
      id: 'prob_mutated',
      tenant_id: 'TENANT_ROLLBACK',
      raw_problem: 'Mutated state to rollback',
      normalized_title: 'Mutated',
      domain: 'TEST',
      detected_constraints: [],
      invariants: [],
      status: 'INTAKE',
      created_at: Date.now()
    };
    if (!store.getState().problems['prob_mutated']) throw new Error('Mutation failed');
    const rollback = store.rollbackToCheckpoint(checkpoint.id, 'Test rollback verification', 'TENANT_ROLLBACK');
    if (!rollback.success) throw new Error(`Rollback failed: ${rollback.error}`);
    if (store.getState().problems['prob_mutated']) {
      throw new Error('Mutated entity still present after rollback execution!');
    }
  });

  // 7. Global snapshots must not roll back another tenant's records.
  runTest('Checkpoint Rollback Blocks Cross-Tenant Snapshot Scope', () => {
    const store = DurableStore.getInstance();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const problemA = `checkpoint_A_${suffix}`;
    const problemB = `checkpoint_B_${suffix}`;
    const makeProblem = (id: string, tenant_id: string) => ({
      id, tenant_id, raw_problem: 'checkpoint scope test',
      normalized_title: 'checkpoint scope test', domain: 'TEST',
      detected_constraints: [], invariants: ['test invariant'],
      status: 'INTAKE', created_at: Date.now()
    });
    store.getState().problems[problemA] = makeProblem(problemA, 'TENANT_CHECKPOINT_A');
    store.getState().problems[problemB] = makeProblem(problemB, 'TENANT_CHECKPOINT_B');
    store.persist();
    const checkpoint = store.createCheckpoint('TENANT_CHECKPOINT_A', 'CROSS_TENANT_SCOPE_TEST');
    try {
      const result = store.rollbackToCheckpoint(checkpoint.id, 'Cross-tenant rollback rejection test');
      if (result.success || !result.error?.includes('cross-tenant rollback is not permitted')) {
        throw new Error('Global checkpoint snapshot was allowed to roll back across tenant boundaries');
      }
      if (!store.getState().problems[problemA] || !store.getState().problems[problemB]) {
        throw new Error('Rejected cross-tenant rollback mutated tenant records');
      }
    } finally {
      delete store.getState().problems[problemA];
      delete store.getState().problems[problemB];
      delete store.getState().checkpoints[checkpoint.id];
      SqliteStore.getInstance().deleteRecordById('problems', problemA);
      SqliteStore.getInstance().deleteRecordById('problems', problemB);
      SqliteStore.getInstance().deleteRecordById('checkpoints', checkpoint.id);
      store.persist();
    }
  });

  // 7. Irreversible Action Reversal Rejection Guard
  runTest('Irreversible Action Rollback Rejection Guard', 'PERSISTENCE', () => {
    const store = DurableStore.getInstance();
    const checkpoint = store.createCheckpoint('TENANT_IRREVERSIBLE', 'EXTERNAL_PAYMENT_MUTATION', 'IRREVERSIBLE_EXTERNAL_ACTION');
    const rollbackAttempt = store.rollbackToCheckpoint(checkpoint.id, 'Illegal external rollback attempt');
    if (rollbackAttempt.success) {
      throw new Error('Rollback succeeded on IRREVERSIBLE_EXTERNAL_ACTION checkpoint!');
    }
    if (!rollbackAttempt.error?.includes('IRREVERSIBLE_EXTERNAL_ACTION')) {
      throw new Error('Unexpected error message on irreversible rejection');
    }
  });

  // 8. 32 Historical Paradox Bootstrap Registry
  runTest('Paradox Registry Integrity (Exact 32 Bootstrap Set)', 'PARADOX', () => {
    const reg = ParadoxRegistry.getInstance();
    const all = reg.getAllParadoxes();
    if (all.length !== 32) {
      throw new Error(`Expected exactly 32 paradoxes, found ${all.length}`);
    }
    const zenoAchilles = reg.getByCode('DH-P-001');
    if (!zenoAchilles || zenoAchilles.verification_status !== 'VERIFIED') {
      throw new Error('DH-P-001 missing or not marked VERIFIED');
    }
    const barber = reg.getByCode('DH-P-003');
    if (!barber || barber.verification_status !== 'FAMILY_VARIANT') {
      throw new Error('DH-P-003 should be classified as FAMILY_VARIANT');
    }
  });

  // 9. Paradox Classification Taxonomy Accuracy
  runTest('Paradox Duplicate & Family Variant Taxonomy', 'PARADOX', () => {
    const reg = ParadoxRegistry.getInstance();
    const counts = reg.getStatusBreakdown();
    if (!counts['VERIFIED'] || counts['VERIFIED'] < 10) {
      throw new Error('Insufficient verified paradoxes cataloged');
    }
    if (!counts['FAMILY_VARIANT'] || counts['FAMILY_VARIANT'] < 3) {
      throw new Error('Family variants not properly classified');
    }
    if (!counts['CLAIM_ONLY'] || counts['CLAIM_ONLY'] < 2) {
      throw new Error('Unresolved paradoxes should be classified as CLAIM_ONLY');
    }
  });

  // 10. NOPOT measured execution is paired with an actual Z3 theorem run.
  runTest('NOPOT Bounded Termination Uses Actual Z3 Verification', 'PROOFS', async () => {
    const { certificate: cert, z3Result } =
      await NOPOTVerifier.verifyWithZ3Solver('BoundedNaturalNumberDecrement', 64);
    if (!cert.termination_proved) throw new Error('Measured decrement execution did not reach zero');
    if (!cert.strictly_decreasing) throw new Error('Measured ranking value did not strictly decrease');
    if (cert.actual_measured_steps !== 64) throw new Error(`Expected 64 measured decrement steps, got ${cert.actual_measured_steps}`);
    if (cert.actual_measured_steps > cert.bounded_steps_upper_bound) {
      throw new Error('Measured steps exceeded upper bound');
    }
    if (!cert.formal_smt_verification?.verified_by_z3 ||
        z3Result.solver_result !== 'unsat' || !z3Result.proved ||
        z3Result.theorem_id !== 'THM-INDUCTIVE-TERMINATION-05') {
      throw new Error(`Actual Z3 termination proof did not verify: ${z3Result.solver_result}`);
    }
  });

  // 11. Pipeline construction must not seed fabricated solution records.
  runTest('Solution Pipeline Does Not Invent Unverified Solution Records', 'SOLUTIONS', () => {
    SolutionPipeline.getInstance();
    const store = DurableStore.getInstance();
    if (store.getState().solutions['DH-S-001']) {
      throw new Error('Pipeline constructor inserted a solution without source-backed verification evidence');
    }
  });

  // 12. Proof Bundle Builder & Attestation Sealing
  runTest('Proof Bundle Builder Seal & Independent Oracle Attestation', 'PROOFS', () => {
    const builder = new ProofBundleBuilder('PB-TEST-SEAL', 'SUB-001', 'Test verifiable claim');
    builder
      .addTest('TEST-1', 'Basic assertion', true, 1.0)
      .addFormalProof('NOPOT', 'V(x) < V(y)', true)
      .addOracle('ORACLE-01', 'Test Witness', 'SIG_CHECK', true)
      .addReplay('REPLAY-01', 'hash_a', 'hash_a');
    const sealed = builder.seal();
    if (sealed.verification_status !== 'PARTIAL') {
      throw new Error(`Self-asserted proof/oracle metadata must remain PARTIAL, received ${sealed.verification_status}`);
    }
    if (sealed.formal_proofs.some(proof => proof.checked)) {
      throw new Error('Caller-supplied formal-proof boolean was accepted as a checked proof receipt');
    }
  });

  // 13. Deterministic Replay Cleanroom Verification
  runTest('Cleanroom Replay Bitrot & Divergence Detection', 'PROOFS', () => {
    const builder = new ProofBundleBuilder('PB-DIVERGENT', 'SUB-DIV', 'Divergence test');
    builder
      .addTest('TEST-DIV', 'Run test', true, 1.0)
      .addFormalProof('NOPOT', 'spec', true)
      .addOracle('ORACLE-DIV', 'Witness', 'SIG', true)
      .addReplay('REPLAY-DIV', 'expected_hash_xyz', 'observed_hash_divergent');
    const sealed = builder.seal();
    if (sealed.verification_status !== 'FAIL') {
      throw new Error('Divergent replay was not flagged as FAIL');
    }
  });

  // 14. Pipeline runs its implemented static gates and stops at the absent sandbox.
  runTest('21-Stage Pipeline Stops at Unavailable Cleanroom Adapter', 'PIPELINE', async () => {
    const pipeline = SolutionPipeline.getInstance();
    const missingProblemId = `missing_pipeline_problem_${Date.now()}`;
    const result = await pipeline.runPipeline(missingProblemId, 'export function solve() { return true; }');
    if (result.overall_success) throw new Error('Pipeline claimed success without sandbox and downstream proof handlers');
    if (result.total_stages !== 21) throw new Error(`Expected 21 declared stages, got ${result.total_stages}`);
    if (result.stage_traces.length === 0) throw new Error('Pipeline emitted no stage trace');
    const last = result.stage_traces[result.stage_traces.length - 1];
    if (last.status !== 'BLOCKED' || last.stage !== 2) {
      throw new Error(`Expected missing persisted problem to block at stage 2, got stage ${last.stage} / ${last.status}`);
    }
    if (!result.rejection_reason?.includes('persisted problem record')) throw new Error('Pipeline did not expose the actual missing-input blocker');
  });

  // 15. AST recursion inspection includes arrow-function self-calls.
  runTest('Pipeline Detects Arrow-Function Recursion Without a Ranking Invariant', 'PIPELINE', async () => {
    const id = `prob_recursive_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const store = DurableStore.getInstance();
    store.getState().problems[id] = {
      id,
      tenant_id: 'TENANT_PIPELINE_TEST',
      raw_problem: 'Recursion guard test',
      normalized_title: 'Recursion guard test',
      domain: 'TEST',
      detected_constraints: [],
      invariants: ['boundary at zero'],
      status: 'INTAKE',
      created_at: Date.now()
    };
    store.persist();
    try {
      const result = await SolutionPipeline.getInstance().runPipeline(id, 'const recurse = () => recurse();');
      const last = result.stage_traces[result.stage_traces.length - 1];
      if (last?.stage !== 4 || last.status !== 'BLOCKED') {
        throw new Error(`Expected arrow-function recursion to block at stage 4, got ${last?.stage ?? 'none'} / ${last?.status ?? 'none'}`);
      }
      if (!String(last.reason).includes('termination/ranking invariant')) {
        throw new Error('Recursion blocker did not identify the missing ranking invariant');
      }
    } finally {
      delete store.getState().problems[id];
      SqliteStore.getInstance().deleteRecordById('problems', id);
      store.persist();
    }
  });

  // 16. Pipeline Fail-Closed Boundary Rejection
  runTest('Pipeline Rejects Invalid TypeScript Before Any Later Stage', 'PIPELINE', async () => {
    const pipeline = SolutionPipeline.getInstance();
    const result = await pipeline.runPipeline('DH-P-001', 'export function broken( {');
    if (result.overall_success) throw new Error('Syntactically invalid source was accepted');
    const first = result.stage_traces[0];
    if (!first || first.stage !== 1 || first.status !== 'FAILED') {
      throw new Error('Invalid source did not fail at the syntax parsing gate');
    }
    if (result.stage_traces.length !== 1) throw new Error('Pipeline continued after syntax failure');
  });

  // 17. Defensible Pricing Formula v1.4 Determinism
  runTest('Defensible Pricing Formula v1.4 Deterministic Execution', 'MARKETPLACE', () => {
    const market = MarketplaceEngine.getInstance();
    const p1 = market.calculateDefensiblePrice(10000, 1.5, 'MEDIUM');
    const p2 = market.calculateDefensiblePrice(10000, 1.5, 'MEDIUM');
    if (p1.final_price_cents !== p2.final_price_cents) {
      throw new Error('Defensible pricing calculation was non-deterministic');
    }
    if (p1.calculation_hash !== p2.calculation_hash) {
      throw new Error('Defensible pricing hash mismatch');
    }
    if (p1.final_price_cents !== 25313) {
      throw new Error(`Expected price 25313 cents, received ${p1.final_price_cents}`);
    }
  });

  // 18. Marketplace construction must not seed a fabricated sample offer.
  runTest('Marketplace Does Not Bootstrap Unverified Sample Offers', 'MARKETPLACE', () => {
    const market = MarketplaceEngine.getInstance();
    const offers = DurableStore.getInstance().getState().offers;
    const sample = Object.values(offers).find(offer =>
      offer.title.includes('Verified Zeno Geometric Convergence Suite')
    );
    if (sample) throw new Error('Marketplace constructor inserted a sample offer without current verification evidence');
    if (!market) throw new Error('Marketplace engine did not initialize');
  });

  // 17. Marketplace Unverified Solution Publication Blocker
  runTest('Marketplace Blocks Publication of Unverified Solutions', 'MARKETPLACE', () => {
    const market = MarketplaceEngine.getInstance();
    const result = market.publishOffer(
      'UNVERIFIED_SOL',
      'PB_NON_EXISTENT',
      'Dangerous Unverified Offer',
      'Should be rejected',
      5000,
      1.0,
      'HIGH'
    );
    if (result.success) {
      throw new Error('Unverified solution was published to marketplace!');
    }
  });

  // 18. Server-Authoritative PayPal DN-35 Fail-Closed Execution
  runTest('PayPal DN-35 Server-Authoritative Fail-Closed Enforcement', 'PAYMENTS', async () => {
    const paypal = PayPalAdapter.getInstance();
    const origSbId = process.env.PAYPAL_SANDBOX_ID;
    const origSbKey = process.env.PAYPAL_SANDBOX_KEY;
    const origSbClientId = process.env.PAYPAL_SANDBOX_CLIENT_ID;
    const origSbClientSec = process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
    const origClientId = process.env.PAYPAL_CLIENT_ID;
    const origClientSec = process.env.PAYPAL_CLIENT_SECRET;
    try {
      delete process.env.PAYPAL_SANDBOX_ID;
      delete process.env.PAYPAL_SANDBOX_KEY;
      delete process.env.PAYPAL_SANDBOX_CLIENT_ID;
      delete process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
      paypal.clearSessionCredentials();
      const res = await paypal.captureOrderPayment('ORD_TEST_123', 2500, 'IDEMP_KEY_001');
      if (res.status !== 'EXTERNAL_PROVIDER_REQUIRED') {
        throw new Error(`Expected EXTERNAL_PROVIDER_REQUIRED without credentials, received ${res.status}`);
      }
    } finally {
      if (origSbId) process.env.PAYPAL_SANDBOX_ID = origSbId;
      if (origSbKey) process.env.PAYPAL_SANDBOX_KEY = origSbKey;
      if (origSbClientId) process.env.PAYPAL_SANDBOX_CLIENT_ID = origSbClientId;
      if (origSbClientSec) process.env.PAYPAL_SANDBOX_CLIENT_SECRET = origSbClientSec;
      if (origClientId) process.env.PAYPAL_CLIENT_ID = origClientId;
      if (origClientSec) process.env.PAYPAL_CLIENT_SECRET = origClientSec;
    }
  });

  // 19. External Provider Inventory Transparency
  runTest('External Adapter Inventory Transparency (Neon, PayPal)', 'ADAPTERS', () => {
    const inventory = ExternalAdapterRegistry.getInventory();
    if (inventory.length < 3) throw new Error('Expected at least 3 external adapters cataloged');
    const pp = inventory.find(i => i.adapter_id === 'DN-35');
    if (!pp) throw new Error('DN-35 PayPal adapter missing from inventory');
  });

  // 20. Crystal Clear Box projects only evidence that is actually persisted.
  runTest('Crystal Clear Box Redaction Uses Persisted Evidence Only', 'AUDIT', () => {
    const engine = ProofEngine.getInstance();
    const bundles = engine.getAllBundles();
    for (const bundle of bundles) {
      const customerView = CrystalClearBox.projectCustomerEvidence(bundle);
      if (!customerView.proprietary_weights_redacted) throw new Error('Proprietary weights not marked redacted');
      if (!customerView.internal_reasoning_redacted) throw new Error('Internal reasoning not marked redacted');
      if (!customerView.public_audit_token || customerView.public_audit_token.length !== 64) {
        throw new Error('Customer public audit token invalid');
      }
    }
    // An empty evidence store is valid; the test must not create a fake proof to make itself pass.
    if (bundles.length === 0 && Object.keys(DurableStore.getInstance().getState().proof_bundles).length !== 0) {
      throw new Error('Proof engine failed to load persisted proof records');
    }
  });

  // 21. Complete 54-Node Registry Integrity
  runTest('Daisy Node Registry (54 Distinct Nodes)', 'NODES', () => {
    const reg = NodeRegistry.getInstance();
    const all = reg.getAllNodes();
    if (all.length !== 54) {
      throw new Error(`Expected exactly 54 nodes, found ${all.length}`);
    }
    const dn34 = reg.getNode('DN-34');
    const dn35 = reg.getNode('DN-35');
    const dn38 = reg.getNode('DN-38');
    if (!dn34 || !dn35 || !dn38) {
      throw new Error('Required adapter nodes DN-34, DN-35, DN-38 missing');
    }
  });

  // 22. System status is derived from the live store and node registry.
  runTest('System Status Projection Computes Real State', 'API', () => {
    const store = DurableStore.getInstance();
    const nodes = NodeRegistry.getInstance().getAllNodes();
    const chain = store.verifyChain();
    if (!Array.isArray(nodes)) throw new Error('Node registry did not return a real node collection');
    if (typeof chain.valid !== 'boolean') throw new Error('Audit-chain verifier did not return a boolean verdict');
    if (store.getState().audit_chain.length > 0 && !chain.valid) {
      throw new Error(`Persisted audit chain failed verification: ${chain.reason}`);
    }
  });

  // 23. SqliteStore Multi-Tenant Persistence & 27 Tables Integrity
  runTest('SqliteStore Multi-Tenant Persistence & 27 Tables Integrity', 'DATABASE', () => {
    const store = SqliteStore.getInstance();
    const rawDb = store.getRawDb();
    const tables = rawDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    const tableNames = tables.map((t: any) => t.name);
    const required27 = [
      'users', 'tenants', 'roles', 'permissions', 'tenant_memberships',
      'problems', 'paradoxes', 'invariants', 'solutions', 'offers',
      'proof_bundles', 'proof_evidence', 'tests', 'verification_runs',
      'orders', 'payments', 'deployments', 'checkpoints', 'rollback_records',
      'telemetry', 'audit_records', 'chain_records', 'licenses',
      'adapter_status', 'node_registry', 'execution_runs', 'failures'
    ];
    for (const req of required27) {
      if (!tableNames.includes(req)) {
        throw new Error(`Required table [${req}] missing from SQLite persistence`);
      }
    }
  });

  // 24. Fail-Closed: CLAIM_ONLY / UNVERIFIED Offer Publication Blocked
  runTest('Fail-Closed: CLAIM_ONLY / UNVERIFIED Offer Publication Blocked', 'MARKETPLACE', () => {
    const market = MarketplaceEngine.getInstance();
    const res = market.publishOffer('SOL_NONEXISTENT', 'PB_NONEXISTENT', 'Unverified Offer', 'Desc', 100, 1.0, 'HIGH');
    if (res.success) {
      throw new Error('Unverified offer was published! Fail-closed invariant breached.');
    }
  });

  // 25. Fail-Closed: UNKNOWN / UNVERIFIED Order Creation Blocked
  runTest('Fail-Closed: UNKNOWN / UNVERIFIED Order Creation Blocked', 'MARKETPLACE', () => {
    const market = MarketplaceEngine.getInstance();
    const res = market.createOrder('TENANT_TEST', 'NON_EXISTENT_OFFER');
    if (res.success) {
      throw new Error('Order creation succeeded on non-existent unverified offer!');
    }
    if (!res.error?.includes('verified identity and signed tenant claims')) {
      throw new Error('Order creation did not enforce the verified-identity authorization boundary first.');
    }
  });

  // 26. Local token minting is disabled until the approved OIDC verifier is configured.
  runTest('Fail-Closed: Local Authentication Cannot Mint Sessions', 'SECURITY', () => {
    const auth = AuthService.getInstance();
    let blocked = false;
    try { auth.createSignedToken('c1', 'TENANT_C', 'customer@example.invalid', 'CUSTOMER'); }
    catch { blocked = true; }
    if (!blocked) throw new Error('Local authentication unexpectedly minted a session token');
    if (auth.verifyToken('not-a-real-token').valid) throw new Error('Unverified token was accepted');
  });

  // 27. Tenant-scoped operations require a verified identity.
  runTest('Fail-Closed: Unverified Identity Cannot Access Tenant Data', 'SECURITY', () => {
    const auth = AuthService.getInstance();
    const check = auth.authorize(null, 'VIEW_EVIDENCE', 'TENANT_BETA');
    if (check.authorized) throw new Error('Unverified identity was authorized for tenant data');
  });

  // 28. Fail-Closed: Missing PayPal Credentials Evaluated
  runTest('Fail-Closed: Missing PayPal Credentials Evaluated', 'ADAPTERS', async () => {
    const paypal = PayPalAdapter.getInstance();
    const orig = paypal.getEffectiveCredentials();
    paypal.clearSessionCredentials();
    const captureResult = await paypal.captureOrderPayment('ORD_TEST_99', 5000, 'IDEMP_99');
    if (orig) {
      paypal.setSessionCredentials(orig.clientId, orig.clientSecret, orig.environment);
    }
    if (captureResult.status !== 'EXTERNAL_PROVIDER_REQUIRED') {
      throw new Error('PayPal adapter did not remain fail-closed while payments are disabled.');
    }
  });

  // 29. Order transitions fail closed when no real order and verified identity exist.
  runTest('Order Lifecycle Blocks Unverified or Missing Orders', 'MARKETPLACE', () => {
    const lifecycle = OrderLifecycleManager.getInstance();
    const result = lifecycle.transitionOrder('NO_PERSISTED_ORDER', 'ORDER_CREATED');
    if (result.success) throw new Error('Order transition succeeded without a persisted order and verified identity');
  });

  // 30. Central Failure Diversion Preserves Evidence & Executes Rollback
  runTest('Central Failure Diversion Preserves Evidence & Executes Rollback', 'REVERSIBILITY', () => {
    const engine = ReversibilityEngine.getInstance();
    const chk = engine.createCheckpoint('TENANT_FAIL_TEST', 'TARGET_MUTATION', 'ATOMIC_DATABASE_RESTORE');
    const diversion = engine.divertFailure(
      'GATE_14_INDEPENDENT_REPLAY_VALIDATION',
      'Deterministic output hash mismatch during replay verification',
      'TENANT_FAIL_TEST',
      'exec_999',
      chk.id,
      { expected: 'hash_a', actual: 'hash_b' }
    );
    if (!diversion.fail_closed_enforced) throw new Error('Fail-closed not enforced in failure diversion');
    if (diversion.rollback_status !== 'ROLLED_BACK') {
      throw new Error(`Expected ROLLED_BACK status, got: ${diversion.rollback_status}`);
    }
  });

  // 31. DurableStore hydrates persisted records through the configured SQLite adapter.
  runTest('DurableStore SQLite Hydration and Persistence Mode Disclosure', () => {
    const id = `durable_hydration_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const store = DurableStore.getInstance();
    store.getState().problems[id] = {
      id,
      tenant_id: 'TENANT_DURABLE_TEST',
      raw_problem: 'DurableStore hydration verification',
      normalized_title: 'Hydration verification',
      domain: 'TEST',
      detected_constraints: [],
      invariants: ['boundary at zero'],
      status: 'INTAKE',
      created_at: Date.now()
    };
    store.persist();
    (DurableStore as any).instance = null;
    const reloaded = DurableStore.getInstance();
    const record = reloaded.getState().problems[id];
    if (!record || record.raw_problem !== 'DurableStore hydration verification') {
      throw new Error('DurableStore did not hydrate the persisted problem record from its backing adapter');
    }
    const mode = reloaded.getPersistenceMode();
    if (!['SQLITE_DISK', 'BROWSER_LOCAL_STORAGE', 'PROCESS_MEMORY_ONLY'].includes(mode)) {
      throw new Error(`Unexpected persistence mode: ${mode}`);
    }
    delete reloaded.getState().problems[id];
    SqliteStore.getInstance().deleteRecordById('problems', id);
    reloaded.persist();
  });

  // Execute all queued tests sequentially
  for (const testFn of testQueue) {
    await testFn();
  }

  const totalTests = testResults.length;
  const passedTests = testResults.filter(t => t.passed).length;
  const allPassed = totalTests === passedTests;

  return {
    allPassed,
    totalTests,
    passedTests,
    results: testResults
  };
}
