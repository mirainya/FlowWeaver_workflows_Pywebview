import type { Step } from '../../../models/step';
import { InspectorInput, InspectorKeyInput, InspectorNumber, InspectorSelect, InspectorArrayEditor, InspectorCheckbox, InspectorHint } from './InspectorWidgets';
import TemplateFilePicker from '../../shared/TemplateFilePicker';
import WorkflowSelector from '../../shared/WorkflowSelector';
import VariableSelector, { type VariableOption } from '../../shared/VariableSelector';

interface Props {
  step: Step;
  workflowSteps: Step[];
  update: (field: string, value: unknown) => void;
}

export default function InspectorFieldFactory({ step, workflowSteps, update }: Props) {
  const syncVariableSelection = (option: VariableOption, target: 'scope' | 'source') => {
    if (target === 'scope') {
      update('variable_scope', option.scope);
      return;
    }
    if (option.scope === 'shared') {
      update('source', 'shared');
    } else if (String(step.source ?? '') === 'shared') {
      update('source', 'var');
    }
  };

  const renderVarNameField = (
    scope: 'local' | 'shared',
    label = '变量名',
    fallback = 'target',
    target: 'scope' | 'source' = 'scope',
  ) => (
    scope === 'shared'
      ? <VariableSelector label={label} value={String(step.var_name ?? fallback)} onChange={(v) => update('var_name', v)} onSelectOption={(option) => syncVariableSelection(option, target)} steps={workflowSteps} scope="all" className="inspector-field" />
      : <VariableSelector label={label} value={String(step.var_name ?? fallback)} onChange={(v) => update('var_name', v)} onSelectOption={(option) => syncVariableSelection(option, target)} steps={workflowSteps} scope="all" className="inspector-field" />
  );
  switch (step.kind) {
    case 'key_tap':
      return (
        <>
          <InspectorKeyInput label="按键" value={String(step.keys ?? '')} onChange={(v) => update('keys', v)} />
          <InspectorNumber label="按后延迟(ms)" value={Number(step.delay_ms_after ?? 100)} onChange={(v) => update('delay_ms_after', v)} />
        </>
      );
    case 'delay':
      return (
        <>
          <InspectorNumber label="延迟(ms)" value={Number(step.milliseconds ?? 100)} onChange={(v) => update('milliseconds', v)} />
          <InspectorNumber label="随机最小" value={Number(step.random_min ?? 0)} onChange={(v) => update('random_min', v)} />
          <InspectorNumber label="随机最大" value={Number(step.random_max ?? 0)} onChange={(v) => update('random_max', v)} />
        </>
      );
    case 'detect_image':
      return (
        <>
          <TemplateFilePicker value={String(step.template_path ?? '')} onChange={(v) => update('template_path', v)} />
          <InspectorInput label="保存为" value={String(step.save_as ?? 'target')} onChange={(v) => update('save_as', v)} />
          <InspectorNumber label="置信度" value={Number(step.confidence ?? 0.88)} onChange={(v) => update('confidence', v)} step={0.01} />
          <InspectorNumber label="超时(ms)" value={Number(step.timeout_ms ?? 2500)} onChange={(v) => update('timeout_ms', v)} />
        </>
      );
    case 'click_point':
      return (
        <>
          <InspectorSelect label="来源" value={String(step.source ?? 'var')} options={[['var', '变量'], ['absolute', '绝对坐标'], ['shared', '共享变量'], ['current', '当前鼠标']]} onChange={(v) => update('source', v)} />
          <InspectorHint>
            {step.source === 'absolute' && 'absolute：直接使用下方 X / Y。'}
            {step.source === 'current' && 'current：直接使用触发时的当前鼠标位置。'}
            {step.source === 'var' && 'var：读取当前流程里的局部变量坐标结果。'}
            {step.source === 'shared' && 'shared：读取异步识图等共享变量里的坐标结果。'}
          </InspectorHint>
          {(step.source === 'var' || step.source === 'shared') ? (
            renderVarNameField(step.source === 'shared' ? 'shared' : 'local', '变量名', 'target', 'source')
          ) : step.source === 'absolute' ? (
            <>
              <InspectorNumber label="X" value={Number(step.x ?? 0)} onChange={(v) => update('x', v)} />
              <InspectorNumber label="Y" value={Number(step.y ?? 0)} onChange={(v) => update('y', v)} />
            </>
          ) : null}
          <InspectorSelect label="按钮" value={String(step.button ?? 'left')} options={[['left', '左键'], ['right', '右键']]} onChange={(v) => update('button', v)} />
          <InspectorNumber label="点击次数" value={Number(step.click_count ?? 1)} onChange={(v) => update('click_count', v)} />
          <InspectorNumber label="偏移X" value={Number(step.offset_x ?? 0)} onChange={(v) => update('offset_x', v)} />
          <InspectorNumber label="偏移Y" value={Number(step.offset_y ?? 0)} onChange={(v) => update('offset_y', v)} />
          <InspectorCheckbox label="点击后移回原位置" checked={Boolean(step.return_cursor ?? true)} onChange={(v) => update('return_cursor', v)} />
          <InspectorNumber label="落点稳定(ms)" value={Number(step.settle_ms ?? 60)} onChange={(v) => update('settle_ms', v)} />
          <InspectorSelect label="组合键" value={Array.isArray(step.modifiers) && step.modifiers.length > 0 ? String(step.modifiers[0]) : 'none'} options={[['none', '无'], ['ctrl', 'Ctrl'], ['shift', 'Shift'], ['alt', 'Alt']]} onChange={(v) => update('modifiers', v === 'none' ? [] : [v])} />
          {(Array.isArray(step.modifiers) && step.modifiers.length > 0) && (
            <InspectorNumber label="组合键预压(ms)" value={Number(step.modifier_delay_ms ?? 50)} onChange={(v) => update('modifier_delay_ms', v)} />
          )}
        </>
      );
    case 'key_sequence':
      return (
        <InspectorArrayEditor
          label="按键序列"
          items={Array.isArray(step.sequence) ? step.sequence as Record<string, unknown>[] : []}
          fields={[
            { key: 'keys', label: '按键', type: 'text' },
            { key: 'delay_ms', label: '延迟(ms)', type: 'number' },
          ]}
          defaultItem={{ keys: '', delay_ms: 100 }}
          onChange={(v) => update('sequence', v)}
        />
      );
    case 'type_text':
      return (
        <InspectorInput label="文本" value={String(step.text ?? '')} onChange={(v) => update('text', v)} />
      );
    case 'log':
      return (
        <>
          <InspectorInput label="消息" value={String(step.message ?? '')} onChange={(v) => update('message', v)} />
          <InspectorSelect label="级别" value={String(step.level ?? 'info')} options={[['info', '信息'], ['warn', '警告'], ['success', '成功']]} onChange={(v) => update('level', v)} />
        </>
      );
    case 'mouse_scroll':
      return (
        <>
          <InspectorNumber label="滚动量" value={Number(step.clicks ?? 3)} onChange={(v) => update('clicks', v)} />
          <InspectorSelect label="方向" value={String(step.direction ?? 'down')} options={[['down', '向下'], ['up', '向上'], ['left', '向左'], ['right', '向右']]} onChange={(v) => update('direction', v)} />
        </>
      );
    case 'mouse_hold':
      return (
        <>
          <InspectorSelect label="来源" value={String(step.source ?? 'absolute')} options={[['absolute', '绝对坐标'], ['var', '变量'], ['shared', '共享变量'], ['current', '当前鼠标']]} onChange={(v) => update('source', v)} />
          {step.source === 'absolute' ? (
            <>
              <InspectorNumber label="X" value={Number(step.x ?? 0)} onChange={(v) => update('x', v)} />
              <InspectorNumber label="Y" value={Number(step.y ?? 0)} onChange={(v) => update('y', v)} />
            </>
          ) : (step.source === 'var' || step.source === 'shared') ? (
            renderVarNameField(step.source === 'shared' ? 'shared' : 'local', '变量名', 'target', 'source')
          ) : null}
          <InspectorSelect label="按钮" value={String(step.button ?? 'left')} options={[['left', '左键'], ['right', '右键']]} onChange={(v) => update('button', v)} />
          <InspectorNumber label="持续(ms)" value={Number(step.duration_ms ?? 500)} onChange={(v) => update('duration_ms', v)} />
          <InspectorNumber label="偏移X" value={Number(step.offset_x ?? 0)} onChange={(v) => update('offset_x', v)} />
          <InspectorNumber label="偏移Y" value={Number(step.offset_y ?? 0)} onChange={(v) => update('offset_y', v)} />
        </>
      );
    case 'mouse_drag':
      return (
        <>
          <InspectorSelect label="来源" value={String(step.source ?? 'absolute')} options={[['absolute', '绝对坐标'], ['var', '变量'], ['shared', '共享变量']]} onChange={(v) => update('source', v)} />
          {step.source === 'absolute' ? (
            <>
              <InspectorNumber label="起点X" value={Number(step.start_x ?? 0)} onChange={(v) => update('start_x', v)} />
              <InspectorNumber label="起点Y" value={Number(step.start_y ?? 0)} onChange={(v) => update('start_y', v)} />
            </>
          ) : (
            <>
              {renderVarNameField(step.source === 'shared' ? 'shared' : 'local', '变量名', 'target', 'source')}
              <InspectorNumber label="起点偏移X" value={Number(step.start_offset_x ?? 0)} onChange={(v) => update('start_offset_x', v)} />
              <InspectorNumber label="起点偏移Y" value={Number(step.start_offset_y ?? 0)} onChange={(v) => update('start_offset_y', v)} />
              <InspectorNumber label="终点偏移X" value={Number(step.end_offset_x ?? 0)} onChange={(v) => update('end_offset_x', v)} />
              <InspectorNumber label="终点偏移Y" value={Number(step.end_offset_y ?? 0)} onChange={(v) => update('end_offset_y', v)} />
            </>
          )}
          <InspectorNumber label="终点X" value={Number(step.end_x ?? 0)} onChange={(v) => update('end_x', v)} />
          <InspectorNumber label="终点Y" value={Number(step.end_y ?? 0)} onChange={(v) => update('end_y', v)} />
          <InspectorSelect label="按钮" value={String(step.button ?? 'left')} options={[['left', '左键'], ['right', '右键']]} onChange={(v) => update('button', v)} />
          <InspectorNumber label="持续(ms)" value={Number(step.duration_ms ?? 300)} onChange={(v) => update('duration_ms', v)} />
          <InspectorNumber label="步数" value={Number(step.steps ?? 20)} onChange={(v) => update('steps', v)} />
        </>
      );
    case 'mouse_move':
      return (
        <>
          <InspectorSelect label="来源" value={String(step.source ?? 'absolute')} options={[['absolute', '绝对坐标'], ['var', '变量'], ['shared', '共享变量']]} onChange={(v) => update('source', v)} />
          {step.source === 'absolute' ? (
            <>
              <InspectorNumber label="X" value={Number(step.x ?? 0)} onChange={(v) => update('x', v)} />
              <InspectorNumber label="Y" value={Number(step.y ?? 0)} onChange={(v) => update('y', v)} />
            </>
          ) : (
            <>
              {renderVarNameField(step.source === 'shared' ? 'shared' : 'local', '变量名', 'target', 'source')}
              <InspectorNumber label="偏移X" value={Number(step.offset_x ?? 0)} onChange={(v) => update('offset_x', v)} />
              <InspectorNumber label="偏移Y" value={Number(step.offset_y ?? 0)} onChange={(v) => update('offset_y', v)} />
            </>
          )}
        </>
      );
    case 'if_var_found':
      return (
        <>
          {renderVarNameField(step.variable_scope === 'shared' ? 'shared' : 'local', '变量名', 'target', 'scope')}
          <InspectorSelect label="变量范围" value={String(step.variable_scope ?? 'local')} options={[['local', '局部'], ['shared', '共享']]} onChange={(v) => update('variable_scope', v)} />
        </>
      );
    case 'if_condition':
      return (
        <>
          {renderVarNameField(step.variable_scope === 'shared' ? 'shared' : 'local', '变量名', 'target', 'scope')}
          <InspectorSelect label="变量范围" value={String(step.variable_scope ?? 'local')} options={[['local', '局部'], ['shared', '共享']]} onChange={(v) => update('variable_scope', v)} />
          <InspectorInput label="字段" value={String(step.field ?? 'found')} onChange={(v) => update('field', v)} />
          <InspectorSelect label="运算符" value={String(step.operator ?? '==')} options={[['==', '等于'], ['!=', '不等于'], ['>', '大于'], ['<', '小于'], ['>=', '大于等于'], ['<=', '小于等于']]} onChange={(v) => update('operator', v)} />
          <InspectorInput label="值" value={String(step.value ?? 'true')} onChange={(v) => update('value', v)} />
        </>
      );
    case 'loop':
      return (
        <>
          <InspectorSelect label="循环类型" value={String(step.loop_type ?? 'count')} options={[['count', '固定次数'], ['while_found', '找到时循环'], ['while_not_found', '未找到时循环']]} onChange={(v) => update('loop_type', v)} />
          <InspectorNumber label="最大次数" value={Number(step.max_iterations ?? 10)} onChange={(v) => update('max_iterations', v)} />
          {step.loop_type !== 'count' && (
            <>
              {renderVarNameField(step.variable_scope === 'shared' ? 'shared' : 'local', '变量名', 'target', 'scope')}
              <InspectorSelect label="变量范围" value={String(step.variable_scope ?? 'local')} options={[['local', '局部'], ['shared', '共享']]} onChange={(v) => update('variable_scope', v)} />
            </>
          )}
        </>
      );
    case 'set_variable':
      return (
        <>
          <InspectorInput label="变量名" value={String(step.var_name ?? 'target')} onChange={(v) => update('var_name', v)} />
          <InspectorInput label="字段" value={String(step.field ?? 'found')} onChange={(v) => update('field', v)} />
          <InspectorInput label="值" value={String(step.value ?? '')} onChange={(v) => update('value', v)} />
        </>
      );
    case 'set_variable_state':
      return (
        <>
          {renderVarNameField(step.variable_scope === 'shared' ? 'shared' : 'local', '变量名', 'target', 'scope')}
          <InspectorSelect label="变量范围" value={String(step.variable_scope ?? 'local')} options={[['local', '局部'], ['shared', '共享']]} onChange={(v) => update('variable_scope', v)} />
          <InspectorSelect label="状态" value={String(step.state ?? 'missing')} options={[['found', '已找到'], ['missing', '未找到']]} onChange={(v) => update('state', v)} />
        </>
      );
    case 'call_workflow':
      return (
        <WorkflowSelector value={String(step.target_workflow_id ?? '')} onChange={(v) => update('target_workflow_id', v)} />
      );
    case 'key_hold':
      return (
        <InspectorKeyInput label="按键" value={String(step.key ?? '')} onChange={(v) => update('key', v)} />
      );
    case 'detect_color':
      return (
        <>
          <InspectorSelect label="来源" value={String(step.source ?? 'absolute')} options={[['absolute', '绝对坐标'], ['var', '变量'], ['current', '当前鼠标']]} onChange={(v) => update('source', v)} />
          {step.source === 'var' ? (
            <>
              {renderVarNameField(step.variable_scope === 'shared' ? 'shared' : 'local', '变量名', 'target', 'scope')}
              <InspectorSelect label="变量范围" value={String(step.variable_scope ?? 'local')} options={[['local', '局部'], ['shared', '共享']]} onChange={(v) => update('variable_scope', v)} />
            </>
          ) : step.source === 'absolute' ? (
            <>
              <InspectorNumber label="X" value={Number(step.x ?? 0)} onChange={(v) => update('x', v)} />
              <InspectorNumber label="Y" value={Number(step.y ?? 0)} onChange={(v) => update('y', v)} />
            </>
          ) : null}
          <InspectorNumber label="偏移X" value={Number(step.offset_x ?? 0)} onChange={(v) => update('offset_x', v)} />
          <InspectorNumber label="偏移Y" value={Number(step.offset_y ?? 0)} onChange={(v) => update('offset_y', v)} />
          <InspectorInput label="目标颜色" value={String(step.expected_color ?? '')} onChange={(v) => update('expected_color', v)} />
          <InspectorNumber label="容差" value={Number(step.tolerance ?? 20)} onChange={(v) => update('tolerance', v)} />
          <InspectorInput label="保存为" value={String(step.save_as ?? 'color_result')} onChange={(v) => update('save_as', v)} />
        </>
      );
    case 'async_detect':
      return (
        <>
          <TemplateFilePicker value={String(step.template_path ?? '')} onChange={(v) => update('template_path', v)} />
          <InspectorInput label="保存为" value={String(step.save_as ?? 'async_target')} onChange={(v) => update('save_as', v)} />
          <InspectorSelect label="识别速度" value={String(step.scan_rate ?? 'normal')} options={[['low', '低速'], ['normal', '正常'], ['high', '高速'], ['ultra', '极速'], ['custom', '自定义']]} onChange={(v) => update('scan_rate', v)} />
          {step.scan_rate === 'custom' && (
            <InspectorNumber label="间隔(ms)" value={Number(step.custom_interval_ms ?? 350)} onChange={(v) => update('custom_interval_ms', v)} />
          )}
          <InspectorSelect label="匹配精度" value={String(step.match_mode ?? 'normal')} options={[['loose', '宽松'], ['normal', '正常'], ['strict', '严格'], ['custom', '自定义']]} onChange={(v) => update('match_mode', v)} />
          {step.match_mode === 'custom' && (
            <InspectorNumber label="置信度" value={Number(step.confidence ?? 0.88)} onChange={(v) => update('confidence', v)} step={0.01} />
          )}
          <InspectorNumber label="超时(ms)" value={Number(step.timeout_ms ?? 5000)} onChange={(v) => update('timeout_ms', v)} />
          <InspectorSelect label="搜索范围" value={String(step.search_scope ?? 'full_screen')} options={[['full_screen', '全屏'], ['fixed_region', '固定区域']]} onChange={(v) => update('search_scope', v)} />
          <InspectorSelect label="未找到时" value={String(step.not_found_action ?? 'mark_missing')} options={[['mark_missing', '标记未找到'], ['keep_last', '保留上次']]} onChange={(v) => update('not_found_action', v)} />
        </>
      );
    case 'check_pixels':
      return (
        <>
          <InspectorArrayEditor
            label="检测点"
            items={Array.isArray(step.points) ? step.points as Record<string, unknown>[] : []}
            fields={[
              { key: 'x', label: 'X', type: 'number' },
              { key: 'y', label: 'Y', type: 'number' },
              { key: 'expected_color', label: '颜色', type: 'text' },
              { key: 'tolerance', label: '容差', type: 'number' },
            ]}
            defaultItem={{ x: 0, y: 0, expected_color: '', tolerance: 20 }}
            onChange={(v) => update('points', v)}
          />
          <InspectorSelect label="逻辑" value={String(step.logic ?? 'all')} options={[['all', '全部匹配'], ['any', '任一匹配']]} onChange={(v) => update('logic', v)} />
          <InspectorInput label="保存为" value={String(step.save_as ?? 'pixel_result')} onChange={(v) => update('save_as', v)} />
        </>
      );
    case 'check_region_color':
      return (
        <>
          <InspectorNumber label="左(left)" value={Number(step.left ?? 0)} onChange={(v) => update('left', v)} />
          <InspectorNumber label="上(top)" value={Number(step.top ?? 0)} onChange={(v) => update('top', v)} />
          <InspectorNumber label="宽(width)" value={Number(step.width ?? 100)} onChange={(v) => update('width', v)} />
          <InspectorNumber label="高(height)" value={Number(step.height ?? 100)} onChange={(v) => update('height', v)} />
          <InspectorInput label="目标颜色" value={String(step.expected_color ?? '')} onChange={(v) => update('expected_color', v)} />
          <InspectorNumber label="容差" value={Number(step.tolerance ?? 20)} onChange={(v) => update('tolerance', v)} />
          <InspectorNumber label="最小占比" value={Number(step.min_ratio ?? 0.5)} onChange={(v) => update('min_ratio', v)} step={0.01} />
          <InspectorInput label="保存为" value={String(step.save_as ?? 'region_color_result')} onChange={(v) => update('save_as', v)} />
        </>
      );
    case 'detect_color_region':
      return (
        <>
          <InspectorNumber label="H最小" value={Number(step.h_min ?? 0)} onChange={(v) => update('h_min', v)} />
          <InspectorNumber label="H最大" value={Number(step.h_max ?? 179)} onChange={(v) => update('h_max', v)} />
          <InspectorNumber label="S最小" value={Number(step.s_min ?? 50)} onChange={(v) => update('s_min', v)} />
          <InspectorNumber label="S最大" value={Number(step.s_max ?? 255)} onChange={(v) => update('s_max', v)} />
          <InspectorNumber label="V最小" value={Number(step.v_min ?? 50)} onChange={(v) => update('v_min', v)} />
          <InspectorNumber label="V最大" value={Number(step.v_max ?? 255)} onChange={(v) => update('v_max', v)} />
          <InspectorNumber label="区域左" value={Number(step.region_left ?? 0)} onChange={(v) => update('region_left', v)} />
          <InspectorNumber label="区域上" value={Number(step.region_top ?? 0)} onChange={(v) => update('region_top', v)} />
          <InspectorNumber label="区域宽" value={Number(step.region_width ?? 0)} onChange={(v) => update('region_width', v)} />
          <InspectorNumber label="区域高" value={Number(step.region_height ?? 0)} onChange={(v) => update('region_height', v)} />
          <InspectorNumber label="最小面积" value={Number(step.min_area ?? 100)} onChange={(v) => update('min_area', v)} />
          <InspectorInput label="保存为" value={String(step.save_as ?? 'color_region_result')} onChange={(v) => update('save_as', v)} />
        </>
      );
    case 'match_fingerprint':
      return (
        <>
          <InspectorNumber label="锚点X" value={Number(step.anchor_x ?? 0)} onChange={(v) => update('anchor_x', v)} />
          <InspectorNumber label="锚点Y" value={Number(step.anchor_y ?? 0)} onChange={(v) => update('anchor_y', v)} />
          <InspectorArrayEditor
            label="采样点"
            items={Array.isArray(step.sample_points) ? step.sample_points as Record<string, unknown>[] : []}
            fields={[
              { key: 'dx', label: 'dX', type: 'number' },
              { key: 'dy', label: 'dY', type: 'number' },
              { key: 'expected_color', label: '颜色', type: 'text' },
            ]}
            defaultItem={{ dx: 0, dy: 0, expected_color: '' }}
            onChange={(v) => update('sample_points', v)}
          />
          <InspectorNumber label="容差" value={Number(step.tolerance ?? 20)} onChange={(v) => update('tolerance', v)} />
          <InspectorInput label="保存为" value={String(step.save_as ?? 'fingerprint_result')} onChange={(v) => update('save_as', v)} />
        </>
      );
    default:
      return null;
  }
}
