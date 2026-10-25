import { SkillInvocationMessageComponent } from '@earendil-works/pi-coding-agent';
import { Spacer } from '@earendil-works/pi-tui';

interface SkillMessage { blocks: string[]; task: string }
interface SkillCardData { name: string; location: string; content: string; userMessage: undefined }
interface ContentPart { type: string; text?: string; [key: string]: unknown }
interface RenderMessage { role: string; content?: string | ContentPart[]; [key: string]: unknown }
interface RenderOptions { populateHistory?: boolean; [key: string]: unknown }
interface RenderContext {
  editor: { addToHistory?: (text: string) => void };
  chatContainer: { children: unknown[]; addChild(child: unknown): void };
  toolOutputExpanded: boolean;
  outputPad: number;
  getMarkdownThemeWithSettings(): unknown;
}
type RenderMethod = (this: RenderContext, message: RenderMessage, options?: RenderOptions) => void;
interface PatchState { original: RenderMethod; wrapper: RenderMethod }
type RendererPrototype = { addMessageToChat: RenderMethod; [key: symbol]: PatchState | undefined };

// Exact UTF-16 lengths avoid parsing tags inside skill bodies or task examples.
const PREFIX = '<!-- pi-local-multi-skill:v1 ';
const SKILL_CLOSE = '\n</skill>';

export function markSkillMessage(blocks: string[], task: string): string {
  const text = blocks.join('\n\n') + (task ? '\n\n' + task : '');
  return PREFIX + JSON.stringify({ lengths: blocks.map(block => block.length), taskLength: task.length }) + ' -->\n' + text;
}

export function splitSkillMessage(text: unknown): SkillMessage | null {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return null;
  const end = text.indexOf(' -->\n', PREFIX.length);
  if (end < 0) return null;
  try {
    const value: unknown = JSON.parse(text.slice(PREFIX.length, end));
    if (!value || typeof value !== 'object') return null;
    const meta = value as { lengths?: unknown; taskLength?: unknown };
    if (!Array.isArray(meta.lengths) || !meta.lengths.length || !meta.lengths.every(n => typeof n === 'number' && Number.isSafeInteger(n) && n > 0) || typeof meta.taskLength !== 'number' || !Number.isSafeInteger(meta.taskLength) || meta.taskLength < 0) return null;
    let offset = end + 5;
    const blocks: string[] = [];
    for (const length of meta.lengths as number[]) {
      if (blocks.length) {
        if (text.slice(offset, offset + 2) !== '\n\n') return null;
        offset += 2;
      }
      const block = text.slice(offset, offset + length);
      if (block.length !== length || !parseSkillCardData(block)) return null;
      blocks.push(block);
      offset += length;
    }
    if (meta.taskLength) {
      if (text.slice(offset, offset + 2) !== '\n\n') return null;
      offset += 2;
    }
    const task = text.slice(offset);
    if (task.length !== meta.taskLength) return null;
    return { blocks, task };
  } catch { return null; }
}

/** Parse only the generated outer wrapper; body may contain arbitrary nested skill-like XML. */
export function parseSkillCardData(block: string): SkillCardData | null {
  const header = /^<skill name="([^"]+)" location="([^"]+)">\n/.exec(block);
  if (!header || !block.endsWith(SKILL_CLOSE)) return null;
  return { name: header[1], location: header[2], content: block.slice(header[0].length, -SKILL_CLOSE.length), userMessage: undefined };
}

// Pi 1.4.0 exposes no message-renderer hook for ordinary user messages. Install
// one process-lifetime adapter so replay during reload/resume sees it too.
const PATCH = Symbol.for('pi-local-multi-skill.renderer.v1');
export function installSkillRenderer(InteractiveMode: unknown): void {
  if (typeof InteractiveMode !== 'function' || !InteractiveMode.prototype) throw Error('Multi-skill renderer: unsupported Pi class');
  const proto = InteractiveMode.prototype as RendererPrototype;
  if (proto[PATCH]) return;
  const original = proto.addMessageToChat;
  if (typeof original !== 'function') throw Error('Multi-skill renderer: unsupported Pi (missing addMessageToChat)');
  const state: PatchState = { original, wrapper: original };
  state.wrapper = function(message, options) {
    if (message.role !== 'user') return original.call(this, message, options);
    const content = message.content;
    const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text as string) : [];
    // Do not infer boundaries when another extension has changed/split content.
    const parsed = texts.length === 1 ? splitSkillMessage(texts[0]) : null;
    if (!parsed) return original.call(this, message, options);

    const renderOptions = { ...options, populateHistory: false };
    for (const block of parsed.blocks) {
      const skill = parseSkillCardData(block);
      if (!skill) return original.call(this, message, options);
      if (this.chatContainer.children.length > 0) this.chatContainer.addChild(new Spacer(1));
      const card = new SkillInvocationMessageComponent(skill, this.getMarkdownThemeWithSettings() as never, this.outputPad);
      card.setExpanded(this.toolOutputExpanded);
      this.chatContainer.addChild(card);
    }

    const other = Array.isArray(content) ? content.filter(part => part.type !== 'text') : [];
    if (parsed.task || other.length) {
      const taskContent = other.length ? [{ type: 'text', text: parsed.task }, ...other] : parsed.task;
      original.call(this, { ...message, content: taskContent }, renderOptions);
    }
    if (options?.populateHistory) this.editor.addToHistory?.(texts[0]);
  };
  proto[PATCH] = state;
  proto.addMessageToChat = state.wrapper;
}
