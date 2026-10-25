import { parseMultiSkill } from './core.ts';
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function skillCompletionPrefix(lines: string[], cursorLine: number, cursorCol: number): string | null {
  const line = lines[cursorLine];
  if (line === undefined || line.slice(cursorCol).trim()) return null;
  const before = [...lines.slice(0, cursorLine), line.slice(0, cursorCol)].join('\n');
  const match = /\$[a-zA-Z0-9._-]*$/.exec(before);
  if (!match) return null;
  const previous = before.slice(0, match.index);
  if (!previous) return match[0];
  const parsed = parseMultiSkill(previous);
  if (!parsed || !/^\s+$/.test(parsed.task) || /\r?\n[ \t]*\r?\n/.test(parsed.task)) return null;
  return match[0];
}

export function wrapSkillAutocomplete(current: AutocompleteProvider, getCommands: ExtensionAPI['getCommands']): AutocompleteProvider {
  const ownedItems = new WeakSet<AutocompleteItem>();
  return {
    triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), '$'])],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const prefix = skillCompletionPrefix(lines, cursorLine, cursorCol);
      if (prefix === null) {
        const result = await current.getSuggestions(lines, cursorLine, cursorCol, options);
        if (!result) return result;
        const items = result.items.filter(item => !/^\/?skill:/.test(item.value) && !/^\/skill:/.test(item.label));
        return items.length ? { ...result, items } : null;
      }
      if (options.signal.aborted) return null;
      const items = getCommands()
        .filter(command => command.source === 'skill' && command.name.startsWith('skill:') && command.name.slice(6).startsWith(prefix.slice(1)))
        .map(command => {
          const value = '$' + command.name.slice(6);
          const item = { value, label: value, description: command.description };
          ownedItems.add(item);
          return item;
        });
      return items.length ? { items, prefix } : null;
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (!ownedItems.has(item) || skillCompletionPrefix(lines, cursorLine, cursorCol) !== prefix) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }
      const result = [...lines];
      const start = cursorCol - prefix.length;
      result[cursorLine] = lines[cursorLine].slice(0, start) + item.value + lines[cursorLine].slice(cursorCol);
      return { lines: result, cursorLine, cursorCol: start + item.value.length };
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      // Tab uses the editor's force-completion path outside native slash commands.
      // Returning true here lets it call our provider, not a file-specific provider.
      if (skillCompletionPrefix(lines, cursorLine, cursorCol) !== null) return true;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
    },
  };
}
