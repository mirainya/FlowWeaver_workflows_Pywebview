import type { Step, StepKind } from '../../../models/step';
import { STEP_TYPE_GROUPS, stepTypeLabel, VISUAL_DETECT_KINDS } from '../../../models/step';
import StepFields from './StepFields';

interface StepListProps {
  steps: Step[];
  path: string;
  removeStep: (path: string, index: number) => void;
  moveStep: (path: string, index: number, direction: 'up' | 'down') => void;
  updateStepField: (stepPath: string, field: string, value: unknown) => void;
  changeStepKind: (stepPath: string, newKind: StepKind) => void;
  addStep: (parentPath: string) => void;
  depth?: number;
}

export default function StepList({ steps, path, removeStep, moveStep, updateStepField, changeStepKind, addStep, depth = 0 }: StepListProps) {
  if (!steps.length) {
    return <p className="empty-state" style={{ fontSize: 12 }}>暂无步骤，点击"添加步骤"开始。</p>;
  }
  return (
    <div className="step-list" style={{ '--depth': depth } as React.CSSProperties}>
      {steps.map((step, index) => (
        <StepItem
          key={`${path}[${index}]`}
          step={step}
          stepPath={`${path}[${index}]`}
          parentPath={path}
          index={index}
          total={steps.length}
          removeStep={removeStep}
          moveStep={moveStep}
          updateStepField={updateStepField}
          changeStepKind={changeStepKind}
          addStep={addStep}
          depth={depth}
        />
      ))}
    </div>
  );
}

/* ── Single step card ── */

interface StepItemProps {
  step: Step;
  stepPath: string;
  parentPath: string;
  index: number;
  total: number;
  removeStep: (path: string, index: number) => void;
  moveStep: (path: string, index: number, direction: 'up' | 'down') => void;
  updateStepField: (stepPath: string, field: string, value: unknown) => void;
  changeStepKind: (stepPath: string, newKind: StepKind) => void;
  addStep: (parentPath: string) => void;
  depth: number;
}

function StepItem({ step, stepPath, parentPath, index, total, removeStep, moveStep, updateStepField, changeStepKind, addStep, depth }: StepItemProps) {
  return (
    <div className="step-item">
      <div className="step-item-head">
        <span className="step-index">{index + 1}</span>
        <select
          className="field-input step-kind-select"
          value={step.kind}
          onChange={(e) => changeStepKind(stepPath, e.target.value as StepKind)}
        >
          {STEP_TYPE_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="step-item-actions">
          <button className="ghost-button icon-button" disabled={index === 0} onClick={() => moveStep(parentPath, index, 'up')}>↑</button>
          <button className="ghost-button icon-button" disabled={index === total - 1} onClick={() => moveStep(parentPath, index, 'down')}>↓</button>
          <button className="ghost-button icon-button danger" onClick={() => removeStep(parentPath, index)}>✕</button>
        </div>
      </div>

      {step.kind && (
        <div className="step-item-body">
          <StepFields step={step} stepPath={stepPath} updateStepField={updateStepField} />

          {/* Nested step lists */}
          {Array.isArray(step.then_steps) && (
            <div className="nested-steps">
              <div className="nested-steps-label">{VISUAL_DETECT_KINDS.has(step.kind) ? '找到时执行:' : '满足时执行:'}</div>
              <StepList
                steps={step.then_steps as Step[]}
                path={`${stepPath}.then_steps`}
                removeStep={removeStep}
                moveStep={moveStep}
                updateStepField={updateStepField}
                changeStepKind={changeStepKind}
                addStep={addStep}
                depth={depth + 1}
              />
              <button className="ghost-button" style={{ fontSize: 12, marginTop: 4 }} onClick={() => addStep(`${stepPath}.then_steps`)}>+ 添加</button>
            </div>
          )}
          {Array.isArray(step.else_steps) && (
            <div className="nested-steps">
              <div className="nested-steps-label">{VISUAL_DETECT_KINDS.has(step.kind) ? '未找到时执行:' : '不满足时执行:'}</div>
              <StepList
                steps={step.else_steps as Step[]}
                path={`${stepPath}.else_steps`}
                removeStep={removeStep}
                moveStep={moveStep}
                updateStepField={updateStepField}
                changeStepKind={changeStepKind}
                addStep={addStep}
                depth={depth + 1}
              />
              <button className="ghost-button" style={{ fontSize: 12, marginTop: 4 }} onClick={() => addStep(`${stepPath}.else_steps`)}>+ 添加</button>
            </div>
          )}
          {Array.isArray(step.steps) && step.kind !== 'key_sequence' && (
            <div className="nested-steps">
              <div className="nested-steps-label">子步骤:</div>
              <StepList
                steps={step.steps as Step[]}
                path={`${stepPath}.steps`}
                removeStep={removeStep}
                moveStep={moveStep}
                updateStepField={updateStepField}
                changeStepKind={changeStepKind}
                addStep={addStep}
                depth={depth + 1}
              />
              <button className="ghost-button" style={{ fontSize: 12, marginTop: 4 }} onClick={() => addStep(`${stepPath}.steps`)}>+ 添加</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
