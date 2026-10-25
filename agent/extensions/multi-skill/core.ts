import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { markSkillMessage } from './renderer.ts';

import type { ExtensionAPI, ExtensionContext, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";

export interface SkillEntry { name: string; filePath: string; baseDir: string }
export interface ParsedSkills { names: string[]; task: string }
type SkillCommands = ReturnType<ExtensionAPI["getCommands"]>;
type StripFrontmatter = (content: string) => string;
type ReadSkill = (path: string, encoding: "utf8") => Promise<string>;

// Explicit $skills at byte zero only. Whitespace after the last token is task text.
export function parseMultiSkill(text: string): ParsedSkills | null {
  const names = [];
  let end = 0;
  while (true) {
    const start = names.length ? end + (/^[ \t\r\n]+/.exec(text.slice(end))?.[0].length ?? 0) : 0;
    const gap = text.slice(end, start);
    if (names.length && (!gap || /\r?\n[ \t]*\r?\n/.test(gap))) break;
    const token = /^\$([a-zA-Z0-9][a-zA-Z0-9._-]*)(?=\s|$)/.exec(text.slice(start));
    if (!token) break;
    names.push(token[1]);
    end = start + token[0].length;
  }
  return names.length ? { names, task: text.slice(end) } : null;
}

export function resolveSkills(names: string[], commands: SkillCommands): SkillEntry[] {
  const index = new Map<string, string | undefined>();
  for (const command of commands) {
    if (command.source === "skill" && command.name.startsWith("skill:")) {
      const name = command.name.slice(6);
      if (!index.has(name)) index.set(name, command.sourceInfo?.path);
    }
  }
  return names.map((name) => {
    const filePath = index.get(name);
    if (!filePath) throw new Error("Skill not found or has no path: " + name);
    return { name, filePath, baseDir: dirname(filePath) };
  });
}

export async function expandSkills(skills: SkillEntry[], task: string, stripFrontmatter: StripFrontmatter, read: ReadSkill = readFile, marked = false): Promise<string> {
  const blocks = [];
  for (const skill of skills) {
    try {
      const body = stripFrontmatter(await read(skill.filePath, "utf8")).trim();
      // Same wrapper as Pi 1.4.0; no private runtime imports.
      blocks.push(`<skill name="${skill.name}" location="${skill.filePath}">
References are relative to ${skill.baseDir}.

${body}
</skill>`);
    } catch (error) {
      throw new Error("Cannot load skill " + skill.name + " (" + skill.filePath + "): " + String(error));
    }
  }
  // Preserve the task byte-for-byte, including blank lines and trailing spaces.
  if (marked) return markSkillMessage(blocks, task);
  return blocks.join("\n\n") + (task ? "\n\n" + task : "");
}

export function createInputHandler(pi: Pick<ExtensionAPI, 'getCommands'>, stripFrontmatter: StripFrontmatter, reportError: (ctx: ExtensionContext, message: string) => void) {
  return async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> => {
    if (/^\/skill:[^\s]+/.test(event.text)) {
      try { reportError(ctx, 'Skill slash commands are disabled. Use $name (for example: $tdd $implement).'); } catch {}
      return { action: "handled" };
    }
    const parsed = parseMultiSkill(event.text);
    if (!parsed) return { action: "continue" };
    try {
      const skills = resolveSkills(parsed.names, pi.getCommands());
      const text = await expandSkills(skills, parsed.task, stripFrontmatter, undefined, true);
      return { action: "transform", text, images: event.images };
    } catch (error) {
      // Throwing from an input handler would fail OPEN in Pi.
      try {
        reportError(ctx, "Multi-skill: request cancelled. " + String(error));
      } catch {
        // Even a broken notification transport must not send partial instructions.
      }
      return { action: "handled" };
    }
  };
}
