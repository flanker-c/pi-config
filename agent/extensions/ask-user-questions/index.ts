import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { createQuestionFlow, type QuestionFlowEvent } from "./logic.ts";

const OptionSchema = Type.Object({
	label: Type.String({ description: "Option text shown to the user" }),
	recommended: Type.Optional(
		Type.Boolean({ description: "Set true when this is the option you recommend" }),
	),
});

const QuestionSchema = Type.Object({
	question: Type.String({ description: "A concise question to ask the user" }),
	label: Type.Optional(
		Type.String({ description: "Short 2-3 word title for this question's tab" }),
	),
	options: Type.Optional(
		Type.Array(Type.Union([Type.String(), OptionSchema]), {
			description: "Optional answer options. Mark recommended options with recommended: true. Omit options or use an empty array for free text.",
		}),
	),
	multi: Type.Optional(
		Type.Boolean({
			description: "Set true only when the user should be able to select multiple options for this question. In that case, show checkboxes. Leave false/omit for ordinary single-choice questions. This flag is only for questions with options, not free-text questions.",
		}),
	),
});

const Parameters = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: 10,
		description: "Questions to ask the user, presented as tabs",
	}),
});

interface Answer {
	question: string;
	label: string;
	answer: string | string[];
	recommended: boolean;
}

export default function askUserQuestions(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user_questions",
		label: "Ask user questions",
		description:
			"MANDATORY: Whenever you need to ask the user anything, you MUST call this tool. Never ask questions directly in assistant text or use another tool/UI to collect an answer. This applies to clarification, preferences, decisions, and approvals. Ask all currently needed questions in one call when practical. Give each question a short 2-3 word label for its tab. Options may be strings or objects with label and recommended: true for the option you recommend. Omit options to request free text. Set multi: true only when the question should allow selecting more than one option; the UI will show checkboxes. Leave it unset for normal single-answer questions and do not use it for free-text questions. The final Submit tab reviews the answers and requires Enter to confirm.",
		parameters: Parameters,
		exposure: "model-only",
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Cannot ask the user questions: no interactive UI is available." }],
					details: { answers: [], cancelled: false },
				};
			}

			const questions = params.questions.map((item, index) => ({
				question: item.question,
				label: item.label?.trim() || `Q${index + 1}`,
				multi: item.multi === true && (item.options?.length ?? 0) > 0,
				options: (item.options ?? []).map((option) =>
					typeof option === "string" ? { label: option, recommended: false } : option,
				).filter((option) => option.label.trim().length > 0),
			}));

			const result = await ctx.ui.custom<{ answers: Answer[]; cancelled: boolean }>((tui, theme, _kb, done) => {
				const submitTab = questions.length;
				const flow = createQuestionFlow(questions);
				let { currentTab, optionIndex, answers } = flow.snapshot();
				let cachedLines: string[] | undefined;
				let suppressEditorChange = false;
				const dispatch = (event: QuestionFlowEvent) => {
					flow.dispatch(event);
					({ currentTab, optionIndex, answers } = flow.snapshot());
				};
				const isTextQuestion = () => flow.snapshot().isTextQuestion;
				const allAnswered = () => flow.snapshot().allAnswered;
				const editorTheme: EditorTheme = {
					borderColor: (value) => theme.fg("accent", value),
					selectList: {
						selectedPrefix: (value) => theme.fg("accent", value),
						selectedText: (value) => theme.fg("accent", value),
						description: (value) => theme.fg("muted", value),
						scrollInfo: (value) => theme.fg("dim", value),
						noMatch: (value) => theme.fg("warning", value),
					},
				};
				const editor = new Editor(tui, editorTheme);

				const refresh = () => {
					cachedLines = undefined;
					tui.requestRender();
				};
				const loadEditorForTab = () => {
					const question = currentTab < submitTab ? questions[currentTab] : undefined;
					const answer = currentTab < submitTab ? answers[currentTab] : undefined;
					const draft = question?.options.some((option) => answer?.includes(option.label)) ? "" : answer?.[0] ?? "";
					suppressEditorChange = true;
					editor.setText(draft);
					suppressEditorChange = false;
				};
				const switchTab = (nextTab: number, saveCurrentAnswer = true) => {
					if (saveCurrentAnswer && currentTab < submitTab && isTextQuestion()) {
						dispatch({ type: "set-text", value: editor.getText() });
					}
					dispatch({ type: "move-tab", direction: nextTab - currentTab });
					loadEditorForTab();
					refresh();
				};
				const advanceToNextUnanswered = (saveCurrentAnswer = true) => {
					if (saveCurrentAnswer && currentTab < submitTab && isTextQuestion()) {
						dispatch({ type: "set-text", value: editor.getText() });
					}
					dispatch({ type: "confirm" });
					loadEditorForTab();
					refresh();
				};
				const submit = (cancelled: boolean) => {
					if (cancelled) dispatch({ type: "cancel" });
					else {
						if (currentTab < submitTab && isTextQuestion()) dispatch({ type: "set-text", value: editor.getText() });
						dispatch({ type: "confirm" });
					}
					done(flow.snapshot().result ?? { answers: [], cancelled });
				};

				editor.onChange = (value) => {
					if (!suppressEditorChange && currentTab < submitTab) {
						dispatch({ type: "set-text", value });
						refresh();
					}
				};
				editor.onSubmit = (value) => {
					if (currentTab < submitTab) {
						dispatch({ type: "set-text", value });
						if (answers[currentTab] !== undefined) advanceToNextUnanswered(false);
						else refresh();
					}
				};

				function handleInput(data: string) {
					const isEditingTextAnswer = currentTab < submitTab && isTextQuestion();
					if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
						if (isEditingTextAnswer) {
							editor.handleInput(data);
							refresh();
						} else {
							switchTab(currentTab + (matchesKey(data, Key.left) ? -1 : 1));
						}
						return;
					}
					if (matchesKey(data, Key.shift("tab"))) {
						switchTab(currentTab - 1);
						return;
					}
					if (matchesKey(data, Key.tab)) {
						switchTab(currentTab + 1);
						return;
					}
					if (matchesKey(data, Key.escape)) {
						submit(true);
						return;
					}

					if (currentTab === submitTab) {
						if (matchesKey(data, Key.enter) && allAnswered()) submit(false);
						return;
					}

					const question = questions[currentTab];
					if (question.options.length === 0 || (!question.multi && optionIndex === question.options.length)) {
						editor.handleInput(data);
						refresh();
						return;
					}
					if (matchesKey(data, Key.up)) {
						dispatch({ type: "move-option", direction: -1 });
						loadEditorForTab();
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						dispatch({ type: "move-option", direction: 1 });
						loadEditorForTab();
						refresh();
						return;
					}
					if (question.multi && data === " ") {
						dispatch({ type: "toggle-selection" });
						refresh();
						return;
					}
					if (matchesKey(data, Key.enter)) {
						if (question.multi) {
							if (answers[currentTab] !== undefined) advanceToNextUnanswered();
						} else if (optionIndex === question.options.length) {
							suppressEditorChange = true;
							const answer = answers[currentTab];
							editor.setText(question.options.some((option) => answer?.includes(option.label)) ? "" : answer?.[0] ?? "");
							suppressEditorChange = false;
						} else {
							dispatch({ type: "confirm" });
							loadEditorForTab();
						}
						refresh();
					}
				}

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;
					const lines: string[] = [];
					const renderWidth = Math.max(1, width);
					const addWrapped = (value: string) => lines.push(...wrapTextWithAnsi(value, renderWidth));
					const addWrappedWithPrefix = (prefix: string, value: string) => {
						const prefixWidth = visibleWidth(prefix);
						if (prefixWidth >= renderWidth) {
							addWrapped(prefix + value);
							return;
						}
						const wrapped = wrapTextWithAnsi(value, renderWidth - prefixWidth);
					for (let index = 0; index < wrapped.length; index++) {
						lines.push(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${wrapped[index]}`);
					}
					};

					lines.push(theme.fg("accent", "─".repeat(renderWidth)));
					const tabs = questions.map((item, index) => {
						const active = currentTab === index;
						const answered = answers[index] !== undefined;
						const label = ` ${answered ? "✓" : "○"} ${item.label} `;
						return active
							? theme.bg("selectedBg", theme.fg("text", label))
							: theme.fg(answered ? "success" : "muted", label);
					});
					const submitLabel = " Submit ";
					tabs.push(currentTab === submitTab
						? theme.bg("selectedBg", theme.fg("text", submitLabel))
						: theme.fg(allAnswered() ? "success" : "dim", submitLabel));
					addWrappedWithPrefix(" ", tabs.join("  "));
					lines.push("");

					if (currentTab === submitTab) {
						addWrappedWithPrefix(" ", theme.fg("accent", theme.bold("Review your answers")));
						lines.push("");
						questions.forEach((item, index) => {
							const answer = answers[index];
							const recommended = item.options.some((option) => answer?.includes(option.label) && option.recommended);
							addWrappedWithPrefix(
								" ",
								`${theme.fg("muted", `${item.label}: `)}${theme.fg(answer === undefined ? "warning" : "text", answer ? (item.multi ? answer.join(", ") : answer[0]) : "(not answered)")}${recommended ? theme.fg("success", " ★ Recommended") : ""}`,
							);
						});
						lines.push("");
						addWrappedWithPrefix(
							" ",
							allAnswered()
								? theme.fg("success", "Press Enter to submit your answers")
								: theme.fg("warning", "Answer every question before submitting"),
						);
					} else {
						const question = questions[currentTab];
						addWrappedWithPrefix(" ", theme.fg("text", question.question));
						lines.push("");
						if (question.options.length > 0) {
							question.options.forEach((option, index) => {
								const selected = optionIndex === index;
								const chosen = answers[currentTab]?.includes(option.label) ?? false;
								const prefix = selected ? theme.fg("accent", "> ") : "  ";
								const checkbox = question.multi ? (chosen ? "[✓] " : "[ ] ") : (chosen ? "✓ " : "  ");
								const label = `${checkbox}${option.label}${option.recommended ? theme.fg("success", " ★ Recommended") : ""}`;
								addWrappedWithPrefix(prefix, theme.fg(selected ? "accent" : "text", label));
							});
							if (!question.multi) {
								const otherIndex = question.options.length;
								const otherSelected = optionIndex === otherIndex;
								addWrappedWithPrefix(
									otherSelected ? theme.fg("accent", "> ") : "  ",
									theme.fg(otherSelected ? "accent" : "text", `${answers[currentTab] && !question.options.some((option) => answers[currentTab]?.includes(option.label)) ? "✓ " : "  "}Other (type an answer…)`),
								);
							}
						}
						if (question.options.length === 0 || (!question.multi && optionIndex === question.options.length)) {
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("muted", "Your answer:"));
							for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
						}
					}

					lines.push("");
					addWrappedWithPrefix(" ", theme.fg("dim", "←/→ or Tab: switch tab • ↑/↓: choose • Space: toggle checkbox • Enter: save/submit • Esc: cancel"));
					lines.push(theme.fg("accent", "─".repeat(renderWidth)));
					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate: () => { cachedLines = undefined; editor.invalidate(); },
					handleInput,
				};
			});

			return {
				content: [{
					type: "text",
					text: result.cancelled
						? `The user cancelled. Answers so far: ${formatAnswers(result.answers)}`
						: formatAnswers(result.answers),
				}],
				details: result,
			};
		},
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nUSER QUESTION POLICY (MANDATORY): Whenever you need an answer, clarification, preference, decision, or approval from the user, call the ask_user_questions tool. Do not ask the user questions in ordinary assistant messages, and do not collect answers through another tool or UI. Gather the questions that are currently necessary into a single tool call when practical. After receiving the answers, continue the task; do not ask the same question again unless new information makes it necessary.`,
	}));
}

function formatAnswers(answers: Answer[]): string {
	return answers
		.map(({ label, answer, recommended }) => `${label}: ${Array.isArray(answer) ? answer.join(", ") : answer}${recommended ? " (recommended)" : ""}`)
		.join("\n");
}
