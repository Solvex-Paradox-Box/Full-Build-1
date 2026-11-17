/**
 * Canonical SolveX verification gate catalog.
 *
 * This catalog defines the 45-stage release sequence, a separate
 * post-production operational check, and 21 SolutionPipeline stages.
 * Definitions are not execution evidence: runtime results must be produced
 * by real handlers and recorded separately.
 */
export type VerificationGateLayer = 'SYSTEM' | 'POST_PRODUCTION' | 'PIPELINE';
export interface VerificationGateDefinition {
  readonly id: string;
  readonly name: string;
  readonly layer: VerificationGateLayer;
  readonly relatedSystemGateIds?: readonly string[];
}
const SYSTEM_GATES: readonly VerificationGateDefinition[] = [
  {
    "id": "GATE-00",
    "name": "Repository Integrity & Baseline Provenance",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-01",
    "name": "Dependency Preflight Layer",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-02",
    "name": "Secret & Configuration Preflight",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-03",
    "name": "Execution Environment Selection",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-04",
    "name": "Build & TypeScript Static Verification",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-05",
    "name": "Unit & Enterprise Invariant Test Suite",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-06",
    "name": "DFRL 88-Operator Z3 SMT Formal Verification",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-07",
    "name": "Cleanroom Deterministic Replay Verification",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-08",
    "name": "SMT Mutation, SHA-256 Tamper & Fail-Closed Tests",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-09",
    "name": "Daisy 54-Node Architecture CUJ Execution Coverage",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-10",
    "name": "Multi-Tenant Relational & Merkle Chain Persistence",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-11",
    "name": "External Provider Gateways (Neon, PayPal)",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-12",
    "name": "End-to-End Lifecycle Execution",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-13",
    "name": "Evidence Generation & Artifact Packaging",
    "layer": "SYSTEM"
  },
  {
    "id": "GATE-14",
    "name": "Final Truth-Boundary Audit & Production Gate",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-01",
    "name": "Authentication & RBAC Evaluation",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-02",
    "name": "MMTAI Single-Use Token Replay Prevention",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-03",
    "name": "Multi-Tenant Cryptographic Partition Isolation",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-04",
    "name": "Audit Chain Cryptographic Hash Continuity",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-05",
    "name": "Anti-Tamper Sentinel Active Tamper Detection",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-06",
    "name": "Atomic State Checkpoint & Reversibility Engine",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-07",
    "name": "Irreversible Action Rollback Rejection Guard",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-08",
    "name": "Paradox Registry Integrity (Exact 32 Bootstrap Set)",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-09",
    "name": "Paradox Duplicate & Family Variant Taxonomy",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-10",
    "name": "NOPOT Bounded Termination Formal Proof Verification",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-11",
    "name": "Preserved Solution DH-S-001 Verification Integrity",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-12",
    "name": "Proof Bundle Builder Seal & Independent Oracle Attestation",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-13",
    "name": "Cleanroom Replay Bitrot & Divergence Detection",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-14",
    "name": "21-Stage Problem Resolution Pipeline Full Traversal",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-15",
    "name": "Pipeline Fail-Closed Gate Halts and Quarantines on Error",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-16",
    "name": "Defensible Pricing Formula v1.4 Deterministic Execution",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-17",
    "name": "Marketplace Blocks Publication of Unverified Solutions",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-18",
    "name": "PayPal DN-35 Server-Authoritative Fail-Closed Enforcement",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-19",
    "name": "External Adapter Inventory Transparency (Neon, PayPal)",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-20",
    "name": "Crystal Clear Box Redaction Uses Persisted Evidence Only",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-21",
    "name": "Daisy Node Registry (54 Distinct Nodes)",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-22",
    "name": "System Status Projection Computes Real State",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-23",
    "name": "SqliteStore Multi-Tenant Persistence & 27 Tables Integrity",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-24",
    "name": "Fail-Closed: CLAIM_ONLY / UNVERIFIED Offer Publication Blocked",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-25",
    "name": "Fail-Closed: UNKNOWN / UNVERIFIED Order Creation Blocked",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-26",
    "name": "Fail-Closed: Local Authentication Cannot Mint Sessions",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-27",
    "name": "Fail-Closed: Unverified Identity Cannot Access Tenant Data",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-28",
    "name": "Fail-Closed: Missing PayPal Credentials Evaluated",
    "layer": "SYSTEM"
  },
  {
    "id": "INV-29",
    "name": "Order Lifecycle Blocks Unverified or Missing Orders",
    "layer": "SYSTEM"
  },
  {
    "id": "STAGE-45",
    "name": "Final Pre-Production Production-Readiness Verification",
    "layer": "SYSTEM"
  }
] as const;
const POST_PRODUCTION_GATES: readonly VerificationGateDefinition[] = [
  {
    "id": "INV-30",
    "name": "Central Failure Diversion Preserves Evidence & Executes Rollback",
    "layer": "POST_PRODUCTION"
  },
  {
    "id": "PIPE-14",
    "name": "Multi-Model Independent Oracle Attestation",
    "layer": "POST_PRODUCTION",
    "relatedSystemGateIds": [
      "INV-12"
    ]
  }
] as const;
const PIPELINE_GATES: readonly VerificationGateDefinition[] = [
  {
    "id": "PIPE-01",
    "name": "Ingestion & Syntax AST Normalization",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-00",
      "GATE-04"
    ]
  },
  {
    "id": "PIPE-02",
    "name": "Paradox Domain & Claim Classification",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-08",
      "INV-09"
    ]
  },
  {
    "id": "PIPE-03",
    "name": "Invariant Specification Extraction",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-06"
    ]
  },
  {
    "id": "PIPE-04",
    "name": "Structural Contraction & Self-Reference Guard",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-06"
    ]
  },
  {
    "id": "PIPE-05",
    "name": "Boundary & Singularity Mapping",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-10"
    ]
  },
  {
    "id": "PIPE-06",
    "name": "Cleanroom Sandbox Isolation Setup",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-03",
      "GATE-09"
    ]
  },
  {
    "id": "PIPE-07",
    "name": "Static Typing & Semantic Soundness Gate",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-04"
    ]
  },
  {
    "id": "PIPE-08",
    "name": "Memory Safety & Allocation Leak Boundary",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-05",
      "INV-23"
    ]
  },
  {
    "id": "PIPE-09",
    "name": "Non-Termination & Divergence Sentinel",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-10"
    ]
  },
  {
    "id": "PIPE-10",
    "name": "Well-Founded Inductive Ranking Inspection",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-06"
    ]
  },
  {
    "id": "PIPE-11",
    "name": "Z3 SMT Formal Theorem Verification",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-06"
    ]
  },
  {
    "id": "PIPE-12",
    "name": "Machine-Checked Proof Certificate Generation",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-12"
    ]
  },
  {
    "id": "PIPE-13",
    "name": "Deterministic Cleanroom Test Suite Execution",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-05",
      "GATE-07"
    ]
  },
  {
    "id": "PIPE-15",
    "name": "Bitrot & Replay Divergence Validation",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-07",
      "INV-13"
    ]
  },
  {
    "id": "PIPE-16",
    "name": "Defensible Pricing Formula v1.4 Execution",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-16"
    ]
  },
  {
    "id": "PIPE-17",
    "name": "Redacted Customer Evidence Generation",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "GATE-13",
      "INV-20"
    ]
  },
  {
    "id": "PIPE-18",
    "name": "Cryptographic SHA-256 Merkle Ledger Append",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-04"
    ]
  },
  {
    "id": "PIPE-19",
    "name": "Multi-Tenant Partition Key Verification",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-03"
    ]
  },
  {
    "id": "PIPE-20",
    "name": "Atomic Checkpoint & Reversibility Guarantee",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-06"
    ]
  },
  {
    "id": "PIPE-21",
    "name": "Sovereign Marketplace Offer Sealing",
    "layer": "PIPELINE",
    "relatedSystemGateIds": [
      "INV-17",
      "INV-24"
    ]
  }
] as const;
export const SYSTEM_GATE_COUNT = 45;
export const POST_PRODUCTION_GATE_COUNT = 2;
export const PIPELINE_STAGE_GATE_COUNT = 20;
export const TOTAL_VERIFICATION_GATE_COUNT = SYSTEM_GATE_COUNT + POST_PRODUCTION_GATE_COUNT + PIPELINE_STAGE_GATE_COUNT;
export const SOLVEX_VERIFICATION_GATES: readonly VerificationGateDefinition[] = [
  ...SYSTEM_GATES,
  ...POST_PRODUCTION_GATES,
  ...PIPELINE_GATES
];
export function validateVerificationGateCatalog(): { valid: boolean; total: number; system: number; postProduction: number; pipeline: number; duplicateIds: string[]; unresolvedReferences: string[] } {
  const ids = SOLVEX_VERIFICATION_GATES.map(g => g.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const known = new Set(ids);
  const unresolvedReferences = PIPELINE_GATES.flatMap(g =>
    (g.relatedSystemGateIds ?? []).filter(id => !known.has(id)).map(id => `${g.id}->${id}`)
  );
  return {
    valid: SYSTEM_GATES.length === SYSTEM_GATE_COUNT &&
      PIPELINE_GATES.length === PIPELINE_STAGE_GATE_COUNT &&
      SOLVEX_VERIFICATION_GATES.length === TOTAL_VERIFICATION_GATE_COUNT &&
      duplicateIds.length === 0 && unresolvedReferences.length === 0,
    total: SOLVEX_VERIFICATION_GATES.length,
    system: SYSTEM_GATES.length,
    postProduction: POST_PRODUCTION_GATES.length,
    pipeline: PIPELINE_GATES.length,
    duplicateIds,
    unresolvedReferences
  };
}
