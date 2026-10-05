import { FileSystemAdapter, ItemView, type WorkspaceLeaf } from "obsidian";
import { readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { assembleSpaceGraph, createSpaceContext, loadConfig, type Config, type SpaceNode } from "structured-context/api";
import {
	type MapViewDefinition,
	mapViewsForSchema,
	parseMapViewDefinition,
	type SpaceData,
} from "structured-context-navigator/map-views/core";
import { MapView } from "structured-context-navigator/map-views/layouts";

/** Absolute path of the map view definitions directory, injected by the build (esbuild `define`). */
declare const SCTX_MAP_VIEWS_DIR: string;

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

/** Read map view definitions from the definitions directory injected at build time. */
function loadMapViews(): MapViewDefinition[] {
	const dir = SCTX_MAP_VIEWS_DIR;
	return readdirSync(dir)
		.filter((file) => file.endsWith(".json5"))
		.sort()
		.map((file) => parseMapViewDefinition(basename(file, ".json5"), readFileSync(join(dir, file), "utf8")));
}

async function loadSpaceData(spaceName: string, config: Config): Promise<SpaceData> {
	const context = createSpaceContext(spaceName, config);
	const graph = await assembleSpaceGraph(context);
	return { space: spaceName, schemaId: context.schema.$id, hierarchy: graph.hierarchy, nodes: [...graph.nodes.values()] };
}

function MapViewHost({ config, onOpenSource }: { config: Config; onOpenSource: (absolutePath: string) => void }) {
	const [spaceName, setSpaceName] = useState("");
	const [mapViewName, setMapViewName] = useState("");
	const [data, setData] = useState<SpaceData>();
	const [{ definitions, definitionsError }] = useState(() => {
		try {
			return { definitions: loadMapViews(), definitionsError: undefined };
		} catch (e) {
			return { definitions: [], definitionsError: e instanceof Error ? e.message : String(e) };
		}
	});
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (!spaceName) return;
		setData(undefined);
		setError(undefined);
		loadSpaceData(spaceName, config).then(setData, (e) => setError(e instanceof Error ? e.message : String(e)));
	}, [config, spaceName]);

	const available = mapViewsForSchema(definitions, data?.schemaId);
	const definition = available.find((d) => d.name === mapViewName) ?? available[0];

	const spacePath = config.spaces.find((s) => s.name === spaceName)?.path;
	const openNode = (node: SpaceNode) => {
		const file = node.source?.file;
		if (spacePath && file) onOpenSource(join(spacePath, file));
	};

	return (
		<div className="sctx-map-view-host">
			<div className="sctx-map-view-toolbar">
				<select className="dropdown" value={spaceName} onChange={(e) => setSpaceName(e.target.value)} aria-label="Space">
					<option value="">Choose a space…</option>
					{config.spaces.map((s) => (
						<option key={s.name} value={s.name}>
							{s.name}
						</option>
					))}
				</select>
				{available.length > 0 && (
					<select
						className="dropdown"
						value={definition?.name}
						onChange={(e) => setMapViewName(e.target.value)}
						aria-label="Map view"
					>
						{available.map((d) => (
							<option key={d.name} value={d.name}>
								{d.title}
							</option>
						))}
					</select>
				)}
			</div>
			{definitionsError && <p className="sctx-map-view-error">{definitionsError}</p>}
			{error && <p className="sctx-map-view-error">{error}</p>}
			{data && !definition && <p>No map view applies to this space's schema.</p>}
			<div className="sctx-map-view-body">
				{data && definition && <MapView definition={definition} data={data} onNodeSelect={openNode} />}
			</div>
		</div>
	);
}
