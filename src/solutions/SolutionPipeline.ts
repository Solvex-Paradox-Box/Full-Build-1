import * as ts from 'typescript';
import { DurableStore } from '../database/DurableStore';

export type PipelineStageStatus = 'PASSED' | 'FAILED' | 'BLOCKED';

export interface PipelineStageTrace {
  stage: number;
  name: string;
  status: PipelineStageStatus;
  duration_ms: number;
  evidence?: Record<string, unknown>;
  reason?: string;
}

export interface PipelineExecutionResult {
  overall_success: boolean;
  completed_stages: number;
  total_stages: number;
  paradox_code: string;
  stage_traces: PipelineStageTrace[];
  rejection_reason?: string;
  solution_id?: string;
}

export class SolutionPipeline {
  private static instance: SolutionPipeline | null = null;
  private readonly stages = [
    'Stage 1: Ingestion & Syntax AST Normalization',
    'Stage 2: Paradox Domain & Claim Classification',
    'Stage 3: Invariant Specification Extraction',
    'Stage 4: Structural Contraction & Self-Reference Guard',
    'Stage 5: Boundary & Singularity Mapping',
    'Stage 6: Cleanroom Sandbox Isolation Setup',
    'Stage 7: Static Typing & Semantic Soundness Gate',
    'Stage 8: Memory Safety & Allocation Leak Boundary',
    'Stage 9: Non-Termination & Divergence Sentinel',
    'Stage 10: Well-Founded Inductive Ranking Inspection',
    'Stage 11: Z3 SMT Formal Theorem Verification',
    'Stage 12: Machine-Checked Proof Certificate Generation',
    'Stage 13: Deterministic Cleanroom Test Suite Execution',
    'Stage 14: Multi-Model Independent Oracle Attestation',
    'Stage 15: Bitrot & Replay Divergence Validation',
    'Stage 16: Defensible Pricing Formula v1.4 Execution',
    'Stage 17: Redacted Customer Evidence Generation',
    'Stage 18: Cryptographic SHA-256 Merkle Ledger Append',
    'Stage 19: Multi-Tenant Partition Key Verification',
    'Stage 20: Atomic Checkpoint & Reversibility Guarantee',
    'Stage 21: Sovereign Marketplace Offer Sealing'
  ];

  private constructor() {}

  public static getInstance(): SolutionPipeline {
    if (!SolutionPipeline.instance) SolutionPipeline.instance = new SolutionPipeline();
    return SolutionPipeline.instance;
  }

  /**
   * Runs only checks backed by real local inputs and implementations.
   * A missing sandbox, verifier, oracle, authorization, or provider is a
   * BLOCKED result—not a simulated pass. This method is deliberately read-only.
   */
  public async runPipeline(paradoxCode: string, codeSolution: string): Promise<PipelineExecutionResult> {
    const traces: PipelineStageTrace[] = [];
    const started = () => performance.now();
    const record = (
      stage: number,
      status: PipelineStageStatus,
      start: number,
      evidence: Record<string, unknown> = {},
      reason?: string
    ) => traces.push({
      stage,
      name: this.stages[stage - 1],
      status,
      duration_ms: Number((performance.now() - start).toFixed(2)),
      evidence,
      ...(reason ? { reason } : {})
    });
    const finish = (reason: string, solutionId?: string): PipelineExecutionResult => ({
      overall_success: false,
      completed_stages: traces.filter(t => t.status === 'PASSED').length,
      total_stages: this.stages.length,
      paradox_code: paradoxCode,
      stage_traces: traces,
      rejection_reason: reason,
      ...(solutionId ? { solution_id: solutionId } : {})
    });
    const block = (stage: number, reason: string, evidence: Record<string, unknown> = {}) => {
      const start = started();
      record(stage, 'BLOCKED', start, evidence, reason);
      return finish(`BLOCKED at stage ${stage}: ${reason}`);
    };
    const fail = (stage: number, reason: string, evidence: Record<string, unknown> = {}) => {
      const start = started();
      record(stage, 'FAILED', start, evidence, reason);
      return finish(`FAILED at stage ${stage}: ${reason}`);
    };

    // Stage 1 — reject empty input and parse the supplied source as TypeScript.
    let start = started();
    if (!paradoxCode.trim() || !codeSolution.trim()) {
      record(1, 'FAILED', start, {}, 'Problem identifier and implementation source are required.');
      return finish('FAILED at stage 1: Problem identifier and implementation source are required.');
    }
    const sourceFile = ts.createSourceFile(
      'solution-under-verification.ts',
      codeSolution,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (parseDiagnostics.length > 0) {
      const first = parseDiagnostics[0];
      const message = ts.flattenDiagnosticMessageText(first.messageText, '\n');
      record(1, 'FAILED', start, { syntax_diagnostics: parseDiagnostics.length }, message);
      return finish(`FAILED at stage 1: TypeScript syntax error: ${message}`);
    }
    record(1, 'PASSED', start, {
      source_sha256: this.sha256(codeSolution),
      source_bytes: new TextEncoder().encode(codeSolution).length,
      syntax_diagnostics: 0
    });

    // Stage 2 — classify only against a real, persisted problem record.
    start = started();
    const problem = DurableStore.getInstance().getState().problems[paradoxCode];
    if (!problem) {
      record(2, 'BLOCKED', start, { problem_id: paradoxCode }, 'No persisted problem record exists for this identifier.');
      return finish(`BLOCKED at stage 2: No persisted problem record exists for [${paradoxCode}].`);
    }
    record(2, 'PASSED', start, {
      problem_id: problem.id,
      tenant_id: problem.tenant_id,
      domain: problem.domain,
      problem_status: problem.status
    });

    // Stage 3 — invariants must come from the persisted problem specification.
    start = started();
    const invariants = Array.isArray(problem.invariants)
      ? problem.invariants.map(value => String(value).trim()).filter(Boolean)
      : [];
    if (invariants.length === 0) {
      record(3, 'BLOCKED', start, { problem_id: problem.id }, 'The persisted problem has no explicit invariants.');
      return finish(`BLOCKED at stage 3: Problem [${problem.id}] has no explicit invariants.`);
    }
    record(3, 'PASSED', start, { invariant_count: invariants.length, invariants_sha256: this.sha256(JSON.stringify(invariants)) });

    // Stage 4 — inspect actual AST call sites for direct self-recursion.
    start = started();
    const functionNames = new Set<string>();
    const recursiveCalls: string[] = [];
    const collectNames = (node: ts.Node): void => {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        functionNames.add(node.name.text);
      }
      ts.forEachChild(node, collectNames);
    };
    collectNames(sourceFile);
    const inspectCalls = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && functionNames.has(node.expression.text)) {
        const enclosing = this.enclosingFunctionName(node);
        if (enclosing && enclosing === node.expression.text) recursiveCalls.push(enclosing);
      }
      ts.forEachChild(node, inspectCalls);
    };
    inspectCalls(sourceFile);
    if (recursiveCalls.length > 0 && !invariants.some(value => /termination|ranking|recursion|well-founded/i.test(value))) {
      record(4, 'BLOCKED', start, { recursive_functions: [...new Set(recursiveCalls)] }, 'Direct recursion is present but the problem specification contains no termination/ranking invariant.');
      return finish('BLOCKED at stage 4: Direct recursion has no declared termination/ranking invariant.');
    }
    record(4, 'PASSED', start, { direct_recursive_calls: recursiveCalls.length });

    // Stage 5 — require explicit boundary conditions in the problem specification.
    start = started();
    const boundaryInvariants = invariants.filter(value => /boundary|limit|edge|zero|maximum|minimum|overflow|underflow/i.test(value));
    if (boundaryInvariants.length === 0) {
      record(5, 'BLOCKED', start, { invariant_count: invariants.length }, 'No explicit boundary/limit invariant was found; boundary behavior cannot be inferred from source text.');
      return finish('BLOCKED at stage 5: Explicit boundary/limit invariants are required.');
    }
    record(5, 'PASSED', start, { boundary_invariant_count: boundaryInvariants.length });

    // Stage 6 onward require isolated execution and verifiers that are not
    // exposed as safe, injectable interfaces in this repository snapshot.
    return block(6,
      'No isolated cleanroom execution adapter is configured. Node vm is not treated as a security sandbox, and source text is never executed in-process.',
      { source_sha256: this.sha256(codeSolution), execution_performed: false }
    );
  }

  private enclosingFunctionName(node: ts.Node): string | undefined {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
          current.name && ts.isIdentifier(current.name)) return current.name.text;
      current = current.parent;
    }
    return undefined;
  }

  private sha256(value: string): string {
    // The shared database utility keeps hashing identical across runtime targets.
    return this.computeHash(value);
  }

  private computeHash(value: string): string {
    // Imported lazily through the stable module binding below.
    return sha256Fallback(value);
  }
}

import { computeSha256 as sha256Fallback } from '../database/DatabaseSchema';
