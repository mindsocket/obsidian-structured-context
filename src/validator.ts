import { loadConfig, setConfigPath, validateFile, type Config } from "structured-context/api";
import type { FileValidationResult } from "structured-context/types";

export class Validator {
	private config: Config;

	constructor(configPath: string) {
		setConfigPath(configPath || undefined);
		this.config = loadConfig();
	}

	async validate(filePath: string): Promise<FileValidationResult | null> {
		const result = await validateFile(filePath, this.config);
		if (result.inSpace === false) {
			return null;
		}
		return result as FileValidationResult;
	}
}
