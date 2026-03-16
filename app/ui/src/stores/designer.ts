import { create } from 'zustand';
import type { Step } from '../models/step';
import type { RunMode } from '../models/workflow';
import { createDefaultStep, normalizeSteps } from '../models/step';
import { normalizeRunMode, type DesignerState, createEmptyDesigner } from '../models/workflow';
import { api } from '../api/bridge';
import { useAppStore } from './app';
import { graphToSteps as graphToStepsUtil } from '../components/node-editor/graph-utils';
import type { Node, Edge } from '@xyflow/react';
import type { StepNodeData } from '../components/node-editor/graph-utils';

/* ── Save status ── */

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface SaveState {
  status: SaveStatus;
  lastSavedAt: number;
  message: string;
}

/* ── Undo/Redo ── */

const UNDO_MAX = 50;

/* ── Store ── */

interface DesignerStore {
  // Designer data
  designer: DesignerState;
  saveState: SaveState;
  isOpen: boolean;

  // Node graph data (for canvas mode)
  _nodeGraph: { nodes: Node<StepNodeData>[]; edges: Edge[] } | null;

  // Undo/Redo stacks
  _undoStack: string[];
  _redoStack: string[];
  _lastSnapshot: string;
  _restoringSnapshot: boolean;
  _snapshotVersion: number;

  // Actions
  openDesigner: (workflowId: string) => void;
  openNewDesigner: () => void;
  closeDesigner: () => void;
  updateField: (field: keyof DesignerState, value: unknown) => void;
  updateRunMode: (type: string) => void;
  updateRunCount: (count: number) => void;
  setSteps: (steps: Step[]) => void;
  setNodeGraph: (nodes: Node<StepNodeData>[], edges: Edge[]) => void;
  markDirty: () => void;
  saveFlow: () => Promise<void>;
  resetDesigner: () => void;

  // Step operations
  addStep: (path: string, kind?: string) => void;
  removeStep: (path: string, index: number) => void;
  moveStep: (path: string, index: number, direction: 'up' | 'down') => void;
  updateStepField: (stepPath: string, field: string, value: unknown) => void;
  changeStepKind: (stepPath: string, newKind: string) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** Serialize _nodeGraph to a safe snapshot (strip ReactFlow internal fields) */
function snapshotNodeGraph(ng: { nodes: Node<StepNodeData>[]; edges: Edge[] } | null): unknown {
  if (!ng) return null;
  return {
    nodes: ng.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: {
        step: (n.data as StepNodeData).step,
        label: (n.data as StepNodeData).label,
        nodeRole: (n.data as StepNodeData).nodeRole,
      },
    })),
    edges: ng.edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? null,
      target: e.target,
      targetHandle: e.targetHandle ?? null,
    })),
  };
}

/** Restore a snapshot back to a full _nodeGraph (ensure type field exists) */
function restoreNodeGraph(raw: unknown): { nodes: Node<StepNodeData>[]; edges: Edge[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;
  return {
    nodes: (obj.nodes as Array<Record<string, unknown>>).map((n) => {
      const data = n.data as StepNodeData;
      // Determine correct type from nodeRole
      let type = String(n.type ?? 'stepNode');
      if (data?.nodeRole === 'start') type = 'startNode';
      else if (data?.nodeRole === 'end') type = 'endNode';
      return {
        id: String(n.id ?? ''),
        type,
        position: n.position as { x: number; y: number },
        data,
      };
    }) as Node<StepNodeData>[],
    edges: (obj.edges as Array<Record<string, unknown>>).map((e) => ({
      id: String(e.id ?? ''),
      source: String(e.source ?? ''),
      sourceHandle: e.sourceHandle as string | null,
      target: String(e.target ?? ''),
      targetHandle: e.targetHandle as string | null,
    })) as Edge[],
  };
}

/** Read a nested property by dot-separated path like "steps" or "steps.0.then_steps" */
function readPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function writePath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== 'object') return;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  if (current != null && typeof current === 'object') {
    (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
  }
}

export const useDesignerStore = create<DesignerStore>((set, get) => ({
  designer: createEmptyDesigner(),
  saveState: { status: 'idle', lastSavedAt: 0, message: '' },
  isOpen: false,

  _nodeGraph: null,

  _undoStack: [],
  _redoStack: [],
  _lastSnapshot: JSON.stringify({ steps: [], nodeGraph: null }),
  _restoringSnapshot: false,
  _snapshotVersion: 0,

  openDesigner: (workflowId) => {
    const appState = useAppStore.getState();
    const wf = appState.workflows.find((w) => w.workflow_id === workflowId);
    if (!wf) return;

    let steps: Step[];
    if (Array.isArray(wf.steps) && wf.steps.length > 0) {
      steps = normalizeSteps(wf.steps as Record<string, unknown>[]);
    } else if (Array.isArray(wf.actions) && wf.actions.length > 0) {
      steps = normalizeSteps(
        (wf.actions as Array<Record<string, unknown>>).map((a) => {
          const params = typeof a.params === 'object' && a.params ? { ...(a.params as Record<string, unknown>) } : {};
          return { kind: a.kind ?? 'key_tap', ...params };
        }),
      );
    } else {
      steps = [createDefaultStep('key_tap')];
    }

    const designer: DesignerState = {
      workflow_id: wf.workflow_id,
      name: wf.name,
      hotkey: wf.binding?.hotkey ?? '',
      description: wf.description,
      enabled: wf.binding?.enabled ?? true,
      run_mode: wf.run_mode,
      steps,
    };

    // Restore saved node graph if available
    const savedGraph = wf.node_graph;
    let restoredNodeGraph: { nodes: Node<StepNodeData>[]; edges: Edge[] } | null = null;
    if (savedGraph && Array.isArray(savedGraph.nodes) && Array.isArray(savedGraph.edges)) {
      restoredNodeGraph = {
        nodes: savedGraph.nodes.map((n) => {
          const isStart = n.kind === '__start__' || n.id === '__start__';
          const isEnd = n.kind === '__end__' || String(n.id).startsWith('__end__');
          let type = 'stepNode';
          let nodeRole: 'start' | 'end' | undefined;
          if (isStart) { type = 'startNode'; nodeRole = 'start'; }
          else if (isEnd) { type = 'endNode'; nodeRole = 'end'; }
          return {
            id: n.id,
            type,
            position: n.position,
            data: {
              step: n.params as Step,
              label: n.kind,
              nodeRole,
            } as StepNodeData,
          };
        }) as Node<StepNodeData>[],
        edges: savedGraph.edges.map((e) => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle,
          target: e.target,
          targetHandle: e.targetHandle,
        })) as Edge[],
      };
    }

    const snapshot = JSON.stringify({ steps, nodeGraph: snapshotNodeGraph(restoredNodeGraph) });
    set((s) => ({
      designer,
      isOpen: true,
      _nodeGraph: restoredNodeGraph,
      saveState: { status: 'idle', lastSavedAt: 0, message: '' },
      _undoStack: [],
      _redoStack: [],
      _lastSnapshot: snapshot,
      _restoringSnapshot: false,
      _snapshotVersion: s._snapshotVersion + 1,
    }));
  },

  openNewDesigner: () => {
    const designer = createEmptyDesigner();
    const snapshot = JSON.stringify({ steps: designer.steps, nodeGraph: null });
    set((s) => ({
      designer,
      isOpen: true,
      _nodeGraph: null,
      saveState: { status: 'idle', lastSavedAt: 0, message: '' },
      _undoStack: [],
      _redoStack: [],
      _lastSnapshot: snapshot,
      _restoringSnapshot: false,
      _snapshotVersion: s._snapshotVersion + 1,
    }));
  },

  closeDesigner: () => {
    set({ isOpen: false });
  },

  updateField: (field, value) => {
    set((s) => ({
      designer: { ...s.designer, [field]: value },
    }));
    get().markDirty();
  },

  updateRunMode: (type) => {
    set((s) => ({
      designer: {
        ...s.designer,
        run_mode: normalizeRunMode({ type, count: s.designer.run_mode.count }),
      },
    }));
    get().markDirty();
  },

  updateRunCount: (count) => {
    set((s) => ({
      designer: {
        ...s.designer,
        run_mode: { ...s.designer.run_mode, count },
      },
    }));
    get().markDirty();
  },

  setSteps: (steps) => {
    set((s) => ({ designer: { ...s.designer, steps } }));
  },

  setNodeGraph: (nodes, edges) => {
    set({ _nodeGraph: { nodes, edges } });
  },

  markDirty: () => {
    const state = get();
    if (state.saveState.status === 'saving') return;

    // Push undo snapshot — include both steps and nodeGraph
    const snap = JSON.stringify({ steps: state.designer.steps, nodeGraph: snapshotNodeGraph(state._nodeGraph) });
    if (snap !== state._lastSnapshot) {
      const stack = [...state._undoStack, state._lastSnapshot];
      if (stack.length > UNDO_MAX) stack.shift();
      set({
        _undoStack: stack,
        _redoStack: [],
        _lastSnapshot: snap,
        saveState: { ...state.saveState, status: 'dirty', message: '流程有未保存修改' },
      });
    } else {
      set({
        saveState: { ...state.saveState, status: 'dirty', message: '流程有未保存修改' },
      });
    }
  },

  saveFlow: async () => {
    const state = get();
    set({ saveState: { status: 'saving', lastSavedAt: state.saveState.lastSavedAt, message: '正在保存…' } });

    // If node graph exists, convert graph → steps before saving
    let steps: Step[];
    if (state._nodeGraph) {
      steps = graphToStepsUtil(
        state._nodeGraph.nodes as Node<StepNodeData>[],
        state._nodeGraph.edges,
      );
      // Sync back to designer state
      set((s) => ({ designer: { ...s.designer, steps } }));
    } else {
      steps = deepClone(state.designer.steps);
    }

    // Serialize node graph for persistence
    let nodeGraphPayload: Record<string, unknown> | null = null;
    if (state._nodeGraph) {
      nodeGraphPayload = {
        nodes: state._nodeGraph.nodes.map((n) => {
          const data = n.data as StepNodeData;
          // Save special nodes with __start__ / __end__ kind
          let kind: string = data.step?.kind ?? '';
          if (data.nodeRole === 'start') kind = '__start__';
          else if (data.nodeRole === 'end') kind = '__end__';
          return {
            id: n.id,
            kind,
            position: n.position,
            params: data.nodeRole ? {} : (data.step ?? {}),
          };
        }),
        edges: state._nodeGraph.edges.map((e) => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle ?? '',
          target: e.target,
          targetHandle: e.targetHandle ?? '',
        })),
      };
    }

    const payload: Record<string, unknown> = {
      workflow_id: state.designer.workflow_id || undefined,
      name: state.designer.name,
      hotkey: state.designer.hotkey,
      description: state.designer.description,
      enabled: state.designer.enabled,
      run_mode: state.designer.run_mode,
      steps: deepClone(steps),
      node_graph: nodeGraphPayload,
    };

    try {
      const result = await api.saveCustomFlow(payload);
      if (result.ok) {
        const now = Date.now();
        set({ saveState: { status: 'saved', lastSavedAt: now, message: '' } });
        if (result.workflow) {
          set((s) => ({
            designer: {
              ...s.designer,
              workflow_id: String((result.workflow as Record<string, unknown>).workflow_id ?? s.designer.workflow_id),
            },
          }));
        }
        await useAppStore.getState().loadBootstrap();
        useAppStore.getState().showToast('流程已保存', 'success');
      } else {
        set({ saveState: { status: 'error', lastSavedAt: state.saveState.lastSavedAt, message: result.error ?? '保存失败' } });
        useAppStore.getState().showToast(result.error ?? '保存失败', 'error');
      }
    } catch (err) {
      set({ saveState: { status: 'error', lastSavedAt: state.saveState.lastSavedAt, message: String(err) } });
      useAppStore.getState().showToast(`保存失败：${err}`, 'error');
    }
  },

  resetDesigner: () => {
    const state = get();
    if (state.designer.workflow_id) {
      get().openDesigner(state.designer.workflow_id);
    } else {
      get().openNewDesigner();
    }
  },

  // Step operations
  addStep: (path, kind = 'key_tap') => {
    set((s) => {
      const designer = deepClone(s.designer) as unknown as Record<string, unknown>;
      const list = readPath(designer, path) as Step[] | undefined;
      if (!Array.isArray(list)) return s;
      list.push(createDefaultStep(kind as Step['kind']));
      return { designer: designer as unknown as DesignerState };
    });
    get().markDirty();
  },

  removeStep: (path, index) => {
    set((s) => {
      const designer = deepClone(s.designer) as unknown as Record<string, unknown>;
      const list = readPath(designer, path) as Step[] | undefined;
      if (!Array.isArray(list) || index < 0 || index >= list.length) return s;
      list.splice(index, 1);
      return { designer: designer as unknown as DesignerState };
    });
    get().markDirty();
  },

  moveStep: (path, index, direction) => {
    set((s) => {
      const designer = deepClone(s.designer) as unknown as Record<string, unknown>;
      const list = readPath(designer, path) as Step[] | undefined;
      if (!Array.isArray(list)) return s;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= list.length) return s;
      [list[index], list[target]] = [list[target], list[index]];
      return { designer: designer as unknown as DesignerState };
    });
    get().markDirty();
  },

  updateStepField: (stepPath, field, value) => {
    set((s) => {
      const designer = deepClone(s.designer) as unknown as Record<string, unknown>;
      const step = readPath(designer, stepPath) as Record<string, unknown> | undefined;
      if (!step) return s;
      step[field] = value;
      return { designer: designer as unknown as DesignerState };
    });
    get().markDirty();
  },

  changeStepKind: (stepPath, newKind) => {
    set((s) => {
      const designer = deepClone(s.designer) as unknown as Record<string, unknown>;
      const newStep = createDefaultStep(newKind as Step['kind']);
      writePath(designer, stepPath, newStep);
      return { designer: designer as unknown as DesignerState };
    });
    get().markDirty();
  },

  // Undo/Redo
  undo: () => {
    const state = get();
    if (!state._undoStack.length) return;
    const currentSnap = JSON.stringify({ steps: state.designer.steps, nodeGraph: snapshotNodeGraph(state._nodeGraph) });
    const prev = state._undoStack[state._undoStack.length - 1];
    try {
      const parsed = JSON.parse(prev) as { steps: Step[]; nodeGraph: unknown };
      set({
        _restoringSnapshot: true,
        _snapshotVersion: state._snapshotVersion + 1,
        designer: { ...state.designer, steps: parsed.steps },
        _nodeGraph: restoreNodeGraph(parsed.nodeGraph),
        _undoStack: state._undoStack.slice(0, -1),
        _redoStack: [...state._redoStack, currentSnap],
        _lastSnapshot: prev,
        saveState: { ...state.saveState, status: 'dirty', message: '已撤销' },
      });
      set({ _restoringSnapshot: false });
    } catch { /* noop */ }
  },

  redo: () => {
    const state = get();
    if (!state._redoStack.length) return;
    const currentSnap = JSON.stringify({ steps: state.designer.steps, nodeGraph: snapshotNodeGraph(state._nodeGraph) });
    const next = state._redoStack[state._redoStack.length - 1];
    try {
      const parsed = JSON.parse(next) as { steps: Step[]; nodeGraph: unknown };
      set({
        _restoringSnapshot: true,
        _snapshotVersion: state._snapshotVersion + 1,
        designer: { ...state.designer, steps: parsed.steps },
        _nodeGraph: restoreNodeGraph(parsed.nodeGraph),
        _undoStack: [...state._undoStack, currentSnap],
        _redoStack: state._redoStack.slice(0, -1),
        _lastSnapshot: next,
        saveState: { ...state.saveState, status: 'dirty', message: '已前进' },
      });
      set({ _restoringSnapshot: false });
    } catch { /* noop */ }
  },

  canUndo: () => get()._undoStack.length > 0,
  canRedo: () => get()._redoStack.length > 0,
}));
