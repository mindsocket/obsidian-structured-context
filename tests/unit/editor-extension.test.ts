import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorState, Text } from "@codemirror/state";
import type { FileValidationResult } from "structured-context/types";
import { planDecorations, setValidationResult, validationField } from "../../src/editor-extension";

type Issue = FileValidationResult["errors"][string];
const issue = (message: string, extra: Partial<Issue> = {}): Issue => ({ kind: "schema", message, ...extra });

function result(errors: Record<string, Issue> = {}, warnings: Record<string, Issue> = {}): FileValidationResult {
	return {
		file: "/vault/n.md",
		label: "n.md",
		space: "s",
		errors,
		errorCount: Object.keys(errors).length,
		warnings,
		warningCount: Object.keys(warnings).length,
		inSpace: true,
	};
}

const DOC = Text.of(["---", "type: goal", "status: nope", "title: T", "---", "", "Body"]);

describe("planDecorations", () => {
	it("places a schema issue on the line of its property", () => {
		const plan = planDecorations(DOC, result({ "schema:/status:enum:active": issue("status: must be one of active") }));
		assert.deepEqual(plan.lines, [{ line: 3, issues: [{ severity: "error", message: "status: must be one of active" }] }]);
		assert.deepEqual(plan.panel, []);
	});

	it("places an issue on the note's own key for a field renamed by fieldMap", () => {
		const doc = Text.of(["---", "record_type: goal", "title: T", "---"]);
		const plan = planDecorations(doc, result({ "schema:/type:enum": issue("type: must be one of") }), { record_type: "type" });
		assert.deepEqual(plan.lines.map(l => l.line), [2]);
		assert.deepEqual(plan.panel, []);
	});

	it("reads the property from nested and constraint-suffixed schema keys", () => {
		const plan = planDecorations(
			DOC,
			result({ "schema:/title/0:type": issue("a"), "schema:/type": issue("b") }),
		);
		assert.deepEqual(plan.lines.map(l => l.line), [2, 4]);
	});

	it("puts issues without a property in the panel after the frontmatter", () => {
		const plan = planDecorations(DOC, result({ "rule:my-rule": issue("rule failed", { kind: "rule" }) }));
		assert.equal(plan.panelAfterLine, 5);
		assert.deepEqual(plan.panel, [{ severity: "error", message: "rule failed" }]);
	});

	it("puts a schema issue for a property with no line in the panel", () => {
		const plan = planDecorations(DOC, result({ "schema:/missing:required": issue("missing is required") }));
		assert.equal(plan.lines.length, 0);
		assert.equal(plan.panel.length, 1);
	});

	it("shows warnings and info as distinct severities", () => {
		const plan = planDecorations(
			DOC,
			result(
				{},
				{
					"rule:warn": issue("warned", { kind: "rule", severity: "warning" }),
					"rule:info": issue("fyi", { kind: "rule", severity: "info" }),
				},
			),
		);
		assert.deepEqual(plan.panel.map(p => p.severity), ["warning", "info"]);
	});

	it("lists errors before warnings before info, on a line and in the panel", () => {
		const plan = planDecorations(
			DOC,
			result(
				{ "schema:/status:a": issue("err"), "rule:e": issue("rule err", { kind: "rule", severity: "error" }) },
				{
					"rule:i": issue("info", { kind: "rule", severity: "info" }),
					"rule:w": issue("warn", { kind: "rule", severity: "warning" }),
					"schema:/status:b": issue("line warn"),
					"schema:/status:c": issue("line info", { severity: "info" }),
				},
			),
		);
		assert.deepEqual(plan.lines[0]?.issues.map(i => i.severity), ["error", "warning", "info"]);
		assert.deepEqual(plan.panel.map(i => i.severity), ["error", "warning", "info"]);
	});

	it("sends everything to the panel at the top when there is no frontmatter", () => {
		const plan = planDecorations(Text.of(["No frontmatter", "here"]), result({ "schema:/status:x": issue("x") }));
		assert.equal(plan.lines.length, 0);
		assert.equal(plan.panelAfterLine, 0);
		assert.equal(plan.panel.length, 1);
	});

	it("ignores an unterminated frontmatter block", () => {
		const plan = planDecorations(Text.of(["---", "status: x", "no end"]), result({ "schema:/status:x": issue("x") }));
		assert.equal(plan.lines.length, 0);
		assert.equal(plan.panel.length, 1);
	});

	it("plans nothing for a clean result", () => {
		assert.deepEqual(planDecorations(DOC, result()), { lines: [], panel: [], panelAfterLine: 5 });
	});
});

describe("validationField", () => {
	const rangesOf = (state: EditorState) => {
		const out: Array<{ from: number; block: boolean; cls?: string }> = [];
		const cursor = state.field(validationField).iter();
		while (cursor.value) {
			const spec = cursor.value.spec as { block?: boolean; class?: string };
			out.push({ from: cursor.from, block: !!spec.block, cls: spec.class });
			cursor.next();
		}
		return out;
	};
	const start = () => EditorState.create({ doc: DOC, extensions: [validationField] });

	it("starts empty", () => {
		assert.deepEqual(rangesOf(start()), []);
	});

	it("adds a line highlight, an inline widget per issue and a block panel, in document order", () => {
		const state = start().update({
			effects: setValidationResult.of({
				result: result(
					{ "schema:/status:a": issue("err"), "rule:r": issue("rule", { kind: "rule" }) },
					{ "schema:/status:b": issue("warn") },
				),
			}),
		}).state;
		const ranges = rangesOf(state);
		assert.equal(ranges.filter(r => r.cls === "sctx-issue-line sctx-error").length, 1);
		assert.equal(ranges.filter(r => !r.block && r.cls === undefined).length, 2);
		assert.equal(ranges.filter(r => r.block).length, 1);
		assert.deepEqual(ranges.map(r => r.from), [...ranges.map(r => r.from)].sort((a, b) => a - b));
	});

	it("clears when the result is null", () => {
		const withIssues = start().update({
			effects: setValidationResult.of({ result: result({ "rule:r": issue("rule", { kind: "rule" }) }) }),
		}).state;
		assert.equal(rangesOf(withIssues).length, 1);
		assert.deepEqual(rangesOf(withIssues.update({ effects: setValidationResult.of(null) }).state), []);
	});

	it("tints a line by its worst severity", () => {
		const state = start().update({
			effects: setValidationResult.of({ result: result({}, { "schema:/status:b": issue("warn") }) }),
		}).state;
		assert.ok(rangesOf(state).some(r => r.cls === "sctx-issue-line sctx-warning"));
	});
});
