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
import {
  stepsToGraph,
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
import { type StepKind, createDefaultStep } from '../../models/step';

const nodeTypes: NodeTypes = {
  stepNode: StepNode,
  startNode: StartNode,
  endNode: EndNode,
};

function NodeEditorInner() {
  const { designer, isOpen, _nodeGraph } = useDesignerStore();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'node' | 'pane'; nodeId?: string } | null>(null);
  const clipboardRef = useRef<import('@xyflow/react').Node | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => {
      let result: { nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[] };
      if (_nodeGraph && _nodeGraph.nodes.length > 0) {
        result = { nodes: [..._nodeGraph.nodes], edges: [..._nodeGraph.edges] };
      } else {
        result = stepsToGraph(designer.steps);
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

  /** Keep refs to latest local state for commitToStore */
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  /** Sync current local state to store + push undo snapshot */
  const commitToStore = useCallback(() => {
    setNodeGraph(nodesRef.current as import('@xyflow/react').Node<StepNodeData>[], edgesRef.current);
    markDirty();
  }, [setNodeGraph, markDirty]);

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
  const { fitView } = useReactFlow();
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
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const newStep = createDefaultStep(newKind as StepKind);
          const data = n.data as StepNodeData;
          return { ...n, data: { ...data, step: newStep, label: newKind } };
        }),
      );
      requestAnimationFrame(() => commitToStore());
    },
    [setNodes, commitToStore],
  );

  /* ── Compute execution order and inject stepIndex ── */
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

  const selectedNode = nodesWithIndex.find((n) => n.id === selectedNodeId);
  const selectedData = selectedNode?.data as StepNodeData | undefined;

  if (!isOpen) return null;

  return (
    <div className="node-editor-container" onKeyDown={onKeyDown} tabIndex={0}>
      <NodePalette />

      <div
        className="node-editor-canvas"
        ref={reactFlowWrapper}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <ReactFlow
          nodes={nodesWithIndex}
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
          <Controls position="bottom-left" />
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

      {selectedData && selectedNode && (
        <NodeInspector
          nodeId={selectedNode.id}
          data={selectedData}
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
              ? !!nodesWithIndex.find((n) => n.id === contextMenu.nodeId && isStartNode(n))
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
