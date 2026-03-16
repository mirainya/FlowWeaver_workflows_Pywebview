import type { Step } from '../../../models/step';
import { VISUAL_DETECT_KINDS, stepTypeLabel, createDefaultStep } from '../../../models/step';
import { FieldInput, FieldNumber, FieldSelect } from '../fields';
import TemplateFilePicker from '../../shared/TemplateFilePicker';
import WorkflowSelector from '../../shared/WorkflowSelector';

interface StepFieldsProps {
  step: Step;
  stepPath: string;
  updateStepField: (stepPath: string, field: string, value: unknown) => void;
}

export default function StepFields({ step, stepPath, updateStepField }: StepFieldsProps) {
  const update = (field: string, value: unknown) => updateStepField(stepPath, field, value);

  const isVisualDetect = VISUAL_DETECT_KINDS.has(step.kind);
  const hasBranchEnabled = isVisualDetect && (Array.isArray(step.then_steps) || Array.isArray(step.else_steps));

  const toggleBranch = () => {
    if (hasBranchEnabled) {
      update('then_steps', undefined);
      update('else_steps', undefined);
    } else {
      update('then_steps', [createDefaultStep('key_tap')]);
      update('else_steps', []);
    }
  };

  const branchToggle = isVisualDetect ? (
    <div className="field-cell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{ fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="checkbox" checked={!!hasBranchEnabled} onChange={toggleBranch} />
        启用分支（根据检测结果执行不同步骤）
      </label>
    </div>
  ) : null;

  switch (step.kind) {
    case 'key_tap':
      return (
        <div className="step-fields-grid">
          <FieldInput label="按键" value={step.keys as string} onChange={(v) => update('keys', v)} placeholder="如 enter" />
          <FieldNumber label="按后延迟(ms)" value={step.delay_ms_after as number} onChange={(v) => update('delay_ms_after', v)} />
        </div>
      );
    case 'delay':
      return (
        <div className="step-fields-grid">
          <FieldNumber label="等待(ms)" value={step.milliseconds as number} onChange={(v) => update('milliseconds', v)} />
          <FieldNumber label="随机最小" value={step.random_min as number} onChange={(v) => update('random_min', v)} />
          <FieldNumber label="随机最大" value={step.random_max as number} onChange={(v) => update('random_max', v)} />
        </div>
      );
    case 'detect_image':
      return (
        <div className="step-fields-grid">
          <TemplateFilePicker value={step.template_path as string} onChange={(v) => update('template_path', v)} />
          <FieldInput label="保存为" value={step.save_as as string} onChange={(v) => update('save_as', v)} />
          <FieldNumber label="置信度" value={step.confidence as number} onChange={(v) => update('confidence', v)} step={0.01} />
          <FieldNumber label="超时(ms)" value={step.timeout_ms as number} onChange={(v) => update('timeout_ms', v)} />
          {branchToggle}
        </div>
      );
    case 'click_point':
      return (
        <div className="step-fields-grid">
          <FieldSelect label="来源" value={step.source as string} onChange={(v) => update('source', v)} options={[['var', '变量坐标'], ['absolute', '绝对坐标']]} />
          {step.source === 'absolute' ? (
            <>
              <FieldNumber label="X" value={step.x as number} onChange={(v) => update('x', v)} />
              <FieldNumber label="Y" value={step.y as number} onChange={(v) => update('y', v)} />
            </>
          ) : (
            <FieldInput label="变量名" value={step.var_name as string} onChange={(v) => update('var_name', v)} />
          )}
          <FieldSelect label="按钮" value={step.button as string} onChange={(v) => update('button', v)} options={[['left', '左键'], ['right', '右键'], ['middle', '中键']]} />
          <FieldSelect label="动作" value={step.action as string} onChange={(v) => update('action', v)} options={[['click', '单击'], ['double', '双击'], ['down', '按下'], ['up', '释放']]} />
          <FieldNumber label="偏移X" value={step.offset_x as number} onChange={(v) => update('offset_x', v)} />
          <FieldNumber label="偏移Y" value={step.offset_y as number} onChange={(v) => update('offset_y', v)} />
        </div>
      );
    case 'key_sequence':
      return (
        <div className="step-fields-grid">
          <FieldInput label="按键序列" value={step.keys as string} onChange={(v) => update('keys', v)} placeholder="如 ctrl+a, ctrl+c" />
          <FieldNumber label="间隔(ms)" value={step.interval_ms as number} onChange={(v) => update('interval_ms', v)} />
        </div>
      );
    case 'type_text':
      return (
        <div className="step-fields-grid">
          <FieldInput label="文本" value={step.text as string} onChange={(v) => update('text', v)} />
          <FieldNumber label="间隔(ms)" value={step.interval_ms as number} onChange={(v) => update('interval_ms', v)} />
        </div>
      );
    case 'log':
      return (
        <div className="step-fields-grid">
          <FieldInput label="消息" value={step.message as string} onChange={(v) => update('message', v)} />
          <FieldSelect label="级别" value={step.level as string} onChange={(v) => update('level', v)} options={[['info', '信息'], ['warning', '警告'], ['error', '错误']]} />
        </div>
      );
    case 'mouse_scroll':
      return (
        <div className="step-fields-grid">
          <FieldNumber label="滚动量" value={step.amount as number} onChange={(v) => update('amount', v)} />
          <FieldSelect label="方向" value={step.direction as string} onChange={(v) => update('direction', v)} options={[['down', '向下'], ['up', '向上']]} />
        </div>
      );
    case 'mouse_hold':
      return (
        <div className="step-fields-grid">
          <FieldSelect label="按钮" value={step.button as string} onChange={(v) => update('button', v)} options={[['left', '左键'], ['right', '右键']]} />
          <FieldNumber label="持续(ms)" value={step.duration_ms as number} onChange={(v) => update('duration_ms', v)} />
        </div>
      );
    case 'mouse_drag':
      return (
        <div className="step-fields-grid">
          <FieldNumber label="起点X" value={step.from_x as number} onChange={(v) => update('from_x', v)} />
          <FieldNumber label="起点Y" value={step.from_y as number} onChange={(v) => update('from_y', v)} />
          <FieldNumber label="终点X" value={step.to_x as number} onChange={(v) => update('to_x', v)} />
          <FieldNumber label="终点Y" value={step.to_y as number} onChange={(v) => update('to_y', v)} />
          <FieldNumber label="持续(ms)" value={step.duration_ms as number} onChange={(v) => update('duration_ms', v)} />
        </div>
      );
    case 'mouse_move':
      return (
        <div className="step-fields-grid">
          <FieldSelect label="来源" value={step.source as string} onChange={(v) => update('source', v)} options={[['var', '变量坐标'], ['absolute', '绝对坐标']]} />
          {step.source === 'absolute' ? (
            <>
              <FieldNumber label="X" value={step.x as number} onChange={(v) => update('x', v)} />
              <FieldNumber label="Y" value={step.y as number} onChange={(v) => update('y', v)} />
            </>
          ) : (
            <FieldInput label="变量名" value={step.var_name as string} onChange={(v) => update('var_name', v)} />
          )}
          <FieldNumber label="偏移X" value={step.offset_x as number} onChange={(v) => update('offset_x', v)} />
          <FieldNumber label="偏移Y" value={step.offset_y as number} onChange={(v) => update('offset_y', v)} />
        </div>
      );
    case 'set_variable':
      return (
        <div className="step-fields-grid">
          <FieldInput label="变量名" value={step.var_name as string} onChange={(v) => update('var_name', v)} />
          <FieldInput label="值" value={step.value as string} onChange={(v) => update('value', v)} />
        </div>
      );
    case 'set_variable_state':
      return (
        <div className="step-fields-grid">
          <FieldInput label="变量名" value={step.var_name as string} onChange={(v) => update('var_name', v)} />
          <FieldSelect label="状态" value={step.found as string} onChange={(v) => update('found', v)} options={[['true', '已找到'], ['false', '未找到']]} />
        </div>
      );
    case 'if_var_found':
      return (
        <div className="step-fields-grid">
          <FieldInput label="变量名" value={step.var_name as string} onChange={(v) => update('var_name', v)} />
          {branchToggle}
        </div>
      );
    case 'if_condition':
      return (
        <div className="step-fields-grid">
          <FieldInput label="左值" value={step.left as string} onChange={(v) => update('left', v)} />
          <FieldSelect label="运算符" value={step.operator as string} onChange={(v) => update('operator', v)} options={[['==', '等于'], ['!=', '不等于'], ['>', '大于'], ['<', '小于'], ['>=', '大于等于'], ['<=', '小于等于']]} />
          <FieldInput label="右值" value={step.right as string} onChange={(v) => update('right', v)} />
          {branchToggle}
        </div>
      );
    case 'loop':
      return (
        <div className="step-fields-grid">
          <FieldNumber label="次数" value={step.count as number} onChange={(v) => update('count', v)} />
        </div>
      );
    case 'call_workflow':
      return (
        <div className="step-fields-grid">
          <WorkflowSelector value={step.workflow_id as string} onChange={(v) => update('workflow_id', v)} />
        </div>
      );
    case 'key_hold':
      return (
        <div className="step-fields-grid">
          <FieldInput label="按键" value={step.keys as string} onChange={(v) => update('keys', v)} placeholder="如 shift" />
        </div>
      );
    case 'detect_color':
      return (
        <div className="step-fields-grid">
          <FieldInput label="目标颜色" value={step.target_color as string} onChange={(v) => update('target_color', v)} placeholder="#RRGGBB" />
          <FieldNumber label="X" value={step.x as number} onChange={(v) => update('x', v)} />
          <FieldNumber label="Y" value={step.y as number} onChange={(v) => update('y', v)} />
          <FieldNumber label="容差" value={step.tolerance as number} onChange={(v) => update('tolerance', v)} />
          <FieldInput label="保存为" value={step.save_as as string} onChange={(v) => update('save_as', v)} />
          {branchToggle}
        </div>
      );
    case 'detect_color_region':
      return (
        <div className="step-fields-grid">
          <FieldNumber label="H最小" value={step.h_min as number} onChange={(v) => update('h_min', v)} />
          <FieldNumber label="H最大" value={step.h_max as number} onChange={(v) => update('h_max', v)} />
          <FieldNumber label="S最小" value={step.s_min as number} onChange={(v) => update('s_min', v)} />
          <FieldNumber label="S最大" value={step.s_max as number} onChange={(v) => update('s_max', v)} />
          <FieldNumber label="V最小" value={step.v_min as number} onChange={(v) => update('v_min', v)} />
          <FieldNumber label="V最大" value={step.v_max as number} onChange={(v) => update('v_max', v)} />
          <FieldNumber label="最小面积" value={step.min_area as number} onChange={(v) => update('min_area', v)} />
          <FieldInput label="保存为" value={step.save_as as string} onChange={(v) => update('save_as', v)} />
          {branchToggle}
        </div>
      );
    case 'check_pixels':
      return (
        <div className="step-fields-grid">
          <FieldInput label="保存为" value={step.save_as as string} onChange={(v) => update('save_as', v)} />
          <FieldSelect label="逻辑" value={step.pixel_logic as string} onChange={(v) => update('pixel_logic', v)} options={[['all', '全部匹配'], ['any', '任一匹配']]} />
          {branchToggle}
        </div>
      );
    case 'check_region_color':
      return (
        <div className="step-fields-grid">
          <FieldInput label="目标颜色" value={step.target_color as string} onChange={(v) => update('target_color', v)} placeholder="#RRGGBB" />
          <FieldNumber label="容差" value={step.tolerance as number} onChange={(v) => update('tolerance', v)} />
          <FieldNumber label="最小占比" value={step.min_ratio as number} onChange={(v) => update('min_ratio', v)} step={0.01} />
          <FieldInput label="保存为" value={step.save_as as string} onChange={(v) => update('save_as', v)} />
          {branchToggle}
        </div>
      );
    case 'match_fingerprint':
      return (
        <div className="step-fields-grid">
          <FieldNumber label="容差" value={step.tolerance as number} onChange={(v) => update('tolerance', v)} />
          <FieldInput label="保存为" value={step.save_as as string} onChange={(v) => update('save_as', v)} />
          {branchToggle}
        </div>
      );
    case 'async_detect':
      return (
        <div className="step-fields-grid">
          <TemplateFilePicker value={step.template_path as string} onChange={(v) => update('template_path', v)} />
          <FieldInput label="保存为" value={step.save_as as string} onChange={(v) => update('save_as', v)} />
          <FieldSelect label="识别速度" value={step.scan_rate as string} onChange={(v) => update('scan_rate', v)} options={[['low', '低速(900ms)'], ['normal', '正常(350ms)'], ['high', '高速(150ms)'], ['ultra', '极速(30ms)'], ['custom', '自定义']]} />
          {step.scan_rate === 'custom' && (
            <FieldNumber label="自定义间隔(ms)" value={step.custom_interval_ms as number ?? 350} onChange={(v) => update('custom_interval_ms', v)} />
          )}
          <FieldSelect label="匹配精度" value={step.match_mode as string} onChange={(v) => update('match_mode', v)} options={[['loose', '宽松(0.82)'], ['normal', '正常(0.88)'], ['strict', '严格(0.94)'], ['custom', '自定义']]} />
          {step.match_mode === 'custom' && (
            <FieldNumber label="自定义置信度" value={step.confidence as number} onChange={(v) => update('confidence', v)} step={0.01} />
          )}
          <FieldNumber label="超时(ms)" value={step.timeout_ms as number} onChange={(v) => update('timeout_ms', v)} />
          <FieldSelect label="搜索范围" value={step.search_scope as string} onChange={(v) => update('search_scope', v)} options={[['full_screen', '全屏'], ['fixed_region', '固定区域']]} />
          <FieldSelect label="未找到时" value={step.not_found_action as string} onChange={(v) => update('not_found_action', v)} options={[['mark_missing', '标记未找到'], ['keep_last', '保留上次结果']]} />
          {branchToggle}
        </div>
      );
    default:
      return (
        <div className="step-fields-grid">
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            {stepTypeLabel(step.kind)} — 字段编辑器待完善
          </p>
          {branchToggle}
        </div>
      );
  }
}
