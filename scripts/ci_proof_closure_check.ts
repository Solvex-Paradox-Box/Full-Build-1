import fs from 'node:fs';
import path from 'node:path';

function fail(message: string): never {
  console.error('[CI-FAIL] ' + message);
  process.exit(1);
}

function readJson(name: string): any {
  const file = path.resolve('artifacts', name);
  if (!fs.existsSync(file)) fail('Required verification artifact missing: ' + name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fail('Verification artifact is not valid JSON: ' + name);
  }
}

const formal = readJson('formal-aggregation.json');
const summary = readJson('z3-120-formal-verification-summary.json');
const activation = readJson('daisy-brain-activation-gate.json');
const stage45 = readJson('stage-45-readiness.json');
const authoritative = readJson('execution-gates.json');

if (formal.total?.required !== 120) fail('Formal aggregate must require exactly 120 cases.');
if (formal.total?.actual_z3_executions !== 120) fail('Formal aggregate must record 120 actual Z3 executions.');
if (formal.total?.replays !== 120 || formal.total?.replay_matches !== 120) {
  fail('Formal aggregate must record 120 cleanroom replays and 120 replay matches.');
}
if (formal.total?.distribution?.unknown !== 0 || formal.total?.distribution?.error !== 0) {
  fail('Formal aggregate contains UNKNOWN or ERROR results.');
}
if (formal.total?.closure_verdict !== 'PROVEN_120_FORMAL_CLOSURE') {
  fail('Formal aggregate did not prove the 120-case corpus closure.');
}
if (formal.dfrl?.required !== 88 || formal.dfrl?.actual_z3_executions !== 88 ||
    formal.dfrl?.replay_matches !== 88 || formal.dfrl?.status !== 'VERIFIED') {
  fail('DFRL evidence does not satisfy the 88-case execution/replay contract.');
}
if (formal.dh?.required !== 32 || formal.dh?.actual_z3_executions !== 32 ||
    formal.dh?.replay_matches !== 32 || formal.dh?.status !== 'VERIFIED') {
  fail('DH evidence does not satisfy the 32-case execution/replay contract.');
}
if (summary.total_z3_executions !== 120 || summary.expected_result_matches !== 120 ||
    summary.cleanroom_replays !== 120 || summary.replay_matches !== 120 ||
    summary.distribution?.unknown !== 0 || summary.distribution?.error !== 0) {
  fail('Independent 120-case summary disagrees with the formal aggregate.');
}
if (activation.corpus?.total_required !== 120 || activation.corpus?.executed !== 120 ||
    activation.corpus?.deterministic_replays !== 120 || activation.corpus?.unknown !== 0 ||
    activation.corpus?.errors !== 0) {
  fail('Daisy activation artifact has incomplete or unsafe corpus accounting.');
}
if (activation.mandatory_gates?.total !== 45 || activation.mandatory_gates?.observed !== 45 ||
    stage45.total_checks !== 44 || !Array.isArray(stage45.gates) || stage45.gates.length !== 44 ||
    stage45.stage_45?.status !== 'PASSED' || stage45.deployment_authorized !== true ||
    new Set(stage45.gates.map((g: any) => g.gate_id)).size !== 44) {
  fail('The 44-check inventory or Stage 45 production-readiness decision is incomplete.');
}
const gate09 = authoritative.gates?.find((g: any) => g.gate_id === 'GATE-09');
if (gate09?.status !== 'PASSED' || (gate09.details?.unsatisfied_node_ids?.length ?? -1) !== 0) {
  fail('Fresh authoritative gate artifact must show all 54 nodes executed with no unsatisfied nodes.');
}
const gate12 = authoritative.gates?.find((g: any) => g.gate_id === 'GATE-12');
if (gate12?.status !== 'PASSED' ||
    gate12.details?.order_lifecycle?.final_status !== 'OFFER' ||
    gate12.details?.order_lifecycle?.transitions_executed?.length !== 0 ||
    gate12.details?.order_lifecycle?.authorization_blocked !== true ||
    gate12.details?.order_lifecycle?.payment_processing !== 'DISABLED') {
  fail('Lifecycle evidence must report blocked authorization and the unchanged OFFER state; it must not claim escrow funding or deployment.');
}
if (!['ACTIVE', 'BLOCKED'].includes(activation.status)) {
  fail('Daisy activation status is missing or unrecognized.');
}
if (activation.status === 'ACTIVE' &&
    (activation.mandatory_gates.non_passed !== 0 || activation.adversarial_verification?.passed !== true)) {
  fail('Activation claims ACTIVE without all gates and adversarial checks passing.');
}

console.log('PASS: 120-case formal evidence, replay counts, 44 pre-production checks, and Stage 45 readiness evidence are internally consistent.');
console.log('Daisy activation status: ' + activation.status);
if (activation.status === 'BLOCKED') {
  console.log('Production activation remains blocked; this CI check does not authorize production access or payments.');
}
