import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildInjections, captureRequest, type CapturedRequest } from "./injections.ts";
import { buildUsageSnapshot } from "./measure.ts";
import { openExplorer, type InspectItem } from "./ui.ts";

interface ExtensionConfig {
	mapCols: number;
	mapRows: number;
}

const DEFAULT_CONFIG: ExtensionConfig = { mapCols: 24, mapRows: 4 };

/** A small, independent context-inspection extension; all state is process-local. */
export default function (pi: ExtensionAPI) {
	let latestRequest: CapturedRequest | undefined;

	// This event runs just before the provider request. Copy only displayable data;
	// never keep mutable message objects or serialize image payloads into memory.
	pi.on("context_with_system", (event) => {
		latestRequest = captureRequest(event);
	});
	pi.on("session_shutdown", () => {
		latestRequest = undefined;
	});

	pi.registerCommand("context", {
		description: "Inspect context usage and request contents",
		getArgumentCompletions: () => [
			{ value: "usage", label: "usage", description: "Context usage map" },
			{ value: "injections", label: "injections", description: "Inspect prompt, tools, and latest request" },
			{ value: "config", label: "config", description: "Create the extension configuration" },
		],
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase().split(/\s+/, 1)[0] || "usage";
			if (command === "config") {
				createConfig(ctx);
				return;
			}
			if (command !== "usage" && command !== "injections") {
				ctx.ui.notify("Использование: /context [usage|injections|config]", "info");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify(`/context ${command} требует интерактивный TUI-режим.`, "info");
				return;
			}

			if (command === "usage") {
				const usage = buildUsageSnapshot(pi, ctx);
				const config = loadConfig();
				const items: InspectItem[] = usage.categories.map((category) => ({
					label: category.label,
					tokens: category.tokens,
					color: category.color,
					entries: category.entries,
				}));
				await openExplorer(ctx, {
					title: "Context Usage",
					subtitle: usageSubtitle(usage),
					items,
					usage: { ...usage, mapCols: config.mapCols, mapRows: config.mapRows },
				});
				return;
			}

			await openExplorer(ctx, {
				title: "Context Injections",
				subtitle: "Live prompt/tools plus an in-memory snapshot at this hook; later hooks or provider payload rewrites may differ.",
				items: buildInjections(pi, ctx, latestRequest),
			});
		},
	});
}

function usageSubtitle(usage: ReturnType<typeof buildUsageSnapshot>): string {
	return `${usage.model ?? "Model unknown"} · token values are estimates`;
}

function createConfig(ctx: ExtensionCommandContext): void {
	const path = join(getAgentDir(), "extensions", "context-view.json");
	if (existsSync(path)) {
		ctx.ui.notify(`Config already exists: ${path}`, "info");
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
	ctx.ui.notify(`Created config: ${path}`, "info");
}

function loadConfig(): ExtensionConfig {
	const path = join(getAgentDir(), "extensions", "context-view.json");
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object") return DEFAULT_CONFIG;
		const value = parsed as Record<string, unknown>;
		return {
			mapCols: validSize(value.mapCols, DEFAULT_CONFIG.mapCols),
			mapRows: validSize(value.mapRows, DEFAULT_CONFIG.mapRows),
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}

function validSize(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 4 && value <= 64 ? value : fallback;
}

function format(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}
