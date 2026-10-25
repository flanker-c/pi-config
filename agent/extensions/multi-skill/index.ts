import { InteractiveMode, stripFrontmatter, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createInputHandler } from "./core.ts";
import { wrapSkillAutocomplete } from "./autocomplete.ts";
import { installSkillRenderer } from "./renderer.ts";

export default function multiSkill(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    try {
      // The adapter stays installed for this process so Pi can replay marked
      // messages before the replacement runtime emits session_start on reload/resume.
      installSkillRenderer(InteractiveMode);
    } catch (error) {
      ctx.ui.notify(String(error), "error");
    }
    ctx.ui.addAutocompleteProvider(current => wrapSkillAutocomplete(current, () => pi.getCommands()));
  });
  pi.on("input", createInputHandler(pi, stripFrontmatter, (ctx, message) => {
    if (ctx.hasUI) ctx.ui.notify(message, "error");
    else console.error(message);
  }));
}
