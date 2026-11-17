import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha256 = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');
import { AuthoritativeVerificationPipeline } from '../tests/authoritativeVerificationPipeline';

export interface GateExecutionResult {
  gate_number: number;
  gate_id: string;
  name: string;
  category: 'AUTHORITATIVE_PIPELINE' | 'ENTERPRISE_INVARIANT' | 'STAGE_45_DECISION';
  status: 'PASSED' | 'EXTERNAL_PROVIDER_REQUIRED' | 'BLOCKED' | 'FAIL';
  claim_scope: 'LOCAL' | 'MODEL' | 'SANDBOX' | 'PRODUCTION';
  duration_ms: number;
  evidence_hash: string;
  details: Record<string, any>;
}

export interface Stage45ReadinessReport {
  execution_id: string;
  timestamp: string;
  commit_sha: string;
  environment: 'local' | 'sandbox' | 'production';
  total_checks: 44;
  authoritative_checks_count: 15;
  enterprise_checks_count: 29;
  stage_45_count: 1;
  gates_passed: number;
  external_provider_required_count: number;
  blocked_count: number;
  failed_count: number;
  all_pre_production_passed: boolean;
  gates: GateExecutionResult[];
  stage_45: GateExecutionResult;
  overall_verdict: 'PRE_PRODUCTION_COMPLETE_AND_DEPLOYMENT_AUTHORIZED' | 'BLOCKED';
}

export class Stage45Readiness {
  private static instance: Stage45Readiness | null = null;

  public static getInstance(): Stage45Readiness {
    if (!Stage45Readiness.instance) {
      Stage45Readiness.instance = new Stage45Readiness();
    }
    return Stage45Readiness.instance;
  }

  public async evaluateStage45(): Promise<Stage45ReadinessReport> {
    const startedAt = Date.now();
    const executionId = `stage45_exec_${startedAt}`;
    const timestamp = new Date().toISOString();
    const evaluatedGates: GateExecutionResult[] = [];

    // -------------------------------------------------------------
    // PART 1: EVALUATE 15 AUTHORITATIVE PIPELINE GATES (GATES 01 - 15)
    // -------------------------------------------------------------
    const authPipeline = AuthoritativeVerificationPipeline.getInstance();
    const authReport = await authPipeline.runFullPipeline();

    for (let i = 0; i < authReport.gates.length; i++) {
      const g = authReport.gates[i];
      let gStatus: GateExecutionResult['status'] = 'PASSED';
      if (g.status === 'PASSED') gStatus = 'PASSED';
      else if (g.status === 'EXTERNAL_PROVIDER_REQUIRED') gStatus = 'EXTERNAL_PROVIDER_REQUIRED';
      else if (g.status === 'BLOCKED') gStatus = 'BLOCKED';
      else gStatus = 'FAIL';

      evaluatedGates.push({
        gate_number: i + 1,
        gate_id: g.gate_id,
        name: g.name,
        category: 'AUTHORITATIVE_PIPELINE',
        status: gStatus,
        claim_scope: g.claim_scope,
        duration_ms: g.duration_ms,
        evidence_hash: sha256(JSON.stringify({ gate_id: g.gate_id, status: g.status, duration_ms: g.duration_ms, claim_scope: g.claim_scope, commit_sha: authReport.commit_sha, execution_id: authReport.execution_id, environment: authReport.environment, details: g.details })),
        details: g.details
      });
    }

    // -------------------------------------------------------------
    // PART 2: EVALUATE 29 PRE-PRODUCTION ENTERPRISE INVARIANTS
    // -------------------------------------------------------------
    const enterpriseResults = authReport.enterprise_results;

    for (let i = 0; i < enterpriseResults.length; i++) {
      const inv = enterpriseResults[i];
      const gateNum = 15 + inv.test_number;
      const gateId = `INV-${String(inv.test_number).padStart(2, '0')}`;

      evaluatedGates.push({
        gate_number: gateNum,
        gate_id: gateId,
        name: inv.name,
        category: 'ENTERPRISE_INVARIANT',
        status: inv.passed ? 'PASSED' : 'FAIL',
        claim_scope: 'LOCAL',
        duration_ms: inv.duration_ms,
        evidence_hash: sha256(JSON.stringify({ gate_id: gateId, name: inv.name, passed: inv.passed, duration_ms: inv.duration_ms, commit_sha: authReport.commit_sha, execution_id: authReport.execution_id, environment: authReport.environment, details: inv.details })),
        details: inv.details
      });
    }

    // -------------------------------------------------------------
    // PART 3: EVALUATE STAGE 45 READINESS
    // -------------------------------------------------------------
    const failedPrior = evaluatedGates.filter(g => g.status === 'FAIL').length;
    const passedPrior = evaluatedGates.filter(g => g.status === 'PASSED').length;
    const nonPassedPrior = evaluatedGates.filter(g => g.status !== 'PASSED').length;
    const failClosedChecks = enterpriseResults.filter(inv => /fail.closed|unauthorized|unverified.*blocked/i.test(inv.name));
    const externalBoundaryChecks = enterpriseResults.filter(inv => /external adapter inventory|paypal dn-35 server.authoritative fail.closed/i.test(inv.name));
    const failClosedActive = failClosedChecks.length > 0 && failClosedChecks.every(inv => inv.passed);
    const externalBoundariesPreserved = externalBoundaryChecks.length > 0 && externalBoundaryChecks.every(inv => inv.passed);
    const structuralIntegrityOk = evaluatedGates.length === 44 && failClosedActive && externalBoundariesPreserved;
    const releaseArtifactPath = path.resolve(process.cwd(), 'dist/index.html');
    const releaseArtifactPresent = fs.existsSync(releaseArtifactPath);
    const releaseArtifactSha256 = releaseArtifactPresent ? createHash('sha256').update(fs.readFileSync(releaseArtifactPath)).digest('hex') : null;
    const deploymentTarget = (process.env.SOLVEX_DEPLOYMENT_TARGET ?? '').trim();
    const deploymentTargetValidated = deploymentTarget.length > 0 && process.env.SOLVEX_DEPLOYMENT_TARGET_VERIFIED === 'true';
    const stage45ReadinessChecksPassed = releaseArtifactPresent && deploymentTargetValidated;
    const masterPassed = structuralIntegrityOk && nonPassedPrior === 0 && failedPrior === 0 && stage45ReadinessChecksPassed;
    const masterBlocked = !masterPassed && structuralIntegrityOk && failedPrior === 0 && nonPassedPrior > 0;
    const masterStatus: GateExecutionResult['status'] = masterPassed
      ? 'PASSED'
      : masterBlocked ? 'BLOCKED' : 'FAIL';

    evaluatedGates.push({
      gate_number: 45,
      gate_id: 'STAGE-45',
      name: 'Final Pre-Production Production-Readiness Verification',
      category: 'STAGE_45_DECISION',
      status: masterStatus,
      claim_scope: 'LOCAL',
      duration_ms: Date.now() - startedAt,
      evidence_hash: sha256(JSON.stringify({ gate_id: 'STAGE-45', commit_sha: authReport.commit_sha, execution_id: authReport.execution_id, environment: authReport.environment, release_artifact_sha256: releaseArtifactSha256, deployment_target: deploymentTarget, deployment_target_validated: deploymentTargetValidated, evidence: evaluatedGates.map(g => ({ gate_id: g.gate_id, evidence_hash: g.evidence_hash, status: g.status })), master_passed: masterPassed, preceding_passed: passedPrior, preceding_failed: failedPrior, preceding_non_passed: nonPassedPrior, fail_closed_active: failClosedActive, external_boundaries_preserved: externalBoundariesPreserved })),
      details: {
        total_preceding_checks: 44,
        commit_sha: authReport.commit_sha,
        source_execution_id: authReport.execution_id,
        environment: authReport.environment,
        release_artifact_present: releaseArtifactPresent,
        release_artifact_path: releaseArtifactPresent ? 'dist/index.html' : null,
        release_artifact_sha256: releaseArtifactSha256,
        deployment_target: deploymentTarget || null,
        deployment_target_validated: deploymentTargetValidated,
        readiness_blockers: [
          ...(!releaseArtifactPresent ? ['Release artifact dist/index.html is missing.'] : []),
          ...(!deploymentTargetValidated ? ['Deployment target is not identified and explicitly verified.'] : [])
        ],
        preceding_passed: passedPrior,
        preceding_failed: failedPrior,
        preceding_non_passed: nonPassedPrior,
        external_boundaries_preserved: externalBoundariesPreserved,
        fail_closed_active: failClosedActive,
        structural_integrity_ok: structuralIntegrityOk,
        closure_state: masterPassed ? 'VERIFIED' : masterBlocked ? 'BLOCKED' : 'FAILED'
      }
    });

    const preProductionChecks = evaluatedGates.slice(0, 44);
    const stage45Result = evaluatedGates[44];
    const passedCount = preProductionChecks.filter(g => g.status === 'PASSED').length;
    const extCount = preProductionChecks.filter(g => g.status === 'EXTERNAL_PROVIDER_REQUIRED').length;
    const blockedCount = preProductionChecks.filter(g => g.status === 'BLOCKED').length;
    const failCount = preProductionChecks.filter(g => g.status === 'FAIL').length;

    return {
      execution_id: executionId,
      timestamp,
      commit_sha: authReport.commit_sha,
      environment: authReport.environment,
      total_checks: 44,
      authoritative_checks_count: 15,
      enterprise_checks_count: 29,
      stage_45_count: 1,
      gates_passed: passedCount,
      external_provider_required_count: extCount,
      blocked_count: blockedCount,
      failed_count: failCount,
      all_pre_production_passed: masterPassed,
      gates: preProductionChecks,
      stage_45: stage45Result,
      overall_verdict: masterPassed ? 'PRE_PRODUCTION_COMPLETE_AND_DEPLOYMENT_AUTHORIZED' : 'BLOCKED'
    };
  }
}
