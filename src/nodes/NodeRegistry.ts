export interface NodeEntity {
  id: string;
  node_id: string;
  name: string;
  category: 'CORE_KERNEL' | 'LOGIC_SOLVER' | 'PERSISTENCE' | 'SECURITY' | 'MARKETPLACE' | 'ADAPTERS' | 'AUDIT' | 'PAYMENTS' | 'SETTLEMENT';
  execution_mode: 'CODE_EXECUTED' | 'EXTERNAL_PROVIDER_REQUIRED' | 'SANDBOX_ISOLATED';
  status: 'ACTIVE' | 'AVAILABLE' | 'EXTERNAL_PROVIDER_REQUIRED';
  purpose: string;
}

export class NodeRegistry {
  private static instance: NodeRegistry | null = null;
  private nodes: Map<string, NodeEntity> = new Map();

  private constructor() {
    this.bootstrap54Nodes();
  }

  public static getInstance(): NodeRegistry {
    if (!NodeRegistry.instance) {
      NodeRegistry.instance = new NodeRegistry();
    }
    return NodeRegistry.instance;
  }

  private bootstrap54Nodes(): void {
    const rawNodes: Array<{ id: string; name: string; category: NodeEntity['category']; mode: NodeEntity['execution_mode']; purpose: string }> = [
      { id: 'DN-01', name: 'Daisy Genesis Core', category: 'CORE_KERNEL', mode: 'CODE_EXECUTED', purpose: 'Root bootstrap and sovereign execution engine' },
      { id: 'DN-02', name: 'MMTAI Authority Gate', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Capability != Authority enforcement' },
      { id: 'DN-03', name: 'Z3 Theorem Prover Kernel', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'First-order logic and SMT automated theorem proving' },
      { id: 'DN-04', name: 'NOPOT Bounded Termination Engine', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Inductive ranking metric variant verification' },
      { id: 'DN-05', name: 'Crystal Clear Box Audit Engine', category: 'AUDIT', mode: 'CODE_EXECUTED', purpose: 'Zero-knowledge customer evidence projection' },
      { id: 'DN-06', name: 'Linear SHA-256 Merkle Ledger', category: 'AUDIT', mode: 'CODE_EXECUTED', purpose: 'Tamper-evident append-only cryptographic log' },
      { id: 'DN-07', name: 'Anti-Tamper Sentinel Monitor', category: 'AUDIT', mode: 'CODE_EXECUTED', purpose: 'Live real-time byte mutation and hash anomaly alarm' },
      { id: 'DN-08', name: 'Atomic Checkpoint Engine', category: 'PERSISTENCE', mode: 'CODE_EXECUTED', purpose: 'Deep snapshot serialization and state isolation' },
      { id: 'DN-09', name: 'Reversibility & Rollback Governor', category: 'PERSISTENCE', mode: 'CODE_EXECUTED', purpose: 'Guaranteed rollbacks for reversible state mutations' },
      { id: 'DN-10', name: 'Irreversible Action Firewall', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Guards against illegal rollback on external commitments' },
      { id: 'DN-11', name: '21-Stage Problem Pipeline', category: 'CORE_KERNEL', mode: 'CODE_EXECUTED', purpose: 'Sequential gate traversal and invariant inspection' },
      { id: 'DN-12', name: 'Fail-Closed Circuit Breaker', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Immediate transaction quarantine upon invariant violation' },
      { id: 'DN-13', name: 'Defensible Pricing Formula Engine', category: 'MARKETPLACE', mode: 'CODE_EXECUTED', purpose: 'Deterministic v1.4 algorithm for verifiable pricing' },
      { id: 'DN-14', name: 'Marketplace Publication Guard', category: 'MARKETPLACE', mode: 'CODE_EXECUTED', purpose: 'Blocks listing of unverified or partial solutions' },
      { id: 'DN-15', name: 'Multi-Tenant Partition Manager', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Cryptographic isolation across tenant boundaries' },
      { id: 'DN-16', name: 'RBAC Token Mint & Validator', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Signed cryptographic session bearer token control' },
      { id: 'DN-17', name: 'Single-Use Token Replay Sentinel', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Prevents non-deterministic replay attacks' },
      { id: 'DN-18', name: 'Cleanroom Deterministic Sandbox', category: 'CORE_KERNEL', mode: 'CODE_EXECUTED', purpose: 'Hermetic execution environment with zero network side-effects' },
      { id: 'DN-19', name: 'Bitrot & Drift Detection Oracle', category: 'AUDIT', mode: 'CODE_EXECUTED', purpose: 'Validates expected vs observed artifact digests' },
      { id: 'DN-20', name: 'Paradox Resolution Engine', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Disarms self-referential mathematical paradoxes' },
      { id: 'DN-21', name: 'Russell Naive Set Axiom Disprover', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Formal SMT proof of unrestricted comprehension contradiction' },
      { id: 'DN-22', name: 'Barber Semantic Variant Verifier', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'First-order logic verification of universal quantifier clash' },
      { id: 'DN-23', name: 'Curry Implication Contraction Guard', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Substructural logic verification preventing logical explosion' },
      { id: 'DN-24', name: 'Zeno Achilles Continuous Metric Solver', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Bounded epsilon convergence proof in finite steps' },
      { id: 'DN-25', name: 'Burali-Forti Ordinal Hierarchy Checker', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Ensures strict well-ordered set foundation' },
      { id: 'DN-26', name: 'Tarski Semantic Truth Tower Node', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Prevents object-metalanguage semantic collapse' },
      { id: 'DN-27', name: 'Halting Problem Boundary Sentinel', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Enforces Rice-Turing boundary on arbitrary execution' },
      { id: 'DN-28', name: 'Order State Machine Orchestrator', category: 'MARKETPLACE', mode: 'CODE_EXECUTED', purpose: 'Strict directed acyclic order state progression' },
      { id: 'DN-29', name: 'Preserved Solution Vault (DH-S-001)', category: 'CORE_KERNEL', mode: 'CODE_EXECUTED', purpose: 'Cryptographically sealed verified solution inventory' },
      { id: 'DN-30', name: 'Independent Oracle Attestor', category: 'AUDIT', mode: 'CODE_EXECUTED', purpose: 'External cryptographic witnesses and signature seals' },
      { id: 'DN-31', name: 'Sqlite Local Store Manager', category: 'PERSISTENCE', mode: 'CODE_EXECUTED', purpose: '27-table local multi-tenant relational persistence' },
      { id: 'DN-32', name: 'SQLite WAL and Full-Synchronous Durability Guard', category: 'PERSISTENCE', mode: 'CODE_EXECUTED', purpose: 'Verify disk-backed WAL journal and FULL synchronous commits' },
      { id: 'DN-33', name: 'Central Failure Diversion Router', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Captures and isolates tripped pipeline invariants' },
      { id: 'DN-34', name: 'Neon Postgres Adapter', category: 'ADAPTERS', mode: 'EXTERNAL_PROVIDER_REQUIRED', purpose: 'Serverless cloud PostgreSQL synchronization' },
      { id: 'DN-35', name: 'PayPal Enterprise Payment Gateway', category: 'PAYMENTS', mode: 'EXTERNAL_PROVIDER_REQUIRED', purpose: 'Server-authoritative fiat payment capture and escrow' },
      { id: 'DN-36', name: 'Fiat Settlement Policy Guard (Stripe Prohibited)', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Enforces strict prohibition of Stripe per Sovereign Core directive; fiat settlement routed exclusively to PayPal DN-35' },
      { id: 'DN-37', name: 'Coinbase Commerce Gateway', category: 'ADAPTERS', mode: 'CODE_EXECUTED', purpose: 'Crypto settlement gateway adapter' },
      { id: 'DN-38', name: 'Sovereign Settlement Escrow Program', category: 'SETTLEMENT', mode: 'CODE_EXECUTED', purpose: 'Native verifiable cryptographic escrow settlement state engine' },
      { id: 'DN-39', name: 'Ethereum EVM Escrow Bridge', category: 'ADAPTERS', mode: 'CODE_EXECUTED', purpose: 'Smart contract proof token settlement' },
      { id: 'DN-40', name: 'Lean4 Theorem Verification Bridge', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Type theory certificate verification adapter' },
      { id: 'DN-41', name: 'Isabelle/HOL Proof Ingestion Node', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Higher-order logic theorem ingestion' },
      { id: 'DN-42', name: 'Coq Gallina Specification Node', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Calculus of inductive constructions certifier' },
      { id: 'DN-43', name: 'Daisy Brain Autonomous Planner', category: 'CORE_KERNEL', mode: 'CODE_EXECUTED', purpose: 'Autonomous goal decomposition and heuristic synthesis' },
      { id: 'DN-44', name: 'Pigeonhole Collision SMT Verifier', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Mathematical proof of injective map impossibility' },
      { id: 'DN-45', name: 'Two Generals Consensus Barrier Node', category: 'LOGIC_SOLVER', mode: 'CODE_EXECUTED', purpose: 'Unreliable communication impossibility verification' },
      { id: 'DN-46', name: 'Chandy-Lamport Distributed Snapshot', category: 'PERSISTENCE', mode: 'CODE_EXECUTED', purpose: 'Consistent global cut state capture' },
      { id: 'DN-47', name: 'Raft Consensus State Machine', category: 'CORE_KERNEL', mode: 'CODE_EXECUTED', purpose: 'Quorum-based distributed log replication' },
      { id: 'DN-48', name: 'Lamport Vector Clock Sequencer', category: 'CORE_KERNEL', mode: 'CODE_EXECUTED', purpose: 'Causal order and happens-before relationship tracking' },
      { id: 'DN-49', name: 'License Generation & Proof Tokenizer', category: 'MARKETPLACE', mode: 'CODE_EXECUTED', purpose: 'Issues cryptographically signed solution access keys' },
      { id: 'DN-50', name: 'Telemetry & Metric Aggregator', category: 'AUDIT', mode: 'CODE_EXECUTED', purpose: 'Captures latency, resource utilization, and throughput' },
      { id: 'DN-51', name: 'Hardware Security Module (HSM) Proxy', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'FIPS 140-2 Level 3 root of trust attestation' },
      { id: 'DN-52', name: 'Ed25519 Cryptographic Signer', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'High-speed deterministic digital signatures' },
      { id: 'DN-53', name: 'Zero-Knowledge Range Proof Engine', category: 'SECURITY', mode: 'CODE_EXECUTED', purpose: 'Proves invariants without leaking proprietary parameters' },
      { id: 'DN-54', name: 'Sovereign API Gateway & Mesh Router', category: 'CORE_KERNEL', mode: 'CODE_EXECUTED', purpose: 'High-throughput authenticated RPC and REST multiplexer' }
    ];

    for (const r of rawNodes) {
      const node: NodeEntity = {
        id: r.id,
        node_id: r.id,
        name: r.name,
        category: r.category,
        execution_mode: r.mode,
        status: r.mode === 'EXTERNAL_PROVIDER_REQUIRED' ? 'EXTERNAL_PROVIDER_REQUIRED' : 'ACTIVE',
        purpose: r.purpose
      };
      this.nodes.set(r.id, node);
    }
  }

  public getAllNodes(): NodeEntity[] {
    return Array.from(this.nodes.values());
  }

  public getNode(id: string): NodeEntity | undefined {
    return this.nodes.get(id);
  }
}
