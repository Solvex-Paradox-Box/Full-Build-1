import assert from 'node:assert/strict';
import { LocalInferenceRuntime } from '../src/inference/LocalInferenceRuntime';

async function main() {
  const runtime = new LocalInferenceRuntime({
    modelPath: null,
    enginePath: null,
    modelId: null,
    modelVersion: null,
  });

  const info = await runtime.probe();
  assert.equal(info.ready, false, 'Missing model/engine must never report ready.');
  assert.equal(info.offlineCapable, false, 'The runtime must not attest offline capability without enforced network isolation.');

  const directoriesAreNotAssets = new LocalInferenceRuntime({
    modelPath: process.cwd(),
    enginePath: process.cwd(),
    modelId: null,
    modelVersion: null,
  });
  const directoryProbe = await directoriesAreNotAssets.probe();
  assert.equal(directoryProbe.ready, false, 'Directories must not be accepted as model weights or an executable engine.');

  const unavailable = await runtime.generate({
    messages: [{ role: 'user', content: 'A real inference request' }],
  });
  assert.equal(unavailable.status, 'MODEL_UNAVAILABLE');
  assert.equal(unavailable.code, 'FIRST_PARTY_MODEL_UNAVAILABLE');
  assert.equal(unavailable.text, undefined, 'Missing model must not return fabricated output.');

  const malformed = await runtime.generate({
    messages: [{ role: 'invalid-role' as 'user', content: 'bad role' }],
  });
  assert.equal(malformed.status, 'MALFORMED_INPUT');
  assert.equal(malformed.code, 'MALFORMED_INPUT');
  assert.equal(malformed.text, undefined, 'Malformed input must not return output.');

  const oversized = await runtime.generate({
    messages: [{ role: 'user', content: 'x'.repeat(20_001) }],
  });
  assert.equal(oversized.status, 'MALFORMED_INPUT');
  assert.equal(oversized.text, undefined);

  const invalidTimeout = await runtime.generate({
    messages: [{ role: 'user', content: 'A request with an invalid timeout' }],
    timeoutMs: 0,
  });
  assert.equal(invalidTimeout.status, 'MALFORMED_INPUT');
  assert.equal(invalidTimeout.code, 'MALFORMED_INPUT');
  assert.equal(invalidTimeout.text, undefined);

  console.log('PASS: local inference fails closed for missing assets, malformed roles, oversized messages, and invalid timeouts.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
