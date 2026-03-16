import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { StepNodeData } from './graph-utils';
import { getKindColor, getKindGroup } from './graph-utils';
import { stepTypeLabel, stepHasBranch, branchLabels } from '../../models/step';

type StepNodeType = Node<StepNodeData, 'stepNode'>;

function StepNode({ data }: NodeProps<StepNodeType>) {
  const { step, stepIndex } = data;
  const color = getKindColor(step.kind);
  const group = getKindGroup(step.kind);
  const label = stepTypeLabel(step.kind);
  const hasBranch = stepHasBranch(step);
  const labels = branchLabels(step.kind);
  const hasLoop = step.kind === 'loop' || step.kind === 'key_hold';
  const isOrphan = stepIndex < 0;

  // Build summary text
  let summary = '';
  if (step.kind === 'key_tap') summary = String(step.keys ?? '');
  else if (step.kind === 'delay') summary = `${step.milliseconds ?? 0}ms`;
  else if (step.kind === 'detect_image') summary = String(step.template_path ?? '').split(/[/\\]/).pop() ?? '';
  else if (step.kind === 'click_point') summary = step.source === 'var' ? `变量: ${step.var_name}` : `(${step.x}, ${step.y})`;
  else if (step.kind === 'log') summary = String(step.message ?? '');
  else if (step.kind === 'call_workflow') summary = String(step.target_workflow_id ?? '');
  else if (step.kind === 'if_var_found') summary = `${step.var_name ?? 'target'}`;
  else if (step.kind === 'if_condition') summary = `${step.var_name}.${step.field} ${step.operator} ${step.value}`;
  else if (step.kind === 'loop') summary = `${step.loop_type ?? 'count'} × ${step.max_iterations ?? ''}`;
  else if (step.kind === 'detect_color') summary = step.source === 'var' ? `变量: ${step.var_name}` : `(${step.x}, ${step.y}) → ${step.save_as ?? ''}`;
  else if (step.kind === 'check_pixels') { const pts = Array.isArray(step.points) ? step.points : []; summary = `${pts.length}点 ${step.logic ?? 'all'}`; }
  else if (step.kind === 'check_region_color') summary = `区域(${step.left},${step.top},${step.width}×${step.height})`;
  else if (step.kind === 'detect_color_region') summary = `HSV → ${step.save_as ?? ''}`;
  else if (step.kind === 'match_fingerprint') { const sp = Array.isArray(step.sample_points) ? step.sample_points : []; summary = `锚点(${step.anchor_x},${step.anchor_y}) ${sp.length}点`; }

  return (
    <div className={`step-node${isOrphan ? ' step-node-orphan' : ''}`} style={{ borderColor: color }}>
      <Handle type="target" position={Position.Top} id="top" className="step-handle" />

      <div className="step-node-header" style={{ background: `${color}18` }}>
        <span className="step-node-index">{isOrphan ? '—' : stepIndex + 1}</span>
        <span className="step-node-group" style={{ color }}>{group}</span>
        <span className="step-node-kind">{label}</span>
      </div>

      {summary && (
        <div className="step-node-body">
          <span className="step-node-summary">{summary}</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id="bottom" className="step-handle">
        <span className="handle-label handle-label-bottom">下一步</span>
      </Handle>

      {hasBranch && (
        <>
          <Handle type="source" position={Position.Left} id="then" className="step-handle step-handle-then" style={{ background: '#34d399' }}>
            <span className="handle-label handle-label-left" style={{ color: '#34d399' }}>{labels.then}</span>
          </Handle>
          <Handle type="source" position={Position.Right} id="else" className="step-handle step-handle-else" style={{ background: '#f87171' }}>
            <span className="handle-label handle-label-right" style={{ color: '#f87171' }}>{labels.else}</span>
          </Handle>
        </>
      )}

      {hasLoop && (
        <Handle type="source" position={Position.Right} id="loop" className="step-handle step-handle-loop" style={{ background: '#f97316' }}>
          <span className="handle-label handle-label-right" style={{ color: '#f97316' }}>循环体</span>
        </Handle>
      )}
    </div>
  );
}

export default memo(StepNode);
