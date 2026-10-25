import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillCompletionPrefix, wrapSkillAutocomplete } from '../autocomplete.ts';
const options = { signal: new AbortController().signal };
const commands = ['tdd', 'implement', 'inspect'].map(name => ({ source: 'skill', name: 'skill:' + name }));
test('completion scope: first, inline, multiline, and mixed header', () => {
  for (const text of ['$', '$im', '$tdd $im', '$tdd\n$im', '$tdd $inspect\n$im']) {
    const lines = text.split('\n'), line = lines.length - 1;
    assert.equal(skillCompletionPrefix(lines, line, lines[line].length), text.endsWith('$') ? '$' : '$im');
  }
  for (const text of ['Task $im', '$tdd Task $im', '$tdd\n\n$im', '```\n$im', ' $im', '$tdd$im', '/skill:im']) {
    const lines = text.split('\n'), line = lines.length - 1;
    assert.equal(skillCompletionPrefix(lines, line, lines[line].length), null);
  }
});
test('slash skills are filtered, ordinary commands and method receivers preserved', async () => {
  const current = {
    triggerCharacters: ['@'],
    async getSuggestions() { assert.equal(this, current); return { prefix: '/', items: [{ value: '/help', label: '/help' }, { value: '/skill:tdd', label: '/skill:tdd' }] }; },
    applyCompletion() { assert.equal(this, current); return 'native'; },
    shouldTriggerFileCompletion() { assert.equal(this, current); return true; },
  };
  const provider = wrapSkillAutocomplete(current, () => commands);
  assert.deepEqual(provider.triggerCharacters, ['@', '$']);
  assert.deepEqual((await provider.getSuggestions(['/'], 0, 1, options)).items.map(x => x.value), ['/help']);
  const lines = ['$tdd $im'];
  const result = await provider.getSuggestions(lines, 0, 8, options);
  assert.deepEqual(result.items.map(x => x.value), ['$implement']);
  assert.deepEqual(provider.applyCompletion(lines, 0, 8, result.items[0], result.prefix), { lines: ['$tdd $implement'], cursorLine: 0, cursorCol: 15 });
  assert.equal(lines[0], '$tdd $im');
  assert.equal(provider.shouldTriggerFileCompletion(lines, 0, 8), true);
  assert.equal(provider.applyCompletion(['/h'], 0, 2, {}, '/h'), 'native');
  assert.equal(await provider.getSuggestions(lines, 0, 8, { signal: AbortSignal.abort() }), null);
});
