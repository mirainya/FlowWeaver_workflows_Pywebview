import { useMemo } from 'react';
import type { Step } from '../../models/step';

/** Extract all variable names produced by steps (detect_image.save_as, set_variable.var_name, etc.) */
export function extractVariableNames(steps: Step[]): string[] {
  const names = new Set<string>();
  const walk = (list: Step[]) => {
    for (const s of list) {
      if (s.save_as && typeof s.save_as === 'string') names.add(s.save_as);
      if ((s.kind === 'set_variable' || s.kind === 'set_variable_state') && s.var_name && typeof s.var_name === 'string') names.add(s.var_name);
      if (Array.isArray(s.then_steps)) walk(s.then_steps as Step[]);
      if (Array.isArray(s.else_steps)) walk(s.else_steps as Step[]);
      if (Array.isArray(s.steps)) walk(s.steps as Step[]);
    }
  };
  walk(steps);
  return Array.from(names).sort();
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  steps: Step[];
  label?: string;
}

export default function VariableSelector({ value, onChange, steps, label = '变量名' }: Props) {
  const variables = useMemo(() => extractVariableNames(steps), [steps]);

  return (
    <div className="field-cell">
      <label className="field-cell-label">{label}</label>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          className="field-input"
          type="text"
          list="var-suggestions"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入或选择变量"
          style={{ flex: 1 }}
        />
        <datalist id="var-suggestions">
          {variables.map((v) => <option key={v} value={v} />)}
        </datalist>
      </div>
    </div>
  );
}
