import { useId, useMemo } from 'react';
import { useAppStore } from '../../stores/app';
import type { SharedVariableSnapshot } from '../../models/async-vision';
import type { Step } from '../../models/step';

export type VariableSelectorScope = 'local' | 'shared' | 'all';

export interface VariableOption {
  name: string;
  scope: 'local' | 'shared';
  summary?: string;
  statusLabel?: string;
  sourceLabel?: string;
  sharedSnapshot?: SharedVariableSnapshot;
}

export function extractVariableNames(steps: Step[]): string[] {
  const names = new Set<string>();
  for (const s of steps) {
    if (s.save_as && typeof s.save_as === 'string') names.add(s.save_as);
    if ((s.kind === 'set_variable' || s.kind === 'set_variable_state') && s.var_name && typeof s.var_name === 'string') {
      names.add(s.var_name);
    }
  }
  return Array.from(names).sort();
}

function getSharedVariableStateLabel(snapshot?: SharedVariableSnapshot): string {
  if (!snapshot) return '未接入共享状态';
  const status = snapshot._shared?.status ?? 'idle';
  if (status === 'paused') return '已暂停';
  if (status === 'hit') return snapshot.stale ? '命中过旧值' : '已命中';
  if (status === 'miss') return snapshot.stale ? '未命中/旧值' : '未命中';
  if (status === 'running') return '运行中';
  if (status === 'error') return '异常';
  return '待机';
}

function getSharedVariableSummary(snapshot?: SharedVariableSnapshot): string {
  if (!snapshot) return '当前还没有共享变量快照';
  const parts: string[] = [];
  const stateLabel = getSharedVariableStateLabel(snapshot);
  if (stateLabel) parts.push(stateLabel);
  if (typeof snapshot.x === 'number' && typeof snapshot.y === 'number') {
    parts.push(`坐标(${snapshot.x}, ${snapshot.y})`);
  } else if (snapshot.found) {
    parts.push('已命中，但暂无坐标');
  }
  const message = snapshot._shared?.message?.trim();
  if (message) parts.push(message);
  return parts.join(' · ');
}

export function buildVariableOptions(
  steps: Step[],
  sharedVariables: SharedVariableSnapshot[],
  scope: VariableSelectorScope,
): VariableOption[] {
  const options = new Map<string, VariableOption>();

  if (scope !== 'shared') {
    for (const name of extractVariableNames(steps)) {
      options.set(`local:${name}`, {
        name,
        scope: 'local',
        statusLabel: '局部变量',
        sourceLabel: '当前流程',
        summary: '来自当前流程 save_as / set_variable',
      });
    }
  }

  if (scope !== 'local') {
    for (const snapshot of sharedVariables) {
      const name = snapshot._shared?.output_variable || snapshot.name;
      if (!name) continue;
      const sourceLabel = snapshot._shared?.monitor_name
        ? `后台识图 · ${snapshot._shared.monitor_name}`
        : '后台识图';
      options.set(`shared:${name}`, {
        name,
        scope: 'shared',
        statusLabel: getSharedVariableStateLabel(snapshot),
        sourceLabel,
        summary: getSharedVariableSummary(snapshot),
        sharedSnapshot: snapshot,
      });
    }
  }

  return Array.from(options.values()).sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'shared' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSelectOption?: (option: VariableOption) => void;
  steps: Step[];
  label?: string;
  scope?: VariableSelectorScope;
  className?: string;
}

export default function VariableSelector({ value, onChange, onSelectOption, steps, label = '变量名', scope = 'local', className = 'field-cell' }: Props) {
  const listId = useId();
  const sharedVariables = useAppStore((state) => state.sharedVariables);
  const options = useMemo(() => buildVariableOptions(steps, sharedVariables, scope), [steps, sharedVariables, scope]);
  const selected = options.find((item) => item.name === value && (scope === 'all' || item.scope === scope));

  const handleValueChange = (nextValue: string) => {
    onChange(nextValue);
    const matched = options.find((item) => item.name === nextValue);
    if (matched) onSelectOption?.(matched);
  };

  return (
    <div className={className}>
      <label className="field-cell-label">{label}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          className="field-input"
          type="text"
          list={listId}
          value={value ?? ''}
          onChange={(e) => handleValueChange(e.target.value)}
          placeholder={scope === 'shared' ? '输入或选择共享变量' : '输入或选择变量'}
          style={{ flex: 1 }}
        />
        <datalist id={listId}>
          {options.map((option) => <option key={`${option.scope}:${option.name}`} value={option.name} />)}
        </datalist>
        {options.length > 0 && (
          <div className="variable-selector-options">
            {options.map((option) => {
              const active = option.name === value;
              return (
                <button
                  key={`${option.scope}:${option.name}`}
                  type="button"
                  className={`variable-selector-chip${active ? ' active' : ''}`}
                  onClick={() => handleValueChange(option.name)}
                  title={option.summary || option.sourceLabel || option.name}
                >
                  <span>{option.name}</span>
                  {option.statusLabel && <span className="variable-selector-chip-meta">{option.statusLabel}</span>}
                </button>
              );
            })}
          </div>
        )}
        {(selected?.summary || selected?.sourceLabel) && (
          <div className="variable-selector-summary">
            {selected.sourceLabel ? `${selected.sourceLabel} · ` : ''}{selected.summary}
          </div>
        )}
      </div>
    </div>
  );
}
