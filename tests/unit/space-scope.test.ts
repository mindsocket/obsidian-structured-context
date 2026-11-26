import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Config } from "structured-context/api";
import { spaceOf } from "../../src/space-scope";

const vault = join("/", "vault");
const at = (...parts: string[]) => join(vault, ...parts);
const notes = { name: "notes", path: at("notes") };
const config: Config = { spaces: [notes, { name: "everything", path: vault }] };

describe("spaceOf", () => {
	it("takes the first space whose folder holds the file, as validateFile does", () => {
		assert.equal(spaceOf(config, at("notes", "sub", "a.md")), "notes");
		assert.equal(spaceOf(config, at("daily", "a.md")), "everything");
	});

	it("does not treat a folder that only shares a name prefix as inside the space", () => {
		assert.equal(spaceOf({ spaces: [notes] }, at("notes-old", "a.md")), undefined);
	});
});
