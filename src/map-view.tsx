import { FileSystemAdapter, ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { assembleSpaceGraph, createSpaceContext, loadConfig, type Config, type SpaceNode } from "structured-context/api";
import {
	type MapViewDefinition,
	mapViewsForSchema,
	type ParameterValues,
	parseMapViewDefinition,
	type SpaceData,
} from "structured-context-navigator/map-views/core";
import { MapView, ParameterControls } from "structured-context-navigator/map-views/layouts";

/** Absolute path of the map view definitions directory, injected by the build (esbuild `define`). */
declare const SCTX_MAP_VIEWS_DIR: string;

export const MAP_VIEW_TYPE = "structured-context-map-view";

/** What the pane shows, kept in Obsidian's view state so it survives reloads with the workspace. */
type PaneState = {
	space?: string;
	mapView?: string;
	/** Parameter values per map view name. */
	values?: Record<string, ParameterValues>;
};

/** Obsidian pane hosting map views for a space chosen from the structured-context config. */
export class MapViewPane extends ItemView {
	private root: Root | null = null;
	private state: PaneState = {};
	// Loaded once: the host reloads the space whenever the config object changes.
	private config: Config | null = null;

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
		// PROTOTYPE: always uses the system config; should follow the plugin's config settings.
		this.config = loadConfig();
		this.root = createRoot(this.contentEl);
		this.renderHost();
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), ...this.state };
	}

	async setState(state: unknown, result: ViewStateResult) {
		this.state = (state ?? {}) as PaneState;
		this.renderHost();
		await super.setState(state, result);
	}

	private renderHost() {
		if (!this.config) return;
		this.root?.render(
			<MapViewHost
				config={this.config}
				state={this.state}
				onStateChange={(state) => {
					this.state = state;
					this.renderHost();
					this.app.workspace.requestSaveLayout();
				}}
				onOpenSource={(path) => this.openSource(path)}
			/>,
		);
	}

	async onClose() {
		this.root?.unmount();
		this.root = null;
	}

	/** Open a node's source file in a new tab, if it lives inside this vault. */
	private openSource(absolutePath: string) {
		const adapter = this.app.vault.adapter;
		const vaultPath = adapter instanceof FileSystemAdapter ? relative(adapter.getBasePath(), absolutePath) : undefined;
		if (vaultPath === undefined || vaultPath.startsWith("..") || isAbsolute(vaultPath)) {
			new Notice(`Not in this vault: ${absolutePath}`);
			return;
		}
		// A new tab, so the map view stays open.
		void this.app.workspace.openLinkText(vaultPath, "", "tab");
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

function MapViewHost({
	config,
	state,
	onStateChange,
	onOpenSource,
}: {
	config: Config;
	state: PaneState;
	onStateChange: (state: PaneState) => void;
	onOpenSource: (absolutePath: string) => void;
}) {
	const spaceName = state.space ?? "";
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
		setData(undefined);
		setError(undefined);
		if (!spaceName) return;
		let current = true;
		loadSpaceData(spaceName, config).then(
			(d) => current && setData(d),
			(e) => current && setError(e instanceof Error ? e.message : String(e)),
		);
		return () => {
			current = false;
		};
	}, [config, spaceName]);

	const available = mapViewsForSchema(definitions, data?.schemaId);
	const definition = available.find((d) => d.name === state.mapView) ?? available[0];
	const values = definition ? state.values?.[definition.name] : undefined;
	const setValue = (name: string, value: unknown) => {
		if (!definition) return;
		onStateChange({
			...state,
			values: { ...state.values, [definition.name]: { ...values, [name]: value } },
		});
	};

	const spacePath = config.spaces.find((s) => s.name === spaceName)?.path;
	const openNode = (node: SpaceNode) => {
		const file = node.source?.file;
		if (spacePath && file) onOpenSource(join(spacePath, file));
	};

	return (
		<div className="sctx-map-view-host">
			<div className="sctx-map-view-toolbar">
				<select
					className="dropdown"
					value={spaceName}
					onChange={(e) => onStateChange({ ...state, space: e.target.value, mapView: undefined })}
					aria-label="Space"
				>
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
						onChange={(e) => onStateChange({ ...state, mapView: e.target.value })}
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
			{definition && definition.parameters.length > 0 && (
				<div className="sctx-map-view-parameters">
					<ParameterControls parameters={definition.parameters} values={values ?? {}} onChange={setValue} />
				</div>
			)}
			{definitionsError && <p className="sctx-map-view-error">{definitionsError}</p>}
			{error && <p className="sctx-map-view-error">{error}</p>}
			{data && !definition && <p>No map view applies to this space's schema.</p>}
			<div className="sctx-map-view-body">
				{data && definition && <MapView definition={definition} data={data} values={values} onNodeSelect={openNode} />}
			</div>
		</div>
	);
}
