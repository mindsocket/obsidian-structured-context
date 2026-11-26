import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Config } from "structured-context/api";
import { affectsOpenNote } from "../../src/space-scope";

const vault = join("/", "vault");
const at = (...parts: string[]) => join(vault, ...parts);
const config: Config = {
	spaces: [
		{ name: "notes", path: at("notes") },
		{ name: "tasks", path: at("tasks") },
	],
};

describe("affectsOpenNote", () => {
	it("is true for a change in the open note's space", () => {
		assert.equal(affectsOpenNote(config, at("notes", "a.md"), [at("notes", "sub", "b.md")]), true);
	});

	it("is false for a change outside the open note's space", () => {
		assert.equal(affectsOpenNote(config, at("notes", "a.md"), [at("tasks", "b.md")]), false);
	});

	it("does not treat a folder that only shares a name prefix as inside the space", () => {
		assert.equal(affectsOpenNote(config, at("notes", "a.md"), [at("notes-old", "b.md")]), false);
	});

	it("is true when either path of a rename is in the space", () => {
		assert.equal(affectsOpenNote(config, at("notes", "a.md"), [at("daily", "b.md"), at("notes", "b.md")]), true);
	});

	it("is false when the open note is in no space", () => {
		assert.equal(affectsOpenNote(config, at("daily", "a.md"), [at("daily", "b.md")]), false);
	});
});
