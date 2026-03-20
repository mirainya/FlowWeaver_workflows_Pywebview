import { stepTypeLabel, STEP_TYPE_GROUPS } from '../../models/step';
import type { Step } from '../../models/step';
import type { StepNodeData } from './graph-utils';
import { getKindColor } from './graph-utils';
import InspectorFieldFactory from './inspector-fields/InspectorFieldFactory';

interface NodeInspectorProps {
  nodeId: string;
  data: StepNodeData;
  workflowSteps: Step[];
  onClose: () => void;
  onUpdateField: (nodeId: string, field: string, value: unknown) => void;
  onChangeKind: (nodeId: string, newKind: string) => void;
}

export default function NodeInspector({ nodeId, data, workflowSteps, onClose, onUpdateField, onChangeKind }: NodeInspectorProps) {
  const { step } = data;
  const color = getKindColor(step.kind);
  const update = (field: string, value: unknown) => onUpdateField(nodeId, field, value);

  return (
    <aside className="node-inspector">
      <div className="node-inspector-head">
        <div>
          <span className="node-inspector-badge" style={{ background: `${color}22`, color }}>{stepTypeLabel(step.kind)}</span>
          <span className="node-inspector-path">{nodeId}</span>
        </div>
        <button className="ghost-button icon-button" onClick={onClose}>✕<span className="sr-only">关闭</span></button>
      </div>

      <div className="node-inspector-body">
        {/* Kind selector */}
        <div className="inspector-field">
          <label className="inspector-label">步骤类型</label>
          <select
            className="field-input"
            value={step.kind}
            onChange={(e) => onChangeKind(nodeId, e.target.value)}
          >
            {STEP_TYPE_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Dynamic fields based on step kind */}
        <InspectorFieldFactory step={step} workflowSteps={workflowSteps} update={update} />
      </div>
    </aside>
  );
}
