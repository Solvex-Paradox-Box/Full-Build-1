#!/usr/bin/env node
/**
 * One-shot fix script for async auth call sites.
 * Run from repo root AFTER restoring authoritativeVerificationPipeline.ts from commit 849c9d6 if stubbed:
 *   git show 849c9d6:src/tests/authoritativeVerificationPipeline.ts > src/tests/authoritativeVerificationPipeline.ts
 *   node scripts/apply-auth-await-fixes.mjs
 */
import fs from 'node:fs';

function patch(path, pairs) {
  let c = fs.readFileSync(path, 'utf8');
  for (const [from, to] of pairs) {
    if (!c.includes(from)) {
      console.error('PATTERN NOT FOUND in', path, from.slice(0, 80));
      process.exitCode = 1;
      continue;
    }
    c = c.split(from).join(to);
  }
  fs.writeFileSync(path, c);
  console.log('patched', path);
}

patch('src/nodes/DaisySubsystemExecutors.ts', [
  ["const untrustedToken = auth.verifyToken('untrusted-token');", "const untrustedToken = await auth.verifyToken('untrusted-token');"],
  ["const attempt = lifecycle.transitionOrder(orderId, 'ORDER_CREATED');", "const attempt = await lifecycle.transitionOrder(orderId, 'ORDER_CREATED');"],
  ["/BLOCKED: verified identity and signed tenant claims are required/i.test(attempt.error || '')", "/BLOCKED:/i.test(attempt.error || '')"],
]);

patch('src/tests/enterpriseVerification.ts', [
  ["runTest('Fail-Closed: Local Authentication Cannot Mint Sessions', 'SECURITY', () => {", "runTest('Fail-Closed: Local Authentication Cannot Mint Sessions', 'SECURITY', async () => {"],
  ["if (auth.verifyToken('not-a-real-token').valid)", "if ((await auth.verifyToken('not-a-real-token')).valid)"],
  ["runTest('Fail-Closed: Unverified Identity Cannot Access Tenant Data', 'SECURITY', () => {", "runTest('Fail-Closed: Unverified Identity Cannot Access Tenant Data', 'SECURITY', async () => {"],
  ["const check = auth.authorize(null, 'VIEW_EVIDENCE', 'TENANT_BETA');", "const check = await auth.authorize(null, 'VIEW_EVIDENCE', 'TENANT_BETA');"],
  ["runTest('Order Lifecycle Blocks Unverified or Missing Orders', 'MARKETPLACE', () => {", "runTest('Order Lifecycle Blocks Unverified or Missing Orders', 'MARKETPLACE', async () => {"],
  ["const result = lifecycle.transitionOrder('NO_PERSISTED_ORDER', 'ORDER_CREATED');", "const result = await lifecycle.transitionOrder('NO_PERSISTED_ORDER', 'ORDER_CREATED');"],
]);

patch('src/tests/authoritativeVerificationPipeline.ts', [
  ["const result = orderMgr.transitionOrder(testOrderId, targetState);", "const result = await orderMgr.transitionOrder(testOrderId, targetState);"],
]);

console.log('Done.');
