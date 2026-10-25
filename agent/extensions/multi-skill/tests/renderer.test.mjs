import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markSkillMessage, splitSkillMessage, installSkillRenderer } from '../renderer.ts';
const block = (name, body = 'Instructions ' + name) => `<skill name="${name}" location="/skills/${name}/SKILL.md">\nReferences are relative to /skills/${name}.\n\n${body}\n</skill>`;

test('exact boundaries: embedded tags, XML examples in task, Unicode, malformed envelope', () => {
  const blocks = [block('a', '😀\n' + block('example')), block('b')];
  const task = '\n\nTask\n' + block('not-activated') + '  ';
  const marked = markSkillMessage(blocks, task);
  assert.deepEqual(splitSkillMessage(marked), { blocks, task });
  assert.equal(splitSkillMessage(blocks.join('\n\n')), null);
  assert.equal(splitSkillMessage(marked + 'changed'), null);
  assert.equal(splitSkillMessage(marked.replace('"lengths":[', '"lengths":[-1,')), null);
});

test('renderer installation is idempotent and survives session runtime replacement', () => {
  const calls = [];
  class Mode { addMessageToChat(message, options) { calls.push({ message, options }); } }
  const original = Mode.prototype.addMessageToChat;
  installSkillRenderer(Mode);
  const wrapped = Mode.prototype.addMessageToChat;
  assert.notEqual(wrapped, original);
  installSkillRenderer(Mode);
  assert.equal(Mode.prototype.addMessageToChat, wrapped);
  const mode = new Mode();
  const ordinary = { role: 'user', content: block('ordinary') };
  mode.addMessageToChat(ordinary);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, ordinary);
});

test('real Pi renderer creates sequential native cards and Ctrl+O expands both; replay stable', async () => {
  const { InteractiveMode, SkillInvocationMessageComponent, UserMessageComponent, initTheme, getMarkdownTheme } = await import(process.env.PI_HOST_MODULE ?? import.meta.resolve('@earendil-works/pi-coding-agent'));
  initTheme('dark', false);
  installSkillRenderer(InteractiveMode);
    const history = [];
    const context = {
      getUserMessageText: InteractiveMode.prototype.getUserMessageText,
      getMarkdownThemeWithSettings: getMarkdownTheme,
      getMarkdownTransformers: () => [],
      outputPad: 1, toolOutputExpanded: false,
      chatContainer: { children: [], addChild(child) { this.children.push(child); } },
      loadedResourcesContainer: { children: [] },
      editor: { addToHistory: text => history.push(text) }, showStatus() {},
    };
    const nestedBody = 'Instructions a\nBefore\n<skill name="example" location="/tmp/example/SKILL.md">\nExample instructions\n</skill>\n\nAfter example remains part of skill a.';
    const text = markSkillMessage([block('a', nestedBody), block('b')], '\nTask');
    const message = { role: 'user', content: text, timestamp: Date.now() };
    InteractiveMode.prototype.addMessageToChat.call(context, message, { populateHistory: true });
    const cards = context.chatContainer.children.filter(c => c instanceof SkillInvocationMessageComponent);
    assert.equal(cards.length, 2);
    assert.deepEqual(cards.map(c => c.skillBlock.name), ['a', 'b']);
    assert.ok(cards[0].skillBlock.content.includes('After example remains part of skill a.'));
    assert.equal(context.chatContainer.children.filter(c => c instanceof UserMessageComponent).length, 1);
    const collapsed = cards.map(c => c.render(100).join('\n'));
    assert.ok(collapsed.every(text => !text.includes('Instructions')));
    InteractiveMode.prototype.setToolsExpanded.call(context, true);
    assert.ok(cards[0].render(100).join('\n').includes('Instructions a'));
    assert.ok(cards[1].render(100).join('\n').includes('Instructions b'));
    InteractiveMode.prototype.setToolsExpanded.call(context, false);
    assert.ok(cards.every(c => !c.render(100).join('\n').includes('Instructions')));
    assert.deepEqual(history, [text]);
    context.chatContainer.children = [];
    InteractiveMode.prototype.addMessageToChat.call(context, message);
    assert.equal(context.chatContainer.children.filter(c => c instanceof SkillInvocationMessageComponent).length, 2);
    assert.equal(history.length, 1);
    assert.equal(message.content, text);
});
