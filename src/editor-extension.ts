import { RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { FileValidationResult } from "structured-context/types";

/** How an issue is shown. Info is a rule violation of `info` severity, which structured-context reports among its warnings. */
export type Severity = "error" | "warning" | "info";

const SEVERITY_ORDER: Severity[] = ["error", "warning", "info"];
const GLYPH: Record<Severity, string> = { error: "✖", warning: "⚠", info: "ⓘ" };

const SCHEMA_ERROR_PREFIX = "schema:/" as const;

/** The markdown plugin's fieldMap for a space: a file's frontmatter key → the schema's field name. */
export type FieldMap = Record<string, string>;

/** A validation result to show, with the fieldMap that maps its field names back to the note's own keys. */
export interface ShownResult {
	result: FileValidationResult;
	fieldMap?: FieldMap;
}

export const setValidationResult = StateEffect.define<ShownResult | null>();

export interface PlannedIssue {
	severity: Severity;
	message: string;
}

/** What to draw for a validation result: issues tied to a frontmatter line, and the rest. */
export interface DecorationPlan {
	/** Frontmatter lines (1-indexed) with issues, errors first. */
	lines: Array<{ line: number; issues: PlannedIssue[] }>;
	/** Issues not tied to a property, shown in a panel after the frontmatter. */
	panel: PlannedIssue[];
	/** 1-indexed line the panel follows, or 0 for the top of the document. */
	panelAfterLine: number;
}

class InlineIssueWidget extends WidgetType {
	constructor(readonly issue: PlannedIssue) {
		super();
	}

	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = `sctx-inline-issue sctx-${this.issue.severity}`;
		span.setAttribute("aria-label", this.issue.message);
		span.textContent = ` ${GLYPH[this.issue.severity]} ${this.issue.message}`;
		return span;
	}

	eq(other: InlineIssueWidget): boolean {
		return this.issue.severity === other.issue.severity && this.issue.message === other.issue.message;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

class IssuePanelWidget extends WidgetType {
	constructor(readonly issues: PlannedIssue[]) {
		super();
	}

	toDOM(): HTMLElement {
		const div = document.createElement("div");
		div.className = `sctx-issue-panel sctx-${worst(this.issues)}`;
		for (const issue of this.issues) {
			const item = document.createElement("div");
			item.className = `sctx-issue-item sctx-${issue.severity}`;
			const glyph = document.createElement("span");
			glyph.className = "sctx-glyph";
			glyph.textContent = GLYPH[issue.severity];
			item.append(glyph, ` ${issue.message}`);
			div.appendChild(item);
		}
		return div;
	}

	eq(other: IssuePanelWidget): boolean {
		return JSON.stringify(this.issues) === JSON.stringify(other.issues);
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function worst(issues: PlannedIssue[]): Severity {
	return SEVERITY_ORDER.find((sev) => issues.some((i) => i.severity === sev)) ?? "info";
}

function bySeverity(a: PlannedIssue, b: PlannedIssue): number {
	return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}

const MAX_FRONTMATTER_LINES = 200;

interface FrontmatterInfo {
	endLine: number;
	propertyLines: Map<string, number>;
}

function parseFrontmatter(doc: Text): FrontmatterInfo | null {
	if (doc.lines < 3) return null;
	if (doc.line(1).text.trim() !== "---") return null;

	const propertyLines = new Map<string, number>();
	let endLine: number | null = null;

	for (let i = 2; i <= Math.min(doc.lines, MAX_FRONTMATTER_LINES); i++) {
		const text = doc.line(i).text;
		if (text.trim() === "---") {
			endLine = i;
			break;
		}
		const match = text.match(/^([\w][\w-]*)\s*:/);
		if (match?.[1]) {
			propertyLines.set(match[1], i);
		}
	}

	if (endLine === null) return null;
	return { endLine, propertyLines };
}

/**
 * Extract the top-level YAML property name from a schema error key.
 * Schema keys have the form `schema:/property:constraint:value`.
 * Returns null for non-schema errors (rules, broken-link, hierarchy, duplicate).
 */
function extractProperty(errorKey: string): string | null {
	if (!errorKey.startsWith(SCHEMA_ERROR_PREFIX)) return null;
	const path = errorKey.slice(SCHEMA_ERROR_PREFIX.length);
	const end = path.search(/[/:]/);
	const prop = end === -1 ? path : path.slice(0, end);
	return prop || null;
}

function collectIssues(result: FileValidationResult): Array<{ key: string; issue: PlannedIssue }> {
	const out: Array<{ key: string; issue: PlannedIssue }> = [];
	for (const [key, issue] of Object.entries(result.errors)) {
		out.push({ key, issue: { severity: "error", message: issue.message } });
	}
	for (const [key, issue] of Object.entries(result.warnings)) {
		out.push({ key, issue: { severity: issue.severity === "info" ? "info" : "warning", message: issue.message } });
	}
	return out;
}

export function planDecorations(doc: Text, result: FileValidationResult, fieldMap: FieldMap = {}): DecorationPlan {
	const fm = parseFrontmatter(doc);
	// Issues name the schema's fields; the note may use other keys for them
	const fileKey = new Map(Object.entries(fieldMap).map(([file, canonical]) => [canonical, file]));
	const byLine = new Map<number, PlannedIssue[]>();
	const panel: PlannedIssue[] = [];

	for (const { key, issue } of collectIssues(result)) {
		const prop = extractProperty(key);
		const lineNum = prop ? fm?.propertyLines.get(fileKey.get(prop) ?? prop) : undefined;
		if (lineNum === undefined) {
			panel.push(issue);
		} else {
			byLine.set(lineNum, [...(byLine.get(lineNum) ?? []), issue]);
		}
	}

	return {
		lines: [...byLine.entries()]
			.sort(([a], [b]) => a - b)
			.map(([line, issues]) => ({ line, issues: issues.sort(bySeverity) })),
		panel: panel.sort(bySeverity),
		panelAfterLine: fm?.endLine ?? 0,
	};
}

function buildDecorations(doc: Text, { result, fieldMap }: ShownResult): DecorationSet {
	const plan = planDecorations(doc, result, fieldMap);
	const builder = new RangeSetBuilder<Decoration>();

	// RangeSetBuilder requires ranges in non-decreasing `from` order, which the plan's line order gives
	for (const { line: lineNum, issues } of plan.lines) {
		const line = doc.line(lineNum);
		builder.add(line.from, line.from, Decoration.line({ class: `sctx-issue-line sctx-${worst(issues)}` }));
		for (const issue of issues) {
			// side:1 = after existing content
			builder.add(line.to, line.to, Decoration.widget({ widget: new InlineIssueWidget(issue), side: 1 }));
		}
	}

	if (plan.panel.length > 0) {
		const insertPos = plan.panelAfterLine > 0 ? doc.line(plan.panelAfterLine).to : 0;
		builder.add(
			insertPos,
			insertPos,
			Decoration.widget({ widget: new IssuePanelWidget(plan.panel), side: 1, block: true }),
		);
	}

	return builder.finish();
}

export const validationField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, tr) {
		decorations = decorations.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(setValidationResult)) {
				decorations = effect.value ? buildDecorations(tr.state.doc, effect.value) : Decoration.none;
			}
		}
		return decorations;
	},
	provide: (field) => EditorView.decorations.from(field),
});
