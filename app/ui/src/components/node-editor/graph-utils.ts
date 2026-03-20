import type { Step, StepKind } from '../../models/step';
import { createDefaultStep, VISUAL_DETECT_KINDS, stepHasBranch } from '../../models/step';
import type { Node, Edge } from '@xyflow/react';

export interface StepNodeData {
  step: Step;
  stepIndex: number;
  label: string;
  nodeRole?: 'start' | 'end';
  isRunning?: boolean;
  [key: string]: unknown;
}

export const START_NODE_ID = '__start__';

export function createStartNode(position: { x: number; y: number }): Node<StepNodeData> {
  return {
    id: START_NODE_ID,
    type: 'startNode',
    position,
    data: {
      step: { kind: 'log' } as Step,
      stepIndex: -1,
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

export function computeExecutionOrder(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
): Map<string, number> {
  const order = new Map<string, number>();
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string>();

  for (const edge of edges) {
    const key = `${edge.source}::${edge.sourceHandle ?? 'bottom'}`;
    outgoing.set(key, edge.target);
  }

  const startNode = nodes.find((node) => isStartNode(node));
  if (!startNode) return order;

  const visited = new Set<string>();
  let counter = 0;

  function visit(nodeId: string | undefined) {
    if (!nodeId || visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) return;

    if (!isSpecialNode(node)) {
      counter += 1;
      order.set(nodeId, counter);
    }

    if (isEndNode(node)) return;

    const stepKind = node.data.step.kind;

    if (stepKind === 'loop' || stepKind === 'key_hold') {
      visit(outgoing.get(`${nodeId}::loop`));
      visit(outgoing.get(`${nodeId}::bottom`));
      return;
    }

    if (stepKind === 'if_var_found' || stepKind === 'if_condition' || VISUAL_DETECT_KINDS.has(stepKind)) {
      visit(outgoing.get(`${nodeId}::then`));
      visit(outgoing.get(`${nodeId}::else`));
      visit(outgoing.get(`${nodeId}::bottom`));
      return;
    }

    visit(outgoing.get(`${nodeId}::bottom`));
  }

  visit(startNode.id);
  return order;
}

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
  async_detect: '#22d3ee',
};

export function getKindColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#94a3b8';
}

const KIND_GROUP: Record<string, string> = {
  key_tap: '键盘', key_sequence: '键盘', key_hold: '键盘',
  click_point: '鼠标', mouse_move: '鼠标', mouse_drag: '鼠标', mouse_scroll: '鼠标', mouse_hold: '鼠标',
  detect_image: '视觉', detect_color: '视觉', check_pixels: '视觉', check_region_color: '视觉', detect_color_region: '视觉', match_fingerprint: '视觉', async_detect: '视觉',
  if_var_found: '判断', if_condition: '判断', loop: '循环',
  set_variable_state: '数据', set_variable: '数据', type_text: '数据',
  call_workflow: '流程', delay: '控制', log: '控制',
};

export function getKindGroup(kind: string): string {
  return KIND_GROUP[kind] ?? '其他';
}

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
      label: kind,
    },
  };
}

export function nodeSupportsBranch(step: Step): boolean {
  return stepHasBranch(step);
}
