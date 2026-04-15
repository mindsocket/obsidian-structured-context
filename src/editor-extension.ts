import {
	Decoration,
	DecorationSet,
	EditorView,
	WidgetType,
} from "@codemirror/view";
import {
	RangeSetBuilder,
	StateEffect,
	StateField,
	Text,
} from "@codemirror/state";
import type { FileValidationResult } from "structured-context/types";

type ValidationError = FileValidationResult["errors"][string];

const SCHEMA_ERROR_PREFIX = "schema:/" as const;

export const setValidationResult =
	StateEffect.define<FileValidationResult | null>();

class InlineErrorWidget extends WidgetType {
	constructor(private message: string) {
		super();
	}

	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "sctx-inline-error";
		span.setAttribute("aria-label", this.message);
		span.textContent = ` ⚠ ${this.message}`;
		return span;
	}

	eq(other: InlineErrorWidget): boolean {
		return this.message === other.message;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

class ErrorPanelWidget extends WidgetType {
	constructor(private errors: Array<ValidationError>) {
		super();
	}

	toDOM(): HTMLElement {
		const div = document.createElement("div");
		div.className = "sctx-error-panel";
		for (const err of this.errors) {
			const item = document.createElement("div");
			item.className = `sctx-error-item sctx-error-${err.kind}`;
			item.textContent = `⚠ ${err.message}`;
			div.appendChild(item);
		}
		return div;
	}

	eq(other: ErrorPanelWidget): boolean {
		return JSON.stringify(this.errors) === JSON.stringify(other.errors);
	}

	ignoreEvent(): boolean {
		return false;
	}
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

function buildDecorations(
	doc: Text,
	result: FileValidationResult
): DecorationSet {
	const errors = Object.entries(result.errors);
	if (errors.length === 0) return Decoration.none;

	const fm = parseFrontmatter(doc);
	const builder = new RangeSetBuilder<Decoration>();

	const propErrors: Array<{ lineNum: number; error: ValidationError }> = [];
	const docErrors: Array<ValidationError> = [];

	for (const [key, error] of errors) {
		const prop = extractProperty(key);
		const lineNum = prop ? fm?.propertyLines.get(prop) : undefined;
		if (lineNum !== undefined) {
			propErrors.push({ lineNum, error });
		} else {
			docErrors.push(error);
		}
	}

	// RangeSetBuilder requires ranges in non-decreasing `from` order
	propErrors.sort((a, b) => a.lineNum - b.lineNum);

	const seenLines = new Set<number>();
	for (const { lineNum, error } of propErrors) {
		const line = doc.line(lineNum);
		if (!seenLines.has(lineNum)) {
			seenLines.add(lineNum);
			builder.add(
				line.from,
				line.from,
				Decoration.line({ class: "sctx-error-line" })
			);
		}
		// Inline widget at end of line (side:1 = after existing content)
		builder.add(
			line.to,
			line.to,
			Decoration.widget({ widget: new InlineErrorWidget(error.message), side: 1 })
		);
	}

	if (docErrors.length > 0) {
		const insertPos = fm ? doc.line(fm.endLine).to : 0;
		builder.add(
			insertPos,
			insertPos,
			Decoration.widget({
				widget: new ErrorPanelWidget(docErrors),
				side: 1,
				block: true,
			})
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
				decorations = effect.value
					? buildDecorations(tr.state.doc, effect.value)
					: Decoration.none;
			}
		}
		return decorations;
	},
	provide: (field) => EditorView.decorations.from(field),
});