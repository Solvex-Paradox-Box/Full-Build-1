import assert from 'node:assert/strict';
import { Z3FormalProofEngine } from '../src/proofs/Z3FormalProofEngine';
import { ProofBundleBuilder } from '../src/proofs/ProofBundle';

const engine = Z3FormalProofEngine.getInstance();
const receipt = await engine.proveCatalogTheorem('THM-INDUCTIVE-TERMINATION-05');

assert.equal(receipt.solver_result, 'unsat');
assert.equal(receipt.proved, true);
assert.equal(engine.isAuthenticResult(receipt), true);
assert.equal(Object.isFrozen(receipt), true);

const validBundle = new ProofBundleBuilder('PB-Z3-RECEIPT-TEST', 'SUB-Z3-TEST', 'Z3 receipt integrity');
validBundle
  .addTest('Z3-TEST', 'Actual Z3 execution completed', true, receipt.execution_time_ms)
  .addZ3Proof(receipt)
  .addOracle('ORACLE-CLAIM-ONLY', 'Unsigned witness', 'CALLER_METADATA', true)
  .addReplay('REPLAY-Z3', receipt.certificate_sha256, receipt.certificate_sha256);
const validResult = validBundle.seal();
assert.equal(validResult.formal_proofs[0]?.checked, true);
assert.equal(validResult.verification_status, 'PARTIAL');

const alteredReceipt = { ...receipt, claim: 'altered after solver execution' };
assert.equal(engine.isAuthenticResult(alteredReceipt), false);
const forgedBundle = new ProofBundleBuilder('PB-Z3-FORGED-TEST', 'SUB-Z3-FORGED', 'Forged receipt rejection');
forgedBundle.addZ3Proof(alteredReceipt as any);
const forgedResult = forgedBundle.seal();
assert.equal(forgedResult.formal_proofs[0]?.checked, false);
assert.notEqual(forgedResult.verification_status, 'VERIFIED');

console.log('[PASS] Actual Z3 receipt accepted only while unchanged and issued by the active engine.');
console.log('[PASS] Unsigned oracle metadata keeps otherwise complete bundle PARTIAL.');
console.log('[PASS] Reconstructed or altered receipt is rejected.');
