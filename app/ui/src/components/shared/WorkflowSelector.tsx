import { useAppStore } from '../../stores/app';

interface Props {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}

export default function WorkflowSelector({ value, onChange, label = '目标流程' }: Props) {
  const workflows = useAppStore((s) => s.workflows);

  return (
    <div className="field-cell">
      <label className="field-cell-label">{label}</label>
      <select className="field-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— 选择流程 —</option>
        {workflows.map((w) => (
          <option key={w.workflow_id} value={w.workflow_id}>{w.name || w.workflow_id}</option>
        ))}
      </select>
    </div>
  );
}
