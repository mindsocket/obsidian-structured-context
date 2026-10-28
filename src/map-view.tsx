import { dirname, isAbsolute, join, relative } from "node:path";
import { FileSystemAdapter, ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	assembleSpaceGraph,
	type Config,
	createSpaceContext,
	type SpaceGraph,
	type SpaceNode,
} from "structured-context/api";
import {
	MapView,
	type MapViewDefinition,
	mapViewsForSchema,
	ParameterControls,
	type ParameterValues,
	selectionFilter,
} from "structured-context-map-views";
import { loadMapViewDefinitions } from "structured-context-map-views/node";
import type { ResolvedConfig } from "./config-source";

export const MAP_VIEW_TYPE = "structured-context-map-view";

/** What the pane shows, kept in Obsidian's view state so it survives reloads with the workspace. */
type PaneState = {
	space?: string;
	mapView?: string;
	/** Parameter values per map view id. */
	values?: Record<string, ParameterValues>;
};

/** Obsidian pane hosting map views for a space chosen from the structured-context config. */
export class MapViewPane extends ItemView {
	private root: Root | null = null;
	private state: PaneState = {};
	// Read once on open: the host reloads the space whenever the config object changes.
	private resolved: ResolvedConfig | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly getConfig: () => ResolvedConfig,
	) {
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
		this.resolved = this.getConfig();
		this.root = createRoot(this.contentEl);
		this.renderHost();
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), ...this.state };
	}

	async setState(state: unknown, result: ViewStateResult) {
		this.state = toPaneState(state);
		this.renderHost();
		await super.setState(state, result);
	}

	private renderHost() {
		if (!this.resolved) return;
		this.root?.render(
			<MapViewHost
				resolved={this.resolved}
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
		const vaultPath =
			adapter instanceof FileSystemAdapter ? relative(adapter.getBasePath(), absolutePath) : undefined;
		if (vaultPath === undefined || vaultPath.startsWith("..") || isAbsolute(vaultPath)) {
			new Notice(`Not in this vault: ${absolutePath}`);
			return;
		}
		// A new tab, so the map view stays open.
		void this.app.workspace.openLinkText(vaultPath, "", "tab");
	}
}

/** Keep only well-formed fields of saved view state; parameter values are checked when resolved. */
function toPaneState(state: unknown): PaneState {
	if (typeof state !== "object" || state === null) return {};
	const { space, mapView, values } = state as Record<string, unknown>;
	return {
		...(typeof space === "string" && { space }),
		...(typeof mapView === "string" && { mapView }),
		...(typeof values === "object" && values !== null && { values: values as PaneState["values"] }),
	};
}

/** The definitions bundled with the library, in plugins and next to the config file. */
function loadMapViews({ config, file }: ResolvedConfig): MapViewDefinition[] {
	return loadMapViewDefinitions(config, file ? { configDir: dirname(file) } : {});
}

type Space = { schemaId: string | undefined; graph: SpaceGraph };

/** Load a space, narrowed by a filter (a view name or expression) when one is given. */
async function loadSpace(spaceName: string, config: Config, filter?: string): Promise<Space> {
	const context = createSpaceContext(spaceName, config);
	return { schemaId: context.schema.$id, graph: await assembleSpaceGraph(context, { filter }) };
}

function MapViewHost({
	resolved,
	state,
	onStateChange,
	onOpenSource,
}: {
	resolved: ResolvedConfig;
	state: PaneState;
	onStateChange: (state: PaneState) => void;
	onOpenSource: (absolutePath: string) => void;
}) {
	const { config } = resolved;
	const spaceName = state.space ?? "";
	// The whole space, for its schema; then the space as the map view's filter selects it.
	const [data, setData] = useState<Space>();
	const [selection, setSelection] = useState<{ filter: string; data: Space }>();
	const { definitions, definitionsError } = useMemo(() => {
		try {
			return { definitions: loadMapViews(resolved), definitionsError: undefined };
		} catch (e) {
			return { definitions: [], definitionsError: e instanceof Error ? e.message : String(e) };
		}
	}, [resolved]);
	const [error, setError] = useState<string>();

	useEffect(() => {
		setData(undefined);
		setError(undefined);
		if (!spaceName) return;
		let current = true;
		loadSpace(spaceName, config).then(
			(d) => current && setData(d),
			(e) => current && setError(e instanceof Error ? e.message : String(e)),
		);
		return () => {
			current = false;
		};
	}, [config, spaceName]);

	const available = mapViewsForSchema(definitions, data?.schemaId);
	const definition = available.find((d) => d.id === state.mapView) ?? available[0];
	const values = definition ? state.values?.[definition.id] : undefined;
	const filter = definition ? selectionFilter(definition, values) : undefined;

	useEffect(() => {
		setSelection(undefined);
		if (!spaceName || !filter) return;
		let current = true;
		loadSpace(spaceName, config, filter).then(
			(d) => current && setSelection({ filter, data: d }),
			(e) => current && setError(e instanceof Error ? e.message : String(e)),
		);
		return () => {
			current = false;
		};
	}, [config, spaceName, filter]);
	// Unfiltered data stands in only for map views without a filter, never for a pending selection.
	const shown = filter ? (selection?.filter === filter ? selection.data : undefined) : data;

	const setValue = (name: string, value: unknown) => {
		if (!definition) return;
		onStateChange({
			...state,
			values: { ...state.values, [definition.id]: { ...values, [name]: value } },
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
						value={definition?.id}
						onChange={(e) => onStateChange({ ...state, mapView: e.target.value })}
						aria-label="Map view"
					>
						{available.map((d) => (
							<option key={d.id} value={d.id}>
								{d.title}
							</option>
						))}
					</select>
				)}
			</div>
			{definition && definition.parameters.length > 0 && (
				<div className="sctx-map-view-parameters">
					<ParameterControls definition={definition} values={values ?? {}} onChange={setValue} />
				</div>
			)}
			{definitionsError && <p className="sctx-map-view-error">{definitionsError}</p>}
			{error && <p className="sctx-map-view-error">{error}</p>}
			{data && !definition && <p>No map view applies to this space's schema.</p>}
			<div className="sctx-map-view-body">
				{shown && definition && (
					<MapView definition={definition} graph={shown.graph} values={values} onNodeSelect={openNode} />
				)}
			</div>
		</div>
	);
}
