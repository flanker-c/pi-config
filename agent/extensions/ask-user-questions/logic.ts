export interface QuestionFlowOption {
	label: string;
	recommended?: boolean;
}

export interface QuestionFlowQuestion {
	question: string;
	label: string;
	multi: boolean;
	options: QuestionFlowOption[];
}

export type QuestionFlowEvent =
	| { type: "move-tab"; direction: number }
	| { type: "move-option"; direction: number }
	| { type: "set-text"; value: string }
	| { type: "toggle-selection" }
	| { type: "confirm" }
	| { type: "cancel" };

export interface QuestionFlowResult {
	cancelled: boolean;
	answers: Array<{
		question: string;
		label: string;
		answer: string | string[];
		recommended: boolean;
	}>;
}

export interface QuestionFlowSnapshot {
	currentTab: number;
	optionIndex: number;
	answers: Array<string[] | undefined>;
	allAnswered: boolean;
	isTextQuestion: boolean;
	result: QuestionFlowResult | undefined;
}

function toggleOption(selected: string[] | undefined, option: string): string[] | undefined {
	const current = selected ?? [];
	const next = current.includes(option)
		? current.filter((value) => value !== option)
		: [...current, option];
	return next.length > 0 ? next : undefined;
}

function findNextUnanswered(answers: Array<string[] | undefined>, currentIndex: number): number | undefined {
	for (let step = 1; step < answers.length; step++) {
		const candidate = (currentIndex + step) % answers.length;
		if (answers[candidate] === undefined) return candidate;
	}
	return answers.every((answer) => answer !== undefined) ? answers.length : undefined;
}

function answerForResult(answer: string[] | undefined, multi: boolean): string | string[] | undefined {
	if (answer === undefined) return undefined;
	return multi ? [...answer] : answer[0];
}

/** Own the question flow's state and transitions; the TUI only translates events and renders snapshots. */
export function createQuestionFlow(questions: QuestionFlowQuestion[]): {
	dispatch(event: QuestionFlowEvent): QuestionFlowSnapshot;
	snapshot(): QuestionFlowSnapshot;
} {
	const answers: Array<string[] | undefined> = questions.map(() => undefined);
	let currentTab = 0;
	let optionIndex = questions[0]?.options.length ? 0 : -1;
	let result: QuestionFlowResult | undefined;
	const submitTab = questions.length;

	const isTextQuestion = (index: number): boolean => {
		const question = questions[index];
		return question !== undefined && (question.options.length === 0 || (!question.multi && optionIndex === question.options.length));
	};
	const allAnswered = (): boolean => answers.every((answer) => answer !== undefined);
	const moveTo = (nextTab: number): void => {
		currentTab = (nextTab + submitTab + 1) % (submitTab + 1);
		if (currentTab < submitTab) {
			const question = questions[currentTab];
			const answer = answers[currentTab];
			const selectedOption = answer === undefined
				? -1
				: question.options.findIndex((option) => answer.includes(option.label));
			optionIndex = question.options.length === 0
				? -1
				: selectedOption >= 0
					? selectedOption
					: answer !== undefined && !question.multi
						? question.options.length
						: 0;
		} else optionIndex = -1;
	};
	const advance = (): void => {
		const nextTab = findNextUnanswered(answers, currentTab);
		if (nextTab !== undefined) moveTo(nextTab);
	};
	const buildResult = (cancelled: boolean): QuestionFlowResult => ({
		cancelled,
		answers: questions.flatMap((question, index) => {
			const answer = answers[index];
			if (answer === undefined) return [];
			const selected = question.options.filter((option) => answer.includes(option.label));
			return [{
				question: question.question,
				label: question.label,
				answer: answerForResult(answer, question.multi)!,
				recommended: selected.some((option) => option.recommended),
			}];
		}),
	});

	const snapshot = (): QuestionFlowSnapshot => ({
		currentTab,
		optionIndex,
		answers: answers.map((answer) => answer === undefined ? undefined : [...answer]),
		allAnswered: allAnswered(),
		isTextQuestion: currentTab < submitTab && isTextQuestion(currentTab),
		result,
	});

	const dispatch = (event: QuestionFlowEvent): QuestionFlowSnapshot => {
		if (result) return snapshot();
		switch (event.type) {
			case "move-tab":
				moveTo(currentTab + event.direction);
				break;
			case "move-option": {
				const question = questions[currentTab];
				if (question?.options.length) {
					const max = question.multi ? question.options.length - 1 : question.options.length;
					optionIndex = Math.max(0, Math.min(max, optionIndex + event.direction));
				}
				break;
			}
			case "set-text":
				if (currentTab < submitTab && isTextQuestion(currentTab)) {
					const text = event.value.trim();
					answers[currentTab] = text ? [text] : undefined;
				}
				break;
			case "toggle-selection": {
				const question = questions[currentTab];
				if (question?.multi && question.options[optionIndex]) {
					answers[currentTab] = toggleOption(answers[currentTab], question.options[optionIndex].label);
				}
				break;
			}
			case "confirm":
				if (currentTab === submitTab) {
					if (allAnswered()) result = buildResult(false);
				} else if (isTextQuestion(currentTab)) {
					if (answers[currentTab] !== undefined) advance();
				} else {
					const question = questions[currentTab];
					if (question.multi) {
						if (answers[currentTab] !== undefined) advance();
					} else if (question.options[optionIndex]) {
						answers[currentTab] = [question.options[optionIndex].label];
						advance();
					}
				}
				break;
			case "cancel":
				result = buildResult(true);
				break;
		}
		return snapshot();
	};

	return { dispatch, snapshot };
}
