import { estimateTokens, type ContextWithSystemEvent, type ExtensionCommandContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InspectEntry, InspectItem } from "./ui.ts";

export type CapturedRequest = InspectEntry[];

/** Capture a read-only summary before each provider request. Kept in memory only. */
export function captureRequest(event: ContextWithSystemEvent): CapturedRequest {
	return event.messages.map((message, index) => {
		const label = `${String(message.role)} #${index + 1}`;
		const text = formatMessage(message);
		let tokens = 0;
		try {
			tokens = estimateTokens(message);
		} catch {
			tokens = Math.ceil(text.length / 4);
		}
		return { label, text, tokens };
	});
}

/** Build inspectable prompt, tool, option, and latest-request sections on demand. */
export function buildInjections(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	latestRequest: CapturedRequest | undefined,
): InspectItem[] {
	const items: InspectItem[] = [];
	const prompt = ctx.getSystemPrompt();
	const options = ctx.getSystemPromptOptions();
	items.push({
		label: "System Prompt",
		tokens: Math.ceil(prompt.length / 4),
		entries: [{ label: "Effective System Prompt", text: prompt, tokens: Math.ceil(prompt.length / 4) }],
	});

	const sections = [...prompt.matchAll(/<([a-z][a-z0-9_-]*)>([\s\S]*?)<\/\1>/gi)]
		.filter((match) => match[1]?.toLowerCase() !== "project_context" && match[1]?.toLowerCase() !== "skills");
	if (sections.length) {
		items.push({
			label: "Prompt Sections",
			entries: sections.map((match) => ({
				label: `<${match[1]}>`,
				text: match[2] ?? "",
				tokens: Math.ceil((match[2] ?? "").length / 4),
			})),
		});
	}

	if (options.contextFiles?.length) {
		items.push({
			label: `Instruction Files (${options.contextFiles.length})`,
			entries: options.contextFiles.map((file) => ({
				label: file.path,
				text: `Included instruction file: ${file.path}\n\n${file.content}`,
				tokens: Math.ceil((file.path.length + file.content.length + 64) / 4),
			})),
		});
	}
	const skills = options.skills ?? [];
	if (skills.length) {
		const selected = options.selectedTools ?? ["read", "bash", "edit", "write"];
		const promptTools = selected.filter((tool) => !options.hiddenTools?.includes(tool));
		const hasReader = promptTools.includes("read") || promptTools.includes("bash") || selected.some((tool) => tool === "read" || tool === "bash");
		items.push({
			label: `Available Skills (${skills.length})`,
			entries: skills.map((skill) => {
				const inPrompt = !skill.disableModelInvocation && hasReader;
				const status = inPrompt
					? "advertised in system prompt"
					: skill.disableModelInvocation
						? "explicit-command only; not advertised in system prompt"
						: "not advertised: no read-capable tool is selected";
				const text = `name: ${skill.name}\ndescription: ${skill.description}\nSKILL.md: ${skill.filePath}\n\nStatus: ${status}. Full skill instructions load only when invoked.`;
				return {
					label: `${skill.name} · ${inPrompt ? "in prompt" : "not in prompt"}`,
					text,
					tokens: inPrompt ? Math.ceil((skill.name.length + skill.description.length + skill.filePath.length + 32) / 4) : 0,
				};
			}),
		});
	}

	const active = new Set(pi.getActiveTools());
	const tools = pi.getAllTools().filter((tool) => active.has(tool.name));
	items.push({
		label: `Active Tools (${tools.length})`,
		entries: tools.map((tool) => {
			const text = [tool.name, tool.description, safeJson(tool.parameters)].join("\n\n");
			return { label: tool.name, text, tokens: Math.ceil(text.length / 4) };
		}),
	});

	const optionsDump = safeJson(options);
	items.push({
		label: "Prompt Options",
		entries: [{ label: "Pi prompt-construction options", text: optionsDump, tokens: Math.ceil(optionsDump.length / 4) }],
	});

	if (latestRequest) {
		items.push({ label: `Latest Request (${latestRequest.length} messages)`, entries: latestRequest });
	} else {
		items.push({
			label: "Latest Request",
			entries: [{ label: "Not captured yet", text: "Send a prompt first; the extension captures the prepared request in memory." }],
		});
	}
	return items;
}

function formatMessage(message: ContextWithSystemEvent["messages"][number]): string {
	const role = message.role;
	if ("content" in message) return `${role}\n\n${renderContent(message.content)}`;
	return `${role}\n\n${safeJson(message)}`;
}

function renderContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return safeJson(content);
	return content.map((part) => {
		if (!part || typeof part !== "object") return String(part);
		const block = part as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") return block.text;
		if (block.type === "thinking" && typeof block.thinking === "string") return block.thinking;
		if (block.type === "toolCall") return `${String(block.name)}(${safeJson(block.arguments)})`;
		if (block.type === "image") return "[image omitted]";
		return `[${String(block.type ?? "content")}]`;
	}).join("\n");
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return "[unserializable]";
	}
}
