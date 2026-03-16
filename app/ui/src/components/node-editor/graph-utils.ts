import type { Step, StepKind } from '../../models/step';
import { createDefaultStep, VISUAL_DETECT_KINDS, stepHasBranch } from '../../models/step';
import type { Node, Edge } from '@xyflow/react';

/* ── Node data type ── */

export interface StepNodeData {
  step: Step;
  stepIndex: number;
  stepPath: string;
  label: string;
  nodeRole?: 'start' | 'end';
  [key: string]: unknown;
}

/* ── Start / End node constants & helpers ── */

export const START_NODE_ID = '__start__';

export function createStartNode(position: { x: number; y: number }): Node<StepNodeData> {
  return {
    id: START_NODE_ID,
    type: 'startNode',
    position,
    data: {
      step: { kind: 'log' } as Step,
      stepIndex: -1,
      stepPath: '',
      label: '开始',
      nodeRole: 'start',
    },
  };
}

let _endNodeCounter = 0;

export function createEndNode(position: { x: number; y: number }): Node<StepNodeData> {
  const id = `__end__${Date.now()}_${_endNodeCounter++}`;
  return {
    id,
    type: 'endNode',
    position,
    data: {
      step: { kind: 'log' } as Step,
      stepIndex: -1,
      stepPath: '',
      label: '结束',
      nodeRole: 'end',
    },
  };
}

export function isStartNode(node: { data?: { nodeRole?: string }; id?: string }): boolean {
  return node.data?.nodeRole === 'start' || node.id === START_NODE_ID;
}

export function isEndNode(node: { data?: { nodeRole?: string }; id?: string }): boolean {
  return node.data?.nodeRole === 'end' || (node.id?.startsWith('__end__') ?? false);
}

export function isSpecialNode(node: { data?: { nodeRole?: string }; id?: string }): boolean {
  return isStartNode(node) || isEndNode(node);
}

/**
 * Compute execution order by walking from the start node via bottom→then→else→loop handles.
 * Returns Map<nodeId, 1-based index>. Orphan nodes are not in the map.
 */
export function computeExecutionOrder(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
): Map<string, number> {
  const order = new Map<string, number>();

  // Build outgoing adjacency
  const outgoing = new Map<string, string>();
  for (const e of edges) {
    const key = `${e.source}::${e.sourceHandle ?? 'bottom'}`;
    outgoing.set(key, e.target);
  }

  const startNode = nodes.find((n) => isStartNode(n));
  if (!startNode) return order;

  const visited = new Set<string>();
  let counter = 0;

  function dfs(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (!isSpecialNode(node)) {
      counter++;
      order.set(nodeId, counter);
    }

    // Walk: bottom → then → else → loop
    for (const handle of ['bottom', 'then', 'else', 'loop']) {
      const target = outgoing.get(`${nodeId}::${handle}`);
      if (target) dfs(target);
    }
  }

  dfs(startNode.id);
  return order;
}

/* ── Layout constants ── */

const NODE_X_START = 80;
const NODE_Y_START = 60;
const NODE_Y_GAP = 120;
const NODE_X_OFFSET = 260;

/* ── Color map for step kinds ── */

const KIND_COLORS: Record<string, string> = {
  key_tap: '#60a5fa',
  key_sequence: '#60a5fa',
  key_hold: '#60a5fa',
  click_point: '#a78bfa',
  mouse_move: '#a78bfa',
  mouse_drag: '#a78bfa',
  mouse_scroll: '#a78bfa',
  mouse_hold: '#a78bfa',
  detect_image: '#22d3ee',
  detect_color: '#22d3ee',
  check_pixels: '#22d3ee',
  check_region_color: '#22d3ee',
  detect_color_region: '#22d3ee',
  match_fingerprint: '#22d3ee',
  if_var_found: '#fbbf24',
  if_condition: '#fbbf24',
  loop: '#f97316',
  set_variable_state: '#34d399',
  set_variable: '#34d399',
  type_text: '#34d399',
  call_workflow: '#f472b6',
  delay: '#94a3b8',
  log: '#94a3b8',
};

export function getKindColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#94a3b8';
}

/* ── Kind group labels ── */

const KIND_GROUP: Record<string, string> = {
  key_tap: '键盘', key_sequence: '键盘', key_hold: '键盘',
  click_point: '鼠标', mouse_move: '鼠标', mouse_drag: '鼠标', mouse_scroll: '鼠标', mouse_hold: '鼠标',
  detect_image: '视觉', detect_color: '视觉', check_pixels: '视觉', check_region_color: '视觉', detect_color_region: '视觉', match_fingerprint: '视觉',
  if_var_found: '判断', if_condition: '判断', loop: '循环',
  set_variable_state: '数据', set_variable: '数据', type_text: '数据',
  call_workflow: '流程', delay: '控制', log: '控制',
};

export function getKindGroup(kind: string): string {
  return KIND_GROUP[kind] ?? '其他';
}

/* ── Steps → Nodes + Edges ── */

interface ConvertResult {
  nodes: Node<StepNodeData>[];
  edges: Edge[];
}

export function stepsToGraph(steps: Step[], basePath = 'steps'): ConvertResult {
  const nodes: Node<StepNodeData>[] = [];
  const edges: Edge[] = [];

  // Create start node
  const startNode = createStartNode({ x: NODE_X_START, y: NODE_Y_START });
  nodes.push(startNode);

  const walkStartY = NODE_Y_START + NODE_Y_GAP;

  function walk(
    stepList: Step[],
    path: string,
    startX: number,
    startY: number,
    parentNodeId?: string,
    parentHandle?: string,
  ): { lastNodeId: string | null; nextY: number } {
    let y = startY;
    let prevId: string | null = parentNodeId ?? null;
    let prevHandle = parentHandle ?? 'bottom';

    for (let i = 0; i < stepList.length; i++) {
      const step = stepList[i];
      const stepPath = `${path}.${i}`;
      const nodeId = `node-${stepPath}`;

      nodes.push({
        id: nodeId,
        type: 'stepNode',
        position: { x: startX, y },
        data: {
          step,
          stepIndex: i,
          stepPath,
          label: step.kind,
        },
      });

      if (prevId) {
        edges.push({
          id: `edge-${prevId}-${nodeId}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: nodeId,
          targetHandle: 'top',
          type: 'default',
          animated: false,
        });
      }

      prevHandle = 'bottom';

      // Handle branching steps (if_* always, visual detect only when branch exists)
      const isBranchNode = step.kind === 'if_var_found' || step.kind === 'if_condition' || (VISUAL_DETECT_KINDS.has(step.kind) && stepHasBranch(step));
      if (isBranchNode) {
        const thenSteps = (step.then_steps ?? []) as Step[];
        const elseSteps = (step.else_steps ?? []) as Step[];

        let branchEndY = y + NODE_Y_GAP;

        if (thenSteps.length > 0) {
          const thenResult = walk(thenSteps, `${stepPath}.then_steps`, startX - NODE_X_OFFSET / 2, y + NODE_Y_GAP, nodeId, 'then');
          branchEndY = Math.max(branchEndY, thenResult.nextY);
        }

        if (elseSteps.length > 0) {
          const elseResult = walk(elseSteps, `${stepPath}.else_steps`, startX + NODE_X_OFFSET / 2, y + NODE_Y_GAP, nodeId, 'else');
          branchEndY = Math.max(branchEndY, elseResult.nextY);
        }

        y = branchEndY;
      } else if (step.kind === 'loop' || step.kind === 'key_hold') {
        const innerSteps = (step.steps ?? []) as Step[];
        if (innerSteps.length > 0) {
          const innerResult = walk(innerSteps, `${stepPath}.steps`, startX + NODE_X_OFFSET / 2, y + NODE_Y_GAP, nodeId, 'loop');
          y = innerResult.nextY;
        } else {
          y += NODE_Y_GAP;
        }
      } else {
        y += NODE_Y_GAP;
      }

      prevId = nodeId;
    }

    return { lastNodeId: prevId, nextY: y };
  }

  const walkResult = walk(steps, basePath, NODE_X_START, walkStartY, START_NODE_ID, 'bottom');

  // Create end node after the last step (or directly after start if empty)
  const endY = walkResult.lastNodeId ? walkResult.nextY : walkStartY;
  const endNode = createEndNode({ x: NODE_X_START, y: endY });
  nodes.push(endNode);

  const lastId = walkResult.lastNodeId ?? START_NODE_ID;
  edges.push({
    id: `edge-${lastId}-${endNode.id}`,
    source: lastId,
    sourceHandle: 'bottom',
    target: endNode.id,
    targetHandle: 'top',
    type: 'default',
    animated: false,
  });

  return { nodes, edges };
}

/* ── Create a new ReactFlow node from a step kind ── */

let _nodeIdCounter = 0;

export function createNodeFromKind(
  kind: StepKind,
  position: { x: number; y: number },
): Node<StepNodeData> {
  const step = createDefaultStep(kind);
  const id = `node-new-${Date.now()}-${_nodeIdCounter++}`;
  return {
    id,
    type: 'stepNode',
    position,
    data: {
      step,
      stepIndex: 0,
      stepPath: '',
      label: kind,
    },
  };
}

/* ── Graph → Steps (topological sort) ── */

/**
 * Convert ReactFlow nodes + edges back to a linear steps[] array.
 * - Prefers start node as entry point; falls back to "no top incoming + Y sort" for old data
 * - Follows 'bottom' handle edges depth-first
 * - Branch nodes (if_var_found / if_condition): then/else handles → recursive
 * - Loop nodes (loop / key_hold): loop handle → recursive
 * - Special nodes (start/end) are skipped — they don't produce steps
 * - Orphan nodes (not reachable from start) are excluded
 */
export function graphToSteps(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
): Step[] {
  if (nodes.length === 0) return [];

  const nodeMap = new Map<string, Node<StepNodeData>>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Build adjacency: sourceId+sourceHandle → targetId
  const outgoing = new Map<string, string>();
  for (const e of edges) {
    const key = `${e.source}::${e.sourceHandle ?? 'bottom'}`;
    outgoing.set(key, e.target);
  }

  const visited = new Set<string>();

  function walkChain(startId: string): Step[] {
    const steps: Step[] = [];
    let currentId: string | undefined = startId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodeMap.get(currentId);
      if (!node) break;

      // Skip special nodes (start/end) — they are not real steps
      if (isSpecialNode(node)) {
        currentId = outgoing.get(`${currentId}::bottom`);
        continue;
      }

      const step: Step = deepCloneStep(node.data.step);

      // Handle branch nodes
      if (step.kind === 'if_var_found' || step.kind === 'if_condition') {
        const thenTarget = outgoing.get(`${currentId}::then`);
        const elseTarget = outgoing.get(`${currentId}::else`);
        step.then_steps = thenTarget ? walkChain(thenTarget) : [];
        step.else_steps = elseTarget ? walkChain(elseTarget) : [];
      } else if (VISUAL_DETECT_KINDS.has(step.kind)) {
        const thenTarget = outgoing.get(`${currentId}::then`);
        const elseTarget = outgoing.get(`${currentId}::else`);
        if (thenTarget || elseTarget) {
          step.then_steps = thenTarget ? walkChain(thenTarget) : [];
          step.else_steps = elseTarget ? walkChain(elseTarget) : [];
        }
      }

      // Handle loop nodes
      if (step.kind === 'loop' || step.kind === 'key_hold') {
        const loopTarget = outgoing.get(`${currentId}::loop`);
        step.steps = loopTarget ? walkChain(loopTarget) : [];
      }

      steps.push(step);

      // Follow 'bottom' handle to next node
      currentId = outgoing.get(`${currentId}::bottom`);
    }

    return steps;
  }

  // Prefer start node as entry
  const startNode = nodes.find((n) => isStartNode(n));
  if (startNode) {
    return walkChain(startNode.id);
  }

  // Fallback for old data: no start node → use "no top incoming + Y sort"
  const hasIncoming = new Set<string>();
  for (const e of edges) {
    if ((e.targetHandle ?? 'top') === 'top') {
      hasIncoming.add(e.target);
    }
  }

  const entryNodes = nodes
    .filter((n) => !hasIncoming.has(n.id) && !isSpecialNode(n))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  const allSteps: Step[] = [];
  for (const entry of entryNodes) {
    const chain = walkChain(entry.id);
    allSteps.push(...chain);
  }

  return allSteps;
}

function deepCloneStep(step: Step): Step {
  return JSON.parse(JSON.stringify(step));
}
