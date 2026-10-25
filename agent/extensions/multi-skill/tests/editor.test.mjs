import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapSkillAutocomplete } from '../autocomplete.ts';
const tick = () => new Promise(resolve => setTimeout(resolve, 50));

test('real unmodified CustomEditor: $ menu, inline/multiline Tab, slash filtering, task boundaries', async () => {
  const { CustomEditor } = await import(process.env.PI_HOST_MODULE ?? import.meta.resolve('@earendil-works/pi-coding-agent'));
  const theme = { borderColor: x => x, selectList: { selectedPrefix: x => x, selectedText: x => x, description: x => x, scrollInfo: x => x, noMatch: x => x } };
  const make = () => {
    const editor = new CustomEditor({ requestRender() {} }, theme, { matches: () => false });
    editor.setAutocompleteProvider(wrapSkillAutocomplete({
      async getSuggestions() { return { prefix: '/', items: [{ value: '/help', label: '/help' }, { value: '/skill:tdd', label: '/skill:tdd' }] }; },
      applyCompletion() { throw Error('unexpected native completion'); },
    }, () => ['tdd', 'implement', 'inspect'].map(name => ({ source: 'skill', name: 'skill:' + name }))));
    return editor;
  };
  for (const prefix of ['', '$tdd ', '$tdd\n', '$tdd $inspect\n']) {
    const editor = make();
    editor.setText(prefix);
    editor.handleInput('$'); await tick();
    assert.equal(editor.isShowingAutocomplete(), true, JSON.stringify(prefix));
    editor.handleInput('i'); editor.handleInput('m'); await tick();
    assert.equal(editor.isShowingAutocomplete(), true);
    editor.handleInput('\t'); await tick();
    assert.equal(editor.getText(), prefix + '$implement');
  }
  const editor = make();
  editor.handleInput('/'); await tick();
  assert.equal(editor.isShowingAutocomplete(), true);
  // Actual menu items, test-only inspection of the real editor's internal list.
  assert.deepEqual(editor.autocompleteList.items.map(item => item.value), ['/help']);
});
