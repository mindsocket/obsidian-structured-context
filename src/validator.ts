import { validateFile, type Config } from "structured-context/api";
import type { FileValidationResult } from "structured-context/types";

export class Validator {
	constructor(private config: Config) {}

	async validate(filePath: string): Promise<FileValidationResult | null> {
		// Editor feedback: show cheap rule results even where an ancestor failed (includeGated). No judge is
		// passed, so semantic rules never run here.
		const result = await validateFile(filePath, this.config, { includeGated: true });
		if (result.inSpace === false) {
			return null;
		}
		return result;
	}
}
