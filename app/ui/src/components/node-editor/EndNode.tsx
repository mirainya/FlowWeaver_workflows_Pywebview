import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { StepNodeData } from './graph-utils';

type EndNodeType = Node<StepNodeData, 'endNode'>;

function EndNode(_props: NodeProps<EndNodeType>) {
  return (
    <div className="end-node">
      <Handle type="target" position={Position.Top} id="top" className="step-handle" />
      结束
    </div>
  );
}

export default memo(EndNode);
