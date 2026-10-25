import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMultiSkill, resolveSkills, expandSkills, createInputHandler } from '../core.ts';
const command = (name, path) => ({ name: 'skill:' + name, source: 'skill', sourceInfo: { path } });

for (const input of ['', 'hello $a', '```\n$a\n$b\n```', ' $a', '$a,$b', '$a$b', '/help', '/skill:a']) {
  test('not a dollar header: ' + JSON.stringify(input), () => assert.equal(parseMultiSkill(input), null));
}
for (const [input, names, task] of [
  ['$a', ['a'], ''], ['$a $b Task  ', ['a', 'b'], ' Task  '],
  ['$a\n$b\r\n$c\n\nTask', ['a', 'b', 'c'], '\n\nTask'],
  ['$a Task $b', ['a'], ' Task $b'], ['$a\n\n$b', ['a'], '\n\n$b'],
  ['$a $a', ['a', 'a'], ''], ['$a\t$b\r\n X', ['a', 'b'], '\r\n X'],
]) test('header: ' + JSON.stringify(input), () => assert.deepEqual(parseMultiSkill(input), { names, task }));
test('no cap', () => assert.equal(parseMultiSkill(Array(100).fill('$a').join(' ')).names.length, 100));

test('resolution, full expansion and atomic input errors with live files and registry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dollar-skills-'));
  try {
    const a = join(dir, 'a.md'), b = join(dir, 'b.md');
    await writeFile(a, 'A\n$example'); await writeFile(b, 'B');
    let commands = [command('a', a), command('b', b)];
    const errors = [];
    const handler = createInputHandler({ getCommands: () => commands }, x => x, (_, error) => errors.push(error));
    const event = { text: '$a $b\n\nTask $unused  ', images: [{ type: 'image' }] };
    const result = await handler(event, {});
    assert.equal(result.action, 'transform'); assert.equal(result.images, event.images);
    assert.match(result.text, /name="a"[\s\S]*A\n\$example[\s\S]*name="b"[\s\S]*\nB\n/);
    assert.ok(result.text.endsWith('\n\nTask $unused  '));
    assert.deepEqual(await handler({ text: result.text }, {}), { action: 'continue' });
    assert.equal((await handler({ text: '$a' }, {})).action, 'transform');
    await writeFile(b, 'UPDATED'); assert.match((await handler(event, {})).text, /UPDATED/);
    commands = [command('a', a)];
    assert.deepEqual(await handler(event, {}), { action: 'handled' }); assert.match(errors.at(-1), /b/);
    commands.push(command('b', b)); await rm(b);
    assert.deepEqual(await handler(event, {}), { action: 'handled' }); assert.match(errors.at(-1), /Cannot load skill b/);
    assert.deepEqual(await handler({ text: '/skill:a task' }, {}), { action: 'handled' });
    assert.match(errors.at(-1), /Use \$name/);
    assert.deepEqual(await handler({ text: '/help' }, {}), { action: 'continue' });
    assert.deepEqual(await handler({ text: 'Task /skill:a $a' }, {}), { action: 'continue' });
    assert.throws(() => resolveSkills(['x'], [{ ...command('x', a), source: 'extension' }]), /not found/);
    await assert.rejects(expandSkills(resolveSkills(['a'], commands), '', () => { throw Error('bad YAML'); }), /Cannot load skill a/);
    const broken = createInputHandler({ getCommands() { throw Error('registry'); } }, x => x, () => { throw Error('UI'); });
    assert.deepEqual(await broken({ text: '$a' }, {}), { action: 'handled' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('host frontmatter parity and actual ExtensionRunner chain', async () => {
  const { stripFrontmatter, AgentSession, ExtensionRunner } = await import(process.env.PI_HOST_MODULE ?? import.meta.resolve('@earendil-works/pi-coding-agent'));
  const dir = await mkdtemp(join(tmpdir(), 'dollar-host-'));
  try {
    const filePath = join(dir, 'SKILL.md');
    await writeFile(filePath, '\uFEFF---\r\nname: a\r\ndescription: test\r\n---\r\n\r\nFULL\r\n');
    const skill = { name: 'a', filePath, baseDir: dir };
    const native = AgentSession.prototype._expandSkillCommand.call({ resourceLoader: { getSkills: () => ({ skills: [skill] }) } }, '/skill:a');
    assert.equal(await expandSkills([skill], '', stripFrontmatter), native);
    const handler = createInputHandler({ getCommands: () => [command('a', filePath)] }, stripFrontmatter, () => {});
    let seen;
    const runner = { extensions: [
      { handlers: new Map([['input', [handler]]]) },
      { handlers: new Map([['input', [async event => { seen = event; return { action: 'transform', text: event.text + '\nAFTER' }; }]]]) },
    ], createContext: () => ({}), emitError(error) { throw Error(JSON.stringify(error)); } };
    const images = [{ type: 'image' }];
    const result = await ExtensionRunner.prototype.emitInput.call(runner, '$a $a Task', images, 'rpc', 'followUp');
    assert.equal(result.images, images); assert.equal(seen.streamingBehavior, 'followUp');
    assert.match(result.text, /name="a"[\s\S]*name="a"[\s\S]*Task\nAFTER$/);
    seen = undefined;
    assert.deepEqual(await ExtensionRunner.prototype.emitInput.call(runner, '$a $missing', images, 'rpc'), { action: 'handled' });
    assert.equal(seen, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
