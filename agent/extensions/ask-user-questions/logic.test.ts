import test from "node:test";
import assert from "node:assert/strict";
import { createQuestionFlow } from "./logic.ts";

test("choosing answers advances through unanswered questions and returns the completed result", () => {
	const flow = createQuestionFlow([
		{ question: "Color?", label: "Color", multi: false, options: [{ label: "Blue", recommended: true }] },
		{ question: "Name?", label: "Name", multi: false, options: [] },
	]);

	flow.dispatch({ type: "confirm" });
	assert.equal(flow.snapshot().currentTab, 1);
	flow.dispatch({ type: "set-text", value: "Ada" });
	flow.dispatch({ type: "confirm" });
	assert.equal(flow.snapshot().currentTab, 2);
	flow.dispatch({ type: "confirm" });
	assert.deepEqual(flow.snapshot().result, {
		cancelled: false,
		answers: [
			{ question: "Color?", label: "Color", answer: "Blue", recommended: true },
			{ question: "Name?", label: "Name", answer: "Ada", recommended: false },
		],
	});
});

test("text drafts survive tab changes and become the submitted answer", () => {
	const flow = createQuestionFlow([
		{ question: "Name?", label: "Name", multi: false, options: [] },
		{ question: "Color?", label: "Color", multi: false, options: [{ label: "Blue", recommended: false }] },
	]);

	flow.dispatch({ type: "set-text", value: " Ada " });
	flow.dispatch({ type: "move-tab", direction: 1 });
	flow.dispatch({ type: "move-tab", direction: -1 });
	assert.deepEqual(flow.snapshot().answers[0], ["Ada"]);
	flow.dispatch({ type: "confirm" });
	assert.equal(flow.snapshot().currentTab, 1);
});

test("automatic advancement skips answered tabs", () => {
	const flow = createQuestionFlow([
		{ question: "First?", label: "First", multi: false, options: [{ label: "A", recommended: false }] },
		{ question: "Second?", label: "Second", multi: false, options: [] },
		{ question: "Third?", label: "Third", multi: false, options: [{ label: "C", recommended: false }] },
	]);

	flow.dispatch({ type: "confirm" });
	flow.dispatch({ type: "set-text", value: "B" });
	flow.dispatch({ type: "move-tab", direction: 1 });
	flow.dispatch({ type: "move-tab", direction: -2 });
	flow.dispatch({ type: "confirm" });
	assert.equal(flow.snapshot().currentTab, 2);
});

test("Submit stays disabled until every question has an answer", () => {
	const flow = createQuestionFlow([
		{ question: "Color?", label: "Color", multi: false, options: [{ label: "Blue", recommended: false }] },
	]);

	flow.dispatch({ type: "move-tab", direction: 1 });
	flow.dispatch({ type: "confirm" });
	assert.equal(flow.snapshot().allAnswered, false);
	assert.equal(flow.snapshot().result, undefined);
});

test("cancelling returns only answers already given", () => {
	const flow = createQuestionFlow([
		{ question: "Color?", label: "Color", multi: false, options: [{ label: "Blue", recommended: false }] },
		{ question: "Name?", label: "Name", multi: false, options: [] },
	]);

	flow.dispatch({ type: "confirm" });
	flow.dispatch({ type: "cancel" });
	assert.deepEqual(flow.snapshot().result, {
		cancelled: true,
		answers: [{ question: "Color?", label: "Color", answer: "Blue", recommended: false }],
	});
});

test("Other text replaces an earlier option answer", () => {
	const flow = createQuestionFlow([
		{ question: "Choice?", label: "Choice", multi: false, options: [{ label: "A", recommended: true }] },
	]);

	flow.dispatch({ type: "confirm" });
	flow.dispatch({ type: "move-tab", direction: -1 });
	flow.dispatch({ type: "move-option", direction: 1 });
	assert.equal(flow.snapshot().isTextQuestion, true);
	flow.dispatch({ type: "set-text", value: "Custom" });
	flow.dispatch({ type: "confirm" });
	flow.dispatch({ type: "confirm" });
	assert.deepEqual(flow.snapshot().result?.answers[0], {
		question: "Choice?", label: "Choice", answer: "Custom", recommended: false,
	});
});

test("multi-select answers toggle independently and retain selection order", () => {
	const flow = createQuestionFlow([
		{ question: "Tools?", label: "Tools", multi: true, options: [{ label: "A", recommended: false }, { label: "B", recommended: true }] },
	]);

	flow.dispatch({ type: "toggle-selection" });
	flow.dispatch({ type: "toggle-selection" });
	assert.equal(flow.snapshot().answers[0], undefined);
	flow.dispatch({ type: "toggle-selection" });
	flow.dispatch({ type: "move-option", direction: 1 });
	flow.dispatch({ type: "toggle-selection" });
	flow.dispatch({ type: "move-tab", direction: 1 });
	flow.dispatch({ type: "confirm" });
	assert.deepEqual(flow.snapshot().result?.answers[0], {
		question: "Tools?", label: "Tools", answer: ["A", "B"], recommended: true,
	});
});
