import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

test('standalone package loads through the local Pi extension loader', async () => {
  const hostEntry = import.meta.resolve('@earendil-works/pi-coding-agent');
  const { loadExtensions } = await import(new URL('./core/extensions/loader.js', hostEntry));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await loadExtensions([fileURLToPath(new URL('../index.ts', import.meta.url))], root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.equal(result.extensions[0].handlers.get('input').length, 1);
  assert.equal(result.extensions[0].handlers.get('session_start').length, 1);
  assert.equal(result.extensions[0].handlers.get('session_shutdown'), undefined);
});
