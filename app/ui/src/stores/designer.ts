import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';

import type { Step } from '../models/step';
import type { DesignerState } from '../models/workflow';
import { createDefaultStep } from '../models/step';
import { createEmptyDesigner, createEmptyNodeGraph, normalizeRunMode } from '../models/workflow';
import { api } from '../api/bridge';
import { useAppStore } from './app';
import type { StepNodeData } from '../components/node-editor/graph-utils';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface SaveState {
  status: SaveStatus;
  lastSavedAt: number;
  message: string;
}

const UNDO_MAX = 50;

interface DesignerStore {
  designer: DesignerState;
  saveState: SaveState;
  isOpen: boolean;
  _nodeGraph: { nodes: Node<StepNodeData>[]; edges: Edge[] } | null;
  _undoStack: string[];
  _redoStack: string[];
  _lastSnapshot: string;
  _restoringSnapshot: boolean;
  _snapshotVersion: number;

  openDesigner: (workflowId: string) => void;
  openNewDesigner: () => void;
  closeDesigner: () => void;
  updateField: (field: keyof DesignerState, value: unknown) => void;
  updateRunMode: (type: string) => void;
  updateRunCount: (count: number) => void;
  setNodeGraph: (nodes: Node<StepNodeData>[], edges: Edge[]) => void;
  markDirty: () => void;
  saveFlow: () => Promise<void>;
  resetDesigner: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function sanitizeNodeStep(step: Step): Step {
  return deepClone(step);
}

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

function restoreNodeGraph(raw: unknown): { nodes: Node<StepNodeData>[]; edges: Edge[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;
  return {
    nodes: (obj.nodes as Array<Record<string, unknown>>).map((n) => {
      const data = n.data as StepNodeData;
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

function graphToStoreNodeGraph(nodeGraph: NonNullable<ReturnType<typeof createEmptyNodeGraph>>): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  return {
    nodes: nodeGraph.nodes.map((n) => {
      const isStart = n.kind === '__start__' || n.id === '__start__';
      const isEnd = n.kind === '__end__' || String(n.id).startsWith('__end__');
      let type = 'stepNode';
      let nodeRole: 'start' | 'end' | undefined;
      if (isStart) {
        type = 'startNode';
        nodeRole = 'start';
      } else if (isEnd) {
        type = 'endNode';
        nodeRole = 'end';
      }
      return {
        id: n.id,
        type,
        position: n.position,
        data: {
          step: nodeRole ? ({ kind: 'log' } as Step) : sanitizeNodeStep((n.params ?? { kind: 'log' }) as Step),
          label: n.kind,
          nodeRole,
        } as StepNodeData,
      };
    }) as Node<StepNodeData>[],
    edges: nodeGraph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
    })) as Edge[],
  };
}

function storeToPayloadNodeGraph(ng: { nodes: Node<StepNodeData>[]; edges: Edge[] } | null): Record<string, unknown> | null {
  if (!ng) return null;
  return {
    nodes: ng.nodes.map((n) => {
      const data = n.data as StepNodeData;
      let kind: string = data.step?.kind ?? 'log';
      if (data.nodeRole === 'start') kind = '__start__';
      else if (data.nodeRole === 'end') kind = '__end__';
      return {
        id: n.id,
        kind,
        position: { x: n.position.x, y: n.position.y },
        params: data.nodeRole ? {} : sanitizeNodeStep(data.step ?? createDefaultStep('log')),
      };
    }),
    edges: ng.edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? 'bottom',
      target: e.target,
      targetHandle: e.targetHandle ?? 'top',
    })),
  };
}

export const useDesignerStore = create<DesignerStore>((set, get) => ({
  designer: createEmptyDesigner(),
  saveState: { status: 'idle', lastSavedAt: 0, message: '' },
  isOpen: false,
  _nodeGraph: null,
  _undoStack: [],
  _redoStack: [],
  _lastSnapshot: JSON.stringify({ designer: createEmptyDesigner(), nodeGraph: null }),
  _restoringSnapshot: false,
  _snapshotVersion: 0,

  openDesigner: (workflowId) => {
    const appState = useAppStore.getState();
    const wf = appState.workflows.find((w) => w.workflow_id === workflowId);
    if (!wf) return;
    if (!wf.node_graph || !Array.isArray(wf.node_graph.nodes) || !Array.isArray(wf.node_graph.edges)) {
      useAppStore.getState().showToast('该流程缺少合法 node_graph，无法打开编辑器', 'error');
      return;
    }

    const designer: DesignerState = {
      workflow_id: wf.workflow_id,
      name: wf.name,
      hotkey: wf.binding?.hotkey ?? '',
      description: wf.description,
      enabled: wf.binding?.enabled ?? true,
      run_mode: wf.run_mode,
    };

    const restoredNodeGraph = graphToStoreNodeGraph(wf.node_graph);
    const snapshot = JSON.stringify({ designer, nodeGraph: snapshotNodeGraph(restoredNodeGraph) });
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
    const nodeGraph = graphToStoreNodeGraph(createEmptyNodeGraph());
    const snapshot = JSON.stringify({ designer, nodeGraph: snapshotNodeGraph(nodeGraph) });
    set((s) => ({
      designer,
      isOpen: true,
      _nodeGraph: nodeGraph,
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
    set((s) => ({ designer: { ...s.designer, [field]: value } }));
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

  setNodeGraph: (nodes, edges) => {
    set({ _nodeGraph: { nodes, edges } });
  },

  markDirty: () => {
    const state = get();
    if (state.saveState.status === 'saving') return;
    const snap = JSON.stringify({ designer: state.designer, nodeGraph: snapshotNodeGraph(state._nodeGraph) });
    if (snap !== state._lastSnapshot) {
      const stack = [...state._undoStack, state._lastSnapshot];
      if (stack.length > UNDO_MAX) stack.shift();
      set({
        _undoStack: stack,
        _redoStack: [],
        _lastSnapshot: snap,
        saveState: { ...state.saveState, status: 'dirty', message: '流程有未保存修改' },
      });
      return;
    }
    set({ saveState: { ...state.saveState, status: 'dirty', message: '流程有未保存修改' } });
  },

  saveFlow: async () => {
    const state = get();
    set({ saveState: { status: 'saving', lastSavedAt: state.saveState.lastSavedAt, message: '正在保存…' } });

    const nodeGraphPayload = storeToPayloadNodeGraph(state._nodeGraph);
    const payload: Record<string, unknown> = {
      workflow_id: state.designer.workflow_id || undefined,
      name: state.designer.name,
      hotkey: state.designer.hotkey,
      description: state.designer.description,
      enabled: state.designer.enabled,
      run_mode: state.designer.run_mode,
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

  undo: () => {
    const state = get();
    if (!state._undoStack.length) return;
    const currentSnap = JSON.stringify({ designer: state.designer, nodeGraph: snapshotNodeGraph(state._nodeGraph) });
    const prev = state._undoStack[state._undoStack.length - 1];
    try {
      const parsed = JSON.parse(prev) as { designer: DesignerState; nodeGraph: unknown };
      set({
        _restoringSnapshot: true,
        _snapshotVersion: state._snapshotVersion + 1,
        designer: parsed.designer,
        _nodeGraph: restoreNodeGraph(parsed.nodeGraph),
        _undoStack: state._undoStack.slice(0, -1),
        _redoStack: [...state._redoStack, currentSnap],
        _lastSnapshot: prev,
        saveState: { ...state.saveState, status: 'dirty', message: '已撤销' },
      });
      set({ _restoringSnapshot: false });
    } catch {
      // noop
    }
  },

  redo: () => {
    const state = get();
    if (!state._redoStack.length) return;
    const currentSnap = JSON.stringify({ designer: state.designer, nodeGraph: snapshotNodeGraph(state._nodeGraph) });
    const next = state._redoStack[state._redoStack.length - 1];
    try {
      const parsed = JSON.parse(next) as { designer: DesignerState; nodeGraph: unknown };
      set({
        _restoringSnapshot: true,
        _snapshotVersion: state._snapshotVersion + 1,
        designer: parsed.designer,
        _nodeGraph: restoreNodeGraph(parsed.nodeGraph),
        _undoStack: [...state._undoStack, currentSnap],
        _redoStack: state._redoStack.slice(0, -1),
        _lastSnapshot: next,
        saveState: { ...state.saveState, status: 'dirty', message: '已前进' },
      });
      set({ _restoringSnapshot: false });
    } catch {
      // noop
    }
  },

  canUndo: () => get()._undoStack.length > 0,
  canRedo: () => get()._redoStack.length > 0,
}));
