import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(process.cwd(), 'config/verification/phase-wiring.json');
const plan = JSON.parse(readFileSync(path, 'utf8'));
const pre = plan.pre_production;
const stage45 = plan.stage_45;
const post = plan.post_production.checks;
const allPre = [...pre.system_gate_ids, ...pre.enterprise_invariant_ids];
const postIds = post.map((check: { id: string }) => check.id);
const errors: string[] = [];

if (allPre.length !== 44 || pre.expected_total !== 44) errors.push('Pre-production must contain exactly 44 checks.');
if (new Set(allPre).size !== 44) errors.push('Pre-production check IDs must be unique.');
if (stage45.id !== 'STAGE-45' || stage45.depends_on !== 'ALL_PRE_PRODUCTION_CHECKS') errors.push('Stage 45 must depend on the complete pre-production set.');
if (!postIds.includes('INV-30')) errors.push('INV-30 failure diversion must be post-production.');
if (!postIds.includes('PIPE-14')) errors.push('PIPE-14 independent model oracle attestation must be post-production.');
for (const id of ['GATE-11-PRODUCTION','GATE-12-PRODUCTION','GATE-14-PRODUCTION']) if (!postIds.includes(id)) errors.push(id + ' live-production portion must be post-production.');
if (postIds.some((id: string) => allPre.includes(id))) errors.push('A post-production check is duplicated in the pre-production set.');
if (stage45.must_not_depend_on.some((item: string) => /post-deployment|production failure|rollback|independent model oracle/i.test(item)) === false) errors.push('Stage 45 must explicitly exclude post-production dependencies.');

if (errors.length) {
  console.error('SolveX phase-wiring verification FAILED');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}
console.log('SolveX phase-wiring verification PASSED');
console.log('Pre-production checks: ' + allPre.length + '/44');
console.log('Stage 45: ' + stage45.id + ' — ' + stage45.name);
console.log('Post-production checks: ' + post.length + ' (includes PIPE-14 oracle and INV-30 failure diversion)');
console.log('Post-production: separate operational evidence; no additional numbered stage.');
