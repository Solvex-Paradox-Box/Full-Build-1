import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const registryPath = 'src/nodes/NodeRegistry.ts';
const executorsPath = 'src/nodes/DaisySubsystemExecutors.ts';
const registrySource = readFileSync(registryPath, 'utf8');
const executorSource = readFileSync(executorsPath, 'utf8');

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const registryStart = registrySource.indexOf('const rawNodes');
const registryEnd = registrySource.indexOf('for (const r of rawNodes)', registryStart);
if (registryStart < 0 || registryEnd < 0) {
  fail('Could not isolate the canonical rawNodes registry declaration.');
  process.exit(1);
}
const registryBlock = registrySource.slice(registryStart, registryEnd);
const registryEntries = [...registryBlock.matchAll(/\{\s*id:\s*'((?:DN)-\d+)'\s*,\s*name:\s*'([^']+)'\s*,\s*category:\s*'([A-Z_]+)'\s*,\s*mode:\s*'([A-Z_]+)'/g)]
  .map(([, id, name, category, mode]) => ({ id, name, category, mode }));

const expected = Array.from({ length: 54 }, (_, i) => `DN-${String(i + 1).padStart(2, '0')}`);
const ids = registryEntries.map(node => node.id);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
const missingIds = expected.filter(id => !ids.includes(id));
const unexpectedIds = ids.filter(id => !expected.includes(id));

if (ids.length !== 54) fail(`Registry declares ${ids.length} entries; expected exactly 54.`);
if (duplicateIds.length) fail(`Duplicate registry IDs: ${duplicateIds.join(', ')}`);
if (missingIds.length) fail(`Missing registry IDs: ${missingIds.join(', ')}`);
if (unexpectedIds.length) fail(`Unexpected registry IDs: ${unexpectedIds.join(', ')}`);

const executorCases = [...executorSource.matchAll(/case\s+'(DN-\d+)'\s*:\s*\{/g)].map(match => match[1]);
const duplicateCases = [...new Set(executorCases.filter((id, index) => executorCases.indexOf(id) !== index))];
const missingCases = expected.filter(id => !executorCases.includes(id));
const unexpectedCases = executorCases.filter(id => !expected.includes(id));
if (executorCases.length !== 54) fail(`Executor has ${executorCases.length} explicit node cases; expected 54.`);
if (duplicateCases.length) fail(`Duplicate executor cases: ${duplicateCases.join(', ')}`);
if (missingCases.length) fail(`Missing executor cases: ${missingCases.join(', ')}`);
if (unexpectedCases.length) fail(`Unexpected executor cases: ${unexpectedCases.join(', ')}`);

const categoryMismatch = [];
for (const match of executorSource.matchAll(/case\s+'(DN-\d+)'\s*:\s*\{([\s\S]*?)(?=\n\s*case\s+'DN-\d+'\s*:|\n\s*default\s*:)/g)) {
  const id = match[1];
  const category = match[2].match(/category:\s*'([A-Z_]+)'/)?.[1];
  const registered = registryEntries.find(node => node.id === id);
  if (registered && category !== registered.category) {
    categoryMismatch.push(`${id}: registry=${registered.category}, executor=${category ?? 'MISSING'}`);
  }
}
if (categoryMismatch.length) fail(`Category mismatches: ${categoryMismatch.join('; ')}`);

const gateways = registryEntries.filter(node => node.mode === 'EXTERNAL_PROVIDER_REQUIRED').map(node => node.id).sort();
const expectedGateways = ['DN-34', 'DN-35'];
if (JSON.stringify(gateways) !== JSON.stringify(expectedGateways)) {
  fail(`External gateway classification is [${gateways.join(', ')}], expected [DN-34, DN-35].`);
}
const baselineIds = expected.slice(0, 18);
const baseline = registryEntries.filter(node => baselineIds.includes(node.id));
const expanded = registryEntries.filter(node => !baselineIds.includes(node.id) && !gateways.includes(node.id));
if (baseline.length !== 18 || expanded.length !== 34 || gateways.length !== 2) {
  fail(`Classification totals are baseline=${baseline.length}, expanded=${expanded.length}, gateways=${gateways.length}; expected 18/34/2.`);
}
if (!expanded.some(node => node.id === 'DN-36')) {
  fail('DN-36 policy interlock must be included within the 34 expanded internal nodes, not counted as an additional node.');
}

if (process.exitCode) process.exit(1);
console.log('[PASS] 54 unique registry IDs: DN-01 through DN-54.');
console.log('[PASS] 54 unique explicit executor cases; every registry ID has exactly one case.');
console.log('[PASS] Executor categories match registry categories.');
console.log('[PASS] Classification: 18 baseline internal + 34 expanded internal + 2 external gateways = 54.');
console.log('[PASS] DN-36 policy interlock is included in expanded internal count.');
console.log('[SCOPE] Static registry-to-handler structure only. No subsystem execution, provider authentication, payment, or production behavior is claimed.');
console.log(`[SHA256] ${registryPath}: ${sha256(registrySource)}`);
console.log(`[SHA256] ${executorsPath}: ${sha256(executorSource)}`);
