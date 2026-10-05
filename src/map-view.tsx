import { FileSystemAdapter, ItemView, type WorkspaceLeaf } from "obsidian";
import { isAbsolute, join, relative } from "node:path";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { loadConfig, loadSpaceGraph, type Config, type SpaceGraph, type SpaceNode } from "structured-context/api";
import { SpaceSummary } from "structured-context-navigator/map-views/layouts";

export const MAP_VIEW_TYPE = "structured-context-map-view";

/** Obsidian pane hosting map views for a space chosen from the structured-context config. */
export class MapViewPane extends ItemView {
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return MAP_VIEW_TYPE;
	}

	getDisplayText() {
		return "Map view";
	}

	getIcon() {
		return "network";
	}

	async onOpen() {
		this.contentEl.addClass("sctx-map-view");
		this.root = createRoot(this.contentEl);
		// PROTOTYPE: always uses the system config; should follow the plugin's config settings.
		this.root.render(<MapViewHost config={loadConfig()} onOpenSource={(path) => this.openSource(path)} />);
	}

	async onClose() {
		this.root?.unmount();
		this.root = null;
	}

	/** Open a node's source file if it lives inside this vault. */
	private openSource(absolutePath: string) {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;
		const vaultPath = relative(adapter.getBasePath(), absolutePath);
		if (vaultPath.startsWith("..") || isAbsolute(vaultPath)) return;
		void this.app.workspace.openLinkText(vaultPath, "", false);
	}
}

function MapViewHost({ config, onOpenSource }: { config: Config; onOpenSource: (absolutePath: string) => void }) {
	const [spaceName, setSpaceName] = useState("");
	const [graph, setGraph] = useState<SpaceGraph>();
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (!spaceName) return;
		setGraph(undefined);
		setError(undefined);
		loadSpaceGraph(spaceName, config).then(setGraph, (e) => setError(e instanceof Error ? e.message : String(e)));
	}, [config, spaceName]);

	const spacePath = config.spaces.find((s) => s.name === spaceName)?.path;
	const openNode = (node: SpaceNode) => {
		const file = node.source?.file;
		if (spacePath && file) onOpenSource(join(spacePath, file));
	};

	return (
		<div>
			<select className="dropdown" value={spaceName} onChange={(e) => setSpaceName(e.target.value)} aria-label="Space">
				<option value="">Choose a space…</option>
				{config.spaces.map((s) => (
					<option key={s.name} value={s.name}>
						{s.name}
					</option>
				))}
			</select>
			{error && <p className="sctx-map-view-error">{error}</p>}
			{graph && <SpaceSummary graph={graph} onNodeSelect={openNode} />}
		</div>
	);
}
