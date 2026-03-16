import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { StepNodeData } from './graph-utils';

type StartNodeType = Node<StepNodeData, 'startNode'>;

function StartNode(_props: NodeProps<StartNodeType>) {
  return (
    <div className="start-node">
      开始
      <Handle type="source" position={Position.Bottom} id="bottom" className="step-handle" />
    </div>
  );
}

export default memo(StartNode);
