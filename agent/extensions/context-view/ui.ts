import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ContextCategory, UsageSnapshot } from "./measure.ts";

export interface InspectEntry {
	label: string;
	text: string;
	tokens?: number;
}

export interface InspectItem {
	label: string;
	tokens?: number;
	entries: InspectEntry[];
	color?: ContextCategory["color"];
}

export interface ExplorerData {
	title: string;
	subtitle: string;
	items: InspectItem[];
	usage?: UsageSnapshot;
}

/** Full-screen list/detail viewer shared by Usage and Injections. */
export async function openExplorer(ctx: ExtensionCommandContext, data: ExplorerData): Promise<void> {
	await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
		let selectedItem = 0;
		let selectedEntry = 0;
		let mode: "list" | "entries" | "content" = "list";
		let scrollOffset = 0;
		let renderedPreviewLineCount = 0;
		let cachedWidth: number | undefined;
		let cachedRows: number | undefined;
		let cached: string[] | undefined;

		const invalidate = () => {
			cachedWidth = undefined;
			cachedRows = undefined;
			cached = undefined;
		};

		const currentItem = () => data.items[selectedItem];
		const currentEntry = () => currentItem()?.entries[selectedEntry];
		const back = () => {
			if (mode === "content") {
				mode = currentItem()?.entries.length === 1 ? "list" : "entries";
				scrollOffset = 0;
			} else if (mode === "entries") {
				mode = "list";
				scrollOffset = 0;
			} else done(undefined);
			invalidate();
		};

		return {
			render(width: number): string[] {
				const rows = Math.max(8, tui.terminal.rows);
				if (cached && cachedWidth === width && cachedRows === rows) return cached;
				cachedWidth = width;
				cachedRows = rows;

				const border = theme.fg("border", "─".repeat(width));
				const heading = mode === "list"
					? data.title
					: mode === "entries"
						? currentItem()?.label ?? data.title
						: currentEntry()?.label ?? data.title;
				const lines = [border, `  ${theme.fg("accent", theme.bold(heading))}`, ...wrapTextWithAnsi(theme.fg("muted", data.subtitle), Math.max(1, width - 4)).map((line) => `  ${line}`), ""];

				if (mode === "list") {
					if (data.usage) lines.push(...mapLines(data.usage, width, theme));
					const linesPerItem = width < 72 ? 2 : 1;
					const listRows = Math.max(1, Math.floor((rows - lines.length - 5) / linesPerItem));
					const start = Math.max(0, Math.min(selectedItem - Math.floor(listRows / 2), data.items.length - listRows));
					for (let index = start; index < Math.min(data.items.length, start + listRows); index++) {
						const item = data.items[index];
						if (!item) continue;
						const selected = index === selectedItem;
						const marker = selected ? theme.fg("accent", "❯") : " ";
						const swatch = theme.fg(item.color ?? "muted", "■");
						const amount = item.tokens === undefined ? "" : `~${format(item.tokens)} tok`;
						const percentValue = item.tokens !== undefined && data.usage?.contextWindow
							? item.tokens / data.usage.contextWindow * 100
							: undefined;
						const percent = percentValue === undefined ? "" : ` ${formatPercent(percentValue)}`;
						const detail = item.entries.length > 1 ? ` · ${item.entries.length} entries` : "";
						if (width < 72) {
							lines.push(truncateToWidth(`  ${marker} ${swatch} ${item.label}`, width));
							lines.push(truncateToWidth(`      ${amount}${percent}${detail}`, width));
						} else lines.push(truncateToWidth(`  ${marker} ${swatch} ${item.label}  ${amount}${percent}${detail}`, width));
					}
					lines.push("", theme.fg("dim", "↑/↓ navigate · Enter inspect · Esc close"));
				} else if (mode === "entries") {
					const entries = currentItem()?.entries ?? [];
					const listRows = Math.max(1, rows - lines.length - 5);
					const start = Math.max(0, Math.min(selectedEntry - Math.floor(listRows / 2), entries.length - listRows));
					for (let index = start; index < Math.min(entries.length, start + listRows); index++) {
						const entry = entries[index];
						if (!entry) continue;
						const selected = index === selectedEntry;
						const amount = entry.tokens === undefined ? "" : `  ~${format(entry.tokens)} tok`;
						lines.push(truncateToWidth(`  ${selected ? theme.fg("accent", "❯") : " "} ${entry.label}${amount}`, width));
					}
					lines.push("", theme.fg("dim", "↑/↓ navigate · Enter preview · Esc back"));
				} else {
					const entry = currentEntry();
					if (!entry) lines.push(theme.fg("warning", "No content available."));
					else {
						const bodyWidth = Math.max(1, width - 4);
						const safeText = sanitize(entry.text);
						const wrapped = safeText.split("\n").flatMap((line) => wrapTextWithAnsi(line, bodyWidth));
						renderedPreviewLineCount = wrapped.length;
						const viewRows = Math.max(1, rows - lines.length - 5);
						const maxOffset = Math.max(0, wrapped.length - viewRows);
						scrollOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
						lines.push(...wrapped.slice(scrollOffset, scrollOffset + viewRows).map((line) => `  ${line}`));
						lines.push("", theme.fg("dim", `↑/↓ scroll · Esc back${wrapped.length > viewRows ? ` · ${scrollOffset + 1}-${Math.min(scrollOffset + viewRows, wrapped.length)}/${wrapped.length}` : ""}`));
					}
				}

				const bottomBorder = lines.pop() ?? border;
				while (lines.length < rows - 1) lines.push("");
				lines.push(bottomBorder);
				cached = lines.slice(0, rows).map((line) => truncateToWidth(line, width));
				return cached;
			},
			handleInput(input: string): void {
				if (keybindings.matches(input, "tui.select.cancel")) {
					back();
					tui.requestRender();
					return;
				}
				if (mode === "content") {
					const entry = currentEntry();
					if (keybindings.matches(input, "tui.select.up")) scrollOffset = Math.max(0, scrollOffset - 1);
					else if (keybindings.matches(input, "tui.select.down")) scrollOffset = Math.min(renderedPreviewLineCount, scrollOffset + 1);
					else return;
				} else if (keybindings.matches(input, "tui.select.up")) {
					if (mode === "list") selectedItem = Math.max(0, selectedItem - 1);
					else selectedEntry = Math.max(0, selectedEntry - 1);
				} else if (keybindings.matches(input, "tui.select.down")) {
					if (mode === "list") selectedItem = Math.min(data.items.length - 1, selectedItem + 1);
					else selectedEntry = Math.min((currentItem()?.entries.length ?? 1) - 1, selectedEntry + 1);
				} else if (keybindings.matches(input, "tui.select.confirm")) {
					if (mode === "list") {
						const item = currentItem();
						if (!item) return;
						selectedEntry = 0;
						mode = item.entries.length > 1 ? "entries" : "content";
					} else if (mode === "entries") mode = "content";
					scrollOffset = 0;
				} else return;
				invalidate();
				tui.requestRender();
			},
			invalidate,
		};
	}, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0 } });
}

function mapLines(usage: UsageSnapshot, width: number, theme: Theme): string[] {
	const columns = Math.max(8, width - 2);
	const used = usage.reportedTokens !== undefined && usage.reportedTokens > 0
		? usage.reportedTokens
		: usage.estimatedTokens;
	const window = usage.contextWindow > 0 ? usage.contextWindow : Math.max(used, 1);
	const occupancy = usage.contextWindow > 0 ? Math.max(0, Math.min(columns, Math.round(used / window * columns))) : 0;
	const occupancyBar = `${theme.fg("accent", "█".repeat(occupancy))}${theme.fg("dim", "░".repeat(Math.max(0, columns - occupancy)))}`;
	const mixCells = allocateMix(usage.categories.map((item) => item.tokens), columns);
	let offset = 0;
	const mix = usage.categories.map((item, index) => {
		const segment = theme.fg(item.color, "█".repeat(mixCells[index] ?? 0));
		offset += mixCells[index] ?? 0;
		return segment;
	}).join("");
	return [
		`  ${theme.fg("muted", `Context window · ~${format(used)} / ${usage.contextWindow > 0 ? format(usage.contextWindow) : "unknown"} tokens`)}`,
		`  ${occupancyBar}`,
		`  ${theme.fg("muted", `Token breakdown · ~${format(usage.estimatedTokens)} tokens`)}`,
		`  ${mix}${theme.fg("dim", "░".repeat(Math.max(0, columns - offset)))}`,
		"",
	];
}

/** Allocate every terminal cell by token share, using largest remainders to keep the sum exact. */
function allocateMix(weights: number[], cellCount: number): number[] {
	const total = weights.reduce((sum, value) => sum + value, 0);
	if (total <= 0 || cellCount <= 0) return weights.map(() => 0);
	const exact = weights.map((value) => value / total * cellCount);
	const allocated = exact.map(Math.floor);
	let remaining = cellCount - allocated.reduce((sum, value) => sum + value, 0);
	const order = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
		.sort((a, b) => b.remainder - a.remainder);
	for (let i = 0; i < remaining; i++) {
		const target = order[i % order.length];
		if (target) allocated[target.index] = (allocated[target.index] ?? 0) + 1;
	}
	if (cellCount >= weights.filter((value) => value > 0).length) {
		for (let i = 0; i < allocated.length; i++) {
			if ((weights[i] ?? 0) === 0 || (allocated[i] ?? 0) > 0) continue;
			const donor = allocated.findIndex((count) => count > 1);
			if (donor >= 0) {
				allocated[donor] = (allocated[donor] ?? 0) - 1;
				allocated[i] = 1;
			}
		}
	}
	return allocated;
}

function sanitize(text: string): string {
	return text
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function format(tokens: number): string {
	return Math.round(tokens).toLocaleString("en-US");
}

function formatPercent(value: number): string {
	if (value > 0 && value < 0.05) return "<0.1%";
	return `${value.toFixed(1)}%`;
}
