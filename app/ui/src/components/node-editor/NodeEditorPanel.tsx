import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type OnConnect,
  type NodeTypes,
  type Connection,
  addEdge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDesignerStore } from '../../stores/designer';
import { useAppStore, runtimeBadgeTone } from '../../stores/app';
import type { SharedVariableSnapshot } from '../../models/async-vision';
import {
  getKindColor,
  createNodeFromKind,
  createStartNode,
  createEndNode,
  isStartNode,
  isSpecialNode,
  computeExecutionOrder,
  START_NODE_ID,
  type StepNodeData,
} from './graph-utils';
import StepNode from './StepNode';
import StartNode from './StartNode';
import EndNode from './EndNode';
import NodeInspector from './NodeInspector';
import NodePalette from './NodePalette';
import ContextMenu from './ContextMenu';
import { type StepKind, createDefaultStep, stepHasBranch } from '../../models/step';

const nodeTypes: NodeTypes = {
  stepNode: StepNode,
  startNode: StartNode,
  endNode: EndNode,
};

function isSharedVariableStateStep(step: Record<string, unknown>): boolean {
  const scope = String(step.variable_scope ?? 'local');
  return scope === 'shared';
}

function collectReferencedSharedVariables(steps: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>();
  for (const step of steps) {
    const source = String(step.source ?? '');
    if ((source === 'shared' || isSharedVariableStateStep(step)) && typeof step.var_name === 'string' && step.var_name.trim()) {
      names.add(step.var_name.trim());
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getSharedVariableStatus(snapshot: SharedVariableSnapshot, monitorStatus?: string): { label: string; tone: 'running' | 'warn' | 'idle' | 'error' } {
  const status = monitorStatus || snapshot._shared?.status || 'idle';
  if (status === 'error') return { label: '异常', tone: 'error' };
  if (status === 'paused') return { label: '已暂停', tone: 'warn' };
  if (status === 'hit') return { label: snapshot.stale ? '命中过旧值' : '已命中', tone: snapshot.stale ? 'warn' : 'running' };
  if (status === 'miss') return { label: snapshot.stale ? '未命中/旧值' : '未命中', tone: 'warn' };
  if (status === 'running') return { label: '运行中', tone: 'running' };
  return { label: '待机', tone: 'idle' };
}

function formatSharedVariableSummary(snapshot: SharedVariableSnapshot): string {
  const parts: string[] = [];
  if (typeof snapshot.x === 'number' && typeof snapshot.y === 'number') {
    parts.push(`坐标(${snapshot.x}, ${snapshot.y})`);
  }
  const message = snapshot._shared?.message?.trim();
  if (message) parts.push(message);
  return parts.join(' · ');
}

function filterValidEdges(
  nextNodes: import('@xyflow/react').Node<StepNodeData>[],
  nextEdges: import('@xyflow/react').Edge[],
): import('@xyflow/react').Edge[] {
  const nodeIds = new Set(nextNodes.map((node) => node.id));
  const nodeMap = new Map(nextNodes.map((node) => [node.id, node] as const));

  return nextEdges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return false;
    }

    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode || isSpecialNode(sourceNode)) {
      return true;
    }

    const step = (sourceNode.data as StepNodeData).step;
    const sourceHandle = edge.sourceHandle ?? 'bottom';
    const allowsBranch = stepHasBranch(step);
    const allowsLoop = step.kind === 'loop' || step.kind === 'key_hold';

    if (sourceHandle === 'then' || sourceHandle === 'else') {
      return allowsBranch;
    }
    if (sourceHandle === 'loop') {
      return allowsLoop;
    }
    return true;
  });
}

function NodeEditorInner() {
  const { designer, isOpen, _nodeGraph, saveState, openNewDesigner } = useDesignerStore();
  const runtime = useAppStore((state) => state.runtime);
  const asyncMonitors = useAppStore((state) => state.asyncMonitors);
  const sharedVariables = useAppStore((state) => state.sharedVariables);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'node' | 'pane'; nodeId?: string } | null>(null);
  const clipboardRef = useRef<import('@xyflow/react').Node | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const lastAutoFocusNodeIdRef = useRef<string>('');
  const { screenToFlowPosition, fitView, setCenter, getZoom } = useReactFlow();

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => {
      let result: { nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[] };
      if (_nodeGraph && _nodeGraph.nodes.length > 0) {
        result = { nodes: [..._nodeGraph.nodes], edges: [..._nodeGraph.edges] };
      } else {
        result = { nodes: [createStartNode({ x: 80, y: 60 }), createEndNode({ x: 80, y: 220 })], edges: [] };
      }

      // Auto-inject start node if missing (old data compat)
      const hasStart = result.nodes.some((n) => isStartNode(n));
      if (!hasStart) {
        const minY = result.nodes.reduce((m, n) => Math.min(m, n.position.y), Infinity);
        const minX = result.nodes.length > 0 ? result.nodes[0].position.x : 80;
        const startNode = createStartNode({ x: minX, y: minY - 120 });
        result.nodes.unshift(startNode);

        // Connect start to the first entry node (no incoming 'top' edge)
        const hasIncoming = new Set<string>();
        for (const e of result.edges) {
          if ((e.targetHandle ?? 'top') === 'top') hasIncoming.add(e.target);
        }
        const firstEntry = result.nodes.find((n) => !isSpecialNode(n) && !hasIncoming.has(n.id));
        if (firstEntry) {
          result.edges.push({
            id: `edge-${START_NODE_ID}-${firstEntry.id}`,
            source: START_NODE_ID,
            sourceHandle: 'bottom',
            target: firstEntry.id,
            targetHandle: 'top',
            type: 'default',
            animated: false,
          });
        }
      }

      return result;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  /* ── Store actions ── */
  const { setNodeGraph, markDirty } = useDesignerStore();

  useEffect(() => {
    if (!designer.workflow_id && (!_nodeGraph || _nodeGraph.nodes.length === 0)) {
      openNewDesigner();
    }
  }, [designer.workflow_id, _nodeGraph, openNewDesigner]);

  /** Keep refs to latest local state for commitToStore */
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  /** Sync current local state to store + push undo snapshot */
  const commitToStore = useCallback(() => {
    const validEdges = filterValidEdges(
      nodesRef.current as import('@xyflow/react').Node<StepNodeData>[],
      edgesRef.current,
    );
    if (validEdges.length !== edgesRef.current.length) {
      edgesRef.current = validEdges;
      setEdges(validEdges);
    }
    setNodeGraph(nodesRef.current as import('@xyflow/react').Node<StepNodeData>[], validEdges);
    markDirty();
  }, [setNodeGraph, markDirty, setEdges]);

  /* ── Sync from store when undo/redo/reset (snapshotVersion changes) ── */
  const snapshotVersion = useDesignerStore((s) => s._snapshotVersion);
  const storeNodeGraph = useDesignerStore((s) => s._nodeGraph);
  const lastAppliedVersion = useRef(0);

  useEffect(() => {
    if (snapshotVersion > 0 && snapshotVersion !== lastAppliedVersion.current && storeNodeGraph) {
      lastAppliedVersion.current = snapshotVersion;
      setNodes(storeNodeGraph.nodes);
      setEdges(storeNodeGraph.edges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotVersion]);

  /* ── Connect (auto-replace old edge from same sourceHandle) ── */
  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      if (params.source === params.target) return;
      const duplicate = edges.some(
        (e) =>
          e.source === params.source &&
          e.sourceHandle === params.sourceHandle &&
          e.target === params.target,
      );
      if (duplicate) return;
      setEdges((eds) => {
        // Remove existing edge from same source+sourceHandle (solve multi-connect conflict)
        const filtered = eds.filter(
          (e) => !(e.source === params.source && e.sourceHandle === params.sourceHandle),
        );
        return addEdge({ ...params, type: 'default' }, filtered);
      });
      requestAnimationFrame(() => commitToStore());
    },
    [edges, setEdges, commitToStore],
  );

  /* ── Node click / pane click ── */
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string; data?: Record<string, unknown> }) => {
      // Don't open inspector for special nodes
      if (isSpecialNode(node as { id: string; data?: { nodeRole?: string } })) {
        setContextMenu(null);
        return;
      }
      setSelectedNodeId(node.id);
      setContextMenu(null);
    },
    [],
  );
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setContextMenu(null);
  }, []);

  /* ── Context menu ── */
  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: { id: string }) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, type: 'node', nodeId: node.id });
    },
    [],
  );

  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, type: 'pane' });
    },
    [],
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const source = nodesRef.current.find((n) => n.id === nodeId);
      if (!source) return;
      const data = source.data as StepNodeData;
      const newNode = createNodeFromKind(data.step.kind, {
        x: source.position.x + 50,
        y: source.position.y + 50,
      });
      newNode.data = { ...data, step: JSON.parse(JSON.stringify(data.step)) } as StepNodeData;
      setNodes((nds) => [...nds, newNode]);
      clipboardRef.current = newNode;
      requestAnimationFrame(() => commitToStore());
    },
    [setNodes, commitToStore],
  );

  const addNodeAtPosition = useCallback(
    (kind: string, position: { x: number; y: number }) => {
      const flowPos = screenToFlowPosition(position);
      const newNode = createNodeFromKind(kind as StepKind, flowPos);
      setNodes((nds) => [...nds, newNode]);
      requestAnimationFrame(() => commitToStore());
    },
    [screenToFlowPosition, setNodes, commitToStore],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      // Protect start node from deletion
      const target = nodesRef.current.find((n) => n.id === nodeId);
      if (target && isStartNode(target)) return;
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      requestAnimationFrame(() => commitToStore());
    },
    [setNodes, setEdges, selectedNodeId, commitToStore],
  );

  const pasteNode = useCallback(
    (position: { x: number; y: number }) => {
      const source = clipboardRef.current;
      if (!source) return;
      const data = source.data as StepNodeData;
      const flowPos = screenToFlowPosition(position);
      const newNode = createNodeFromKind(data.step.kind, flowPos);
      newNode.data = { ...data, step: JSON.parse(JSON.stringify(data.step)) } as StepNodeData;
      setNodes((nds) => [...nds, newNode]);
      requestAnimationFrame(() => commitToStore());
    },
    [screenToFlowPosition, setNodes, commitToStore],
  );

  /* ── Drop from palette ── */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('stepKind');
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // Handle end node drop from palette
      if (kind === '__end__') {
        const endNode = createEndNode(position);
        setNodes((nds) => [...nds, endNode]);
      } else {
        const newNode = createNodeFromKind(kind as StepKind, position);
        setNodes((nds) => [...nds, newNode]);
      }
      requestAnimationFrame(() => commitToStore());
    },
    [screenToFlowPosition, setNodes, commitToStore],
  );

  /* ── Delete selected (protect start node, skip when editing input) ── */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't delete nodes when user is typing in an input/textarea/select
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        setNodes((nds) => nds.filter((n) => !n.selected || isStartNode(n)));
        setEdges((eds) => eds.filter((ed) => !ed.selected));
        setSelectedNodeId(null);
        requestAnimationFrame(() => commitToStore());
      }
    },
    [setNodes, setEdges, commitToStore],
  );

  /* ── Node drag end ── */
  const onNodeDragStop = useCallback(() => {
    requestAnimationFrame(() => commitToStore());
  }, [commitToStore]);

  /* ── Toolbar ── */
  const handleFitView = useCallback(() => fitView({ padding: 0.2 }), [fitView]);

  /* ── Update node data from inspector ── */
  const updateNodeData = useCallback(
    (nodeId: string, field: string, value: unknown) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const data = n.data as StepNodeData;
          return { ...n, data: { ...data, step: { ...data.step, [field]: value } } };
        }),
      );
      requestAnimationFrame(() => commitToStore());
    },
    [setNodes, commitToStore],
  );

  const changeNodeKind = useCallback(
    (nodeId: string, newKind: string) => {
      const nextNodes = nodesRef.current.map((n) => {
        if (n.id !== nodeId) return n;
        const newStep = createDefaultStep(newKind as StepKind);
        const data = n.data as StepNodeData;
        return { ...n, data: { ...data, step: newStep, label: newKind } };
      });
      const nextEdges = filterValidEdges(nextNodes as import('@xyflow/react').Node<StepNodeData>[], edgesRef.current);
      setNodes(nextNodes);
      setEdges(nextEdges);
      requestAnimationFrame(() => commitToStore());
    },
    [setNodes, setEdges, commitToStore],
  );

  /* ── Compute static graph order and inject stepIndex (仅静态参考序号) ── */
  const executionOrder = useMemo(() => computeExecutionOrder(nodes as import('@xyflow/react').Node<StepNodeData>[], edges), [nodes, edges]);

  const nodesWithIndex = useMemo(
    () =>
      nodes.map((n) => {
        if (isSpecialNode(n)) return n;
        const idx = executionOrder.get(n.id);
        const data = n.data as StepNodeData;
        const newIndex = idx != null ? idx - 1 : -1; // -1 means orphan
        if (data.stepIndex === newIndex) return n;
        return { ...n, data: { ...data, stepIndex: newIndex } };
      }),
    [nodes, executionOrder],
  );

  const runtimeState = designer.workflow_id
    ? runtime.workflow_states?.[designer.workflow_id]
    : undefined;
  const liveRunningNodeId = runtimeState?.current_node_id ?? '';
  const [visibleRunningNodeId, setVisibleRunningNodeId] = useState('');

  useEffect(() => {
    if (liveRunningNodeId) {
      setVisibleRunningNodeId(liveRunningNodeId);
      return;
    }
    const timer = window.setTimeout(() => {
      setVisibleRunningNodeId('');
    }, 650);
    return () => window.clearTimeout(timer);
  }, [liveRunningNodeId]);

  const nodesWithRuntime = useMemo(
    () =>
      nodesWithIndex.map((node) => {
        if (isSpecialNode(node)) return node;
        const data = node.data as StepNodeData;
        const isRunning = node.id === visibleRunningNodeId;
        if (data.isRunning === isRunning) return node;
        return { ...node, data: { ...data, isRunning } };
      }),
    [nodesWithIndex, visibleRunningNodeId],
  );

  const selectedNode = nodesWithRuntime.find((n) => n.id === selectedNodeId);
  const selectedData = selectedNode?.data as StepNodeData | undefined;
  const workflowSteps = useMemo(
    () => nodesWithRuntime
      .filter((node) => !isSpecialNode(node))
      .map((node) => (node.data as StepNodeData).step),
    [nodesWithRuntime],
  );
  const referencedSharedVariables = useMemo(
    () => collectReferencedSharedVariables(workflowSteps as Array<Record<string, unknown>>),
    [workflowSteps],
  );
  const sharedMonitorMap = useMemo(
    () => new Map(asyncMonitors.map((monitor) => [monitor.output_variable, monitor] as const)),
    [asyncMonitors],
  );
  const orderedSharedSnapshots = useMemo(() => {
    const referencedSet = new Set(referencedSharedVariables);
    return [...sharedVariables].sort((a, b) => {
      const aRef = referencedSet.has(a.name) ? 0 : 1;
      const bRef = referencedSet.has(b.name) ? 0 : 1;
      if (aRef !== bRef) return aRef - bRef;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [sharedVariables, referencedSharedVariables]);
  const visibleSharedSnapshots = useMemo(() => {
    if (orderedSharedSnapshots.length === 0) return [];
    const referencedSet = new Set(referencedSharedVariables);
    const referenced = orderedSharedSnapshots.filter((item) => referencedSet.has(item.name));
    return referenced.length > 0 ? referenced : orderedSharedSnapshots.filter((item) => sharedMonitorMap.has(item.name));
  }, [orderedSharedSnapshots, referencedSharedVariables, sharedMonitorMap]);

  useEffect(() => {
    if (!isOpen || !liveRunningNodeId) {
      lastAutoFocusNodeIdRef.current = '';
      return;
    }
    if (lastAutoFocusNodeIdRef.current === liveRunningNodeId) return;

    const targetNode = nodesWithRuntime.find((node) => node.id === liveRunningNodeId);
    if (!targetNode) return;

    lastAutoFocusNodeIdRef.current = liveRunningNodeId;
    const zoom = Math.max(getZoom(), 0.85);
    const targetX = targetNode.position.x + 90;
    const targetY = targetNode.position.y + 40;
    void setCenter(targetX, targetY, { zoom, duration: 280 });
  }, [isOpen, liveRunningNodeId, nodesWithRuntime, getZoom, setCenter]);

  if (!isOpen) return null;

  return (
    <div className="node-editor-container" onKeyDown={onKeyDown} tabIndex={0}>
      <NodePalette />

      <div className="node-editor-main">
        <div
          className="node-editor-canvas"
          ref={reactFlowWrapper}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodesWithRuntime}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2}
            defaultEdgeOptions={{ type: 'default', animated: false }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--line)" />
            <Controls position="top-left" />
            <MiniMap
              nodeColor={(node) => {
                const data = node.data as StepNodeData;
                if (data?.nodeRole === 'start') return '#22c55e';
                if (data?.nodeRole === 'end') return '#ef4444';
                return getKindColor(data?.step?.kind ?? '');
              }}
              maskColor="rgba(0,0,0,0.6)"
              style={{ background: 'var(--bg-elevated)' }}
            />
          </ReactFlow>

          <div className="node-editor-toolbar">
            <button className="ghost-button" onClick={handleFitView} title="适应视图">⊞</button>
          </div>
        </div>

        {(runtimeState || saveState.status === 'dirty' || visibleSharedSnapshots.length > 0) && (
          <div className="node-runtime-stack">
            {(runtimeState || saveState.status === 'dirty') && (
              <div className="node-runtime-banner">
                {runtimeState ? (
                  <>
                    <span className={`runtime-badge ${runtimeBadgeTone(runtimeState.status)}`}>
                      {runtimeState.status_label || runtimeState.status || '未知'}
                    </span>
                    <span>
                      {runtimeState.current_step_kind ? `当前节点 ${runtimeState.current_step_kind}` : '当前暂无节点执行中'}
                      {runtimeState.last_message ? ` · ${runtimeState.last_message}` : ''}
                    </span>
                    {runtimeState.last_click_message && (
                      <span className="node-runtime-banner-click">
                        最近点击：{runtimeState.last_click_message}
                      </span>
                    )}
                  </>
                ) : (
                  <span>当前流程暂无运行态快照。</span>
                )}
                {saveState.status === 'dirty' && designer.workflow_id && (
                  <span className="node-runtime-banner-warning">
                    当前节点图尚未保存；现在运行/按热键执行的仍是上一次已保存版本，请先保存再验证 click_point 参数。
                  </span>
                )}
              </div>
            )}

            {visibleSharedSnapshots.length > 0 && (
              <div className="shared-variable-monitor">
                <div className="shared-variable-monitor-head">
                  <strong>共享变量监视</strong>
                  <span>
                    {referencedSharedVariables.length > 0 ? '优先显示当前流程引用的 shared 变量' : '当前流程尚未引用 shared 变量，展示已启用 monitor'}
                  </span>
                </div>
                <div className="shared-variable-monitor-list">
                  {visibleSharedSnapshots.map((snapshot) => {
                    const monitor = sharedMonitorMap.get(snapshot.name);
                    const state = getSharedVariableStatus(snapshot, monitor?.runtime?.status);
                    const runtimeMessage = monitor?.runtime?.message?.trim();
                    const summary = formatSharedVariableSummary(snapshot) || runtimeMessage || snapshot._shared?.message?.trim() || '';
                    return (
                      <article key={snapshot.name} className="shared-variable-card">
                        <div className="shared-variable-card-head">
                          <div>
                            <strong>{snapshot.name}</strong>
                            <span>{snapshot._shared?.monitor_name ? `来源：${snapshot._shared.monitor_name}` : '来源：后台识图'}</span>
                          </div>
                          <span className={`shared-variable-badge ${state.tone}`}>{state.label}</span>
                        </div>
                        <div className="shared-variable-card-body">
                          {summary ? <span>{summary}</span> : <span>当前还没有命中坐标或状态消息。</span>}
                          {monitor?.runtime?.status === 'paused' && (
                            <span className="shared-variable-card-tip">监控已启用，但当前没有启用流程引用，因此暂停运行。</span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedData && selectedNode && (
        <NodeInspector
          nodeId={selectedNode.id}
          data={selectedData}
          workflowSteps={workflowSteps}
          onClose={() => setSelectedNodeId(null)}
          onUpdateField={updateNodeData}
          onChangeKind={changeNodeKind}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          nodeId={contextMenu.nodeId}
          isProtected={
            contextMenu.type === 'node' && contextMenu.nodeId
              ? !!nodesWithRuntime.find((n) => n.id === contextMenu.nodeId && isStartNode(n))
              : false
          }
          onClose={() => setContextMenu(null)}
          onDelete={deleteNode}
          onDuplicate={duplicateNode}
          onSelect={(id) => setSelectedNodeId(id)}
          onAddNode={addNodeAtPosition}
          onPaste={pasteNode}
          onFitView={handleFitView}
          hasClipboard={!!clipboardRef.current}
        />
      )}
    </div>
  );
}

export default function NodeEditorPanel() {
  return (
    <ReactFlowProvider>
      <NodeEditorInner />
    </ReactFlowProvider>
  );
}
