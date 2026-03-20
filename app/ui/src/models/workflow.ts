
/* ── Run mode ── */

export type RunModeType = 'once' | 'repeat_n' | 'toggle_loop';

export interface RunMode {
  type: RunModeType;
  count?: number;
}

export function normalizeRunMode(raw: unknown): RunMode {
  if (raw && typeof raw === 'object' && 'type' in raw) {
    const obj = raw as Record<string, unknown>;
    const type = ['once', 'repeat_n', 'toggle_loop'].includes(obj.type as string)
      ? (obj.type as RunModeType)
      : 'once';
    return {
      type,
      count: typeof obj.count === 'number' ? obj.count : 1,
    };
  }
  return { type: 'once' };
}

/* ── Workflow ── */

export interface WorkflowBinding {
  hotkey: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
}

export interface Workflow {
  workflow_id: string;
  name: string;
  description: string;
  category: string;
  tab_key: string;
  source: 'builtin' | 'custom';
  definition_editable: boolean;
  is_loop: boolean;
  run_mode: RunMode;
  binding?: WorkflowBinding;
  notes?: string[];
  settings?: unknown[];
  node_graph: NodeGraph | null;
}

/* ── Node graph (for node editor) ── */

export interface NodeGraph {
  nodes: NodeData[];
  edges: EdgeData[];
  viewport: { x: number; y: number; zoom: number };
}

export interface NodeData {
  id: string;
  kind: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
  collapsed?: boolean;
}

export interface EdgeData {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

/* ── Designer state ── */

export interface DesignerState {
  workflow_id: string;
  name: string;
  hotkey: string;
  description: string;
  enabled: boolean;
  run_mode: RunMode;
}

export function createEmptyNodeGraph(): NodeGraph {
  return {
    nodes: [
      { id: '__start__', kind: '__start__', position: { x: 80, y: 60 }, params: {} },
      { id: '__end__default', kind: '__end__', position: { x: 80, y: 220 }, params: {} },
    ],
    edges: [
      {
        id: 'edge-__start__-__end__default',
        source: '__start__',
        sourceHandle: 'bottom',
        target: '__end__default',
        targetHandle: 'top',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function createEmptyDesigner(): DesignerState {
  return {
    workflow_id: '',
    name: '',
    hotkey: '',
    description: '',
    enabled: true,
    run_mode: { type: 'once' },
  };
}

/* ── Normalize workflow ── */

export function normalizeWorkflow(raw: Record<string, unknown>): Workflow {
  const binding = raw.binding && typeof raw.binding === 'object'
    ? raw.binding as WorkflowBinding
    : undefined;

  const nodeGraph = raw.node_graph && typeof raw.node_graph === 'object'
    ? raw.node_graph as NodeGraph
    : null;

  return {
    workflow_id: String(raw.workflow_id ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    category: String(raw.category ?? ''),
    tab_key: String(raw.tab_key ?? ''),
    source: raw.source === 'custom' ? 'custom' : 'builtin',
    definition_editable: Boolean(raw.definition_editable),
    is_loop: Boolean(raw.is_loop),
    run_mode: normalizeRunMode(raw.run_mode),
    binding,
    notes: Array.isArray(raw.notes) ? raw.notes as string[] : [],
    settings: Array.isArray(raw.settings) ? raw.settings : [],
    node_graph: nodeGraph,
  };
}
