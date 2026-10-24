import { estimateTokens, type ExtensionAPI, type ExtensionCommandContext, type ContextEvent } from "@earendil-works/pi-coding-agent";

export interface PreviewEntry {
	label: string;
	tokens: number;
	text: string;
}

export interface ContextCategory {
	id: string;
	label: string;
	tokens: number;
	entries: PreviewEntry[];
	color: "accent" | "success" | "warning" | "toolOutput" | "muted" | "error";
}

export interface UsageSnapshot {
	categories: ContextCategory[];
	estimatedTokens: number;
	reportedTokens?: number;
	contextWindow: number;
	mapCols?: number;
	mapRows?: number;
	percent?: number;
	model?: string;
}

const COLORS: ContextCategory["color"][] = ["accent", "success", "warning", "toolOutput", "muted", "error"];

/** Build an inspectable, branch-aware estimate from Pi's own session projection. */
export function buildUsageSnapshot(pi: ExtensionAPI, ctx: ExtensionCommandContext): UsageSnapshot {
	const grouped = new Map<string, ContextCategory>();
	const add = (id: string, label: string, entry: PreviewEntry) => {
		let category = grouped.get(id);
		if (!category) {
			category = { id, label, tokens: 0, entries: [], color: COLORS[grouped.size % COLORS.length] };
			grouped.set(id, category);
		}
		category.tokens += entry.tokens;
		category.entries.push(entry);
	};

	addSystemPromptParts(add, ctx);

	const active = new Set(pi.getActiveTools());
	const tools = pi.getAllTools().filter((tool) => active.has(tool.name));
	for (const tool of tools) {
		const schema = safeJson(tool.parameters);
		const text = `${tool.name}\n${tool.description}\n${schema}`;
		add("tools", "Tools", {
			label: tool.name,
			tokens: textTokens(text),
			text,
		});
	}

	for (const message of ctx.sessionManager.buildSessionProjection().messages) {
		if (message.role === "system") continue; // System messages are represented by the effective prompt above.
		const { id, label, entryLabel } = classifyMessage(message);
		const text = messageText(message);
		let tokens: number;
		try {
			tokens = estimateTokens(message);
		} catch {
			tokens = textTokens(text);
		}
		add(id, label, { label: entryLabel, tokens, text });
	}

	const usage = ctx.getContextUsage();
	return {
		categories: [...grouped.values()].filter((category) => category.tokens > 0),
		estimatedTokens: [...grouped.values()].reduce((sum, category) => sum + category.tokens, 0),
		reportedTokens: usage?.tokens ?? undefined,
		contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
		percent: usage?.percent ?? undefined,
		model: ctx.model?.id,
	};
}

type AddEstimate = (id: string, label: string, entry: PreviewEntry) => void;

/** Split Pi's structured system prompt using its source metadata, not guesses from filenames. */
function addSystemPromptParts(add: AddEstimate, ctx: ExtensionCommandContext): void {
	const prompt = ctx.getSystemPrompt();
	const options = ctx.getSystemPromptOptions();
	if (options.forceSystemPrompt !== undefined) {
		add("forced-prompt", "Forced System Prompt", {
			label: "Complete prompt replacement",
			tokens: textTokens(prompt),
			text: prompt,
		});
		return;
	}

	const matches = [...prompt.matchAll(/<([a-z][a-z0-9_-]*)>([\s\S]*?)<\/\1>/gi)];
	const byName = new Map<string, string[]>();
	for (const match of matches) {
		const name = match[1]?.toLowerCase();
		if (!name) continue;
		const list = byName.get(name) ?? [];
		list.push(match[0]);
		byName.set(name, list);
	}
	let untagged = prompt;
	for (const match of matches) untagged = untagged.replace(match[0], "");
	untagged = untagged.trim();
	if (untagged) {
		const custom = options.customPrompt !== undefined;
		add(custom ? "custom-prompt" : "pi-prompt", custom ? "Custom System Prompt" : "Pi System Prompt", {
			label: custom ? "Custom prompt prefix" : "Base prompt text",
			tokens: textTokens(untagged),
			text: untagged,
		});
	}

	for (const [name, blocks] of byName) {
		const raw = blocks.join("\n\n");
		if (name === "project_context" && options.contextFiles?.length) {
			add("instructions", "Instruction Files (AGENTS.md, CLAUDE.md, etc.)", {
				label: "Pi instruction-file section",
				tokens: textTokens("Project-specific instructions and guidelines:"),
				text: "Project-specific instructions and guidelines:",
			});
			for (const file of options.contextFiles) {
				const body = `<project_instructions path="${escapeXml(file.path)}">\n${file.content}\n</project_instructions>`;
				add("instructions", "Instruction Files (AGENTS.md, CLAUDE.md, etc.)", {
					label: file.path,
					tokens: textTokens(body),
					text: body,
				});
			}
			continue;
		}
		if (name === "skills" && options.skills?.length) {
			const selected = options.selectedTools ?? ["read", "bash", "edit", "write"];
			const visible = selected.filter((tool) => !options.hiddenTools?.includes(tool));
			const reader = visible.includes("read") ? "read" : visible.includes("bash") ? "bash" :
				selected.some((tool) => tool === "read" || tool === "bash") ? "indirect" : undefined;
			const skills = options.skills.filter((skill) => !skill.disableModelInvocation);
			if (!reader || skills.length === 0) continue;
			for (const skill of skills) {
				const body = `<skill>\n<name>${escapeXml(skill.name)}</name>\n<description>${escapeXml(skill.description)}</description>\n<location>${escapeXml(skill.filePath)}</location>\n</skill>`;
				add("skills", "Skills (available descriptions)", {
					label: skill.name,
					tokens: textTokens(body),
					text: `${body}\n\nFull instructions are loaded from SKILL.md only when this skill is invoked.`,
				});
			}
			const intro = raw.replace(/<skill>[\s\S]*?<\/skill>/gi, "").trim();
			if (intro) add("skills", "Skills (available descriptions)", { label: "Skills section header", tokens: textTokens(intro), text: intro });
			continue;
		}
		if (name === "addendum") {
			add("appended", "Appended Instructions", { label: "appendSystemPrompt", tokens: textTokens(raw), text: raw });
		} else if (options.sections && Object.hasOwn(options.sections, name)) {
			add("extension-sections", "Custom Prompt Sections", { label: name, tokens: textTokens(raw), text: raw });
		} else {
			const labels: Record<string, string> = {
				tools: "Tool Guidance in Prompt",
				rules: "Pi Rules",
				docs: "Pi Documentation Guidance",
				cwd: "Working Directory",
			};
			const label = labels[name] ?? `Prompt Section: ${name}`;
			add(`prompt:${name}`, label, { label, tokens: textTokens(raw), text: raw });
		}
	}
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function classifyMessage(message: ContextEvent["messages"][number]): { id: string; label: string; entryLabel: string } {
	switch (message.role) {
		case "user": return { id: "user", label: "User Messages", entryLabel: "User" };
		case "assistant": return { id: "assistant", label: "Assistant Messages", entryLabel: "Assistant" };
		case "toolResult": return { id: `tool:${message.toolName}`, label: `Tool Output · ${message.toolName}`, entryLabel: message.toolName };
		case "custom": return { id: `extension:${message.customType}`, label: `Extension · ${message.customType}`, entryLabel: message.customType };
		case "bashExecution": return { id: "bash", label: "Bash Executions", entryLabel: "bash" };
		case "branchSummary": return { id: "compacted", label: "Compacted Data", entryLabel: "Branch summary" };
		case "compactionSummary": return { id: "compacted", label: "Compacted Data", entryLabel: "Compaction summary" };
		default: return { id: "other", label: "Other Context", entryLabel: message.role };
	}
}

function messageText(message: ContextEvent["messages"][number]): string {
	const body = "content" in message ? contentText(message.content) : safeJson(message);
	const name = "toolName" in message && typeof message.toolName === "string" ? ` (${message.toolName})` : "";
	return `${message.role}${name}\n\n${body}`;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.map((part) => {
			if (!part || typeof part !== "object") return String(part);
			const block = part as Record<string, unknown>;
			if (block.type === "text" && typeof block.text === "string") return block.text;
			if (block.type === "toolCall") return `${String(block.name)}(${safeJson(block.arguments)})`;
			if (block.type === "thinking" && typeof block.thinking === "string") return block.thinking;
			if (block.type === "image") return "[image content omitted]";
			return `[${String(block.type ?? "content")}]`;
		}).join("\n");
	}
	return safeJson(content);
}

function textTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return "[unserializable content]";
	}
}
