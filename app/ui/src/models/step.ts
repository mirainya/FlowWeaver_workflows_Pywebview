/* ── Step kind types ── */

export type StepKind =
  | 'key_tap'
  | 'key_sequence'
  | 'key_hold'
  | 'click_point'
  | 'mouse_move'
  | 'mouse_drag'
  | 'mouse_scroll'
  | 'mouse_hold'
  | 'detect_image'
  | 'detect_color'
  | 'check_pixels'
  | 'check_region_color'
  | 'detect_color_region'
  | 'match_fingerprint'
  | 'async_detect'
  | 'if_var_found'
  | 'if_condition'
  | 'loop'
  | 'set_variable_state'
  | 'set_variable'
  | 'type_text'
  | 'call_workflow'
  | 'delay'
  | 'log';

export interface StepTypeItem {
  key: StepKind;
  label: string;
}

export interface StepTypeGroup {
  group: string;
  items: StepTypeItem[];
}

export const STEP_TYPE_GROUPS: StepTypeGroup[] = [
  { group: '键盘', items: [
    { key: 'key_tap', label: '按一下键' },
    { key: 'key_sequence', label: '连续按键' },
    { key: 'key_hold', label: '按住不放' },
  ]},
  { group: '鼠标', items: [
    { key: 'click_point', label: '点击' },
    { key: 'mouse_move', label: '移动鼠标' },
    { key: 'mouse_drag', label: '拖拽' },
    { key: 'mouse_scroll', label: '滚轮' },
    { key: 'mouse_hold', label: '长按鼠标' },
  ]},
  { group: '找图找色', items: [
    { key: 'detect_image', label: '截图找图' },
    { key: 'detect_color', label: '取像素颜色' },
    { key: 'check_pixels', label: '多点像素检测' },
    { key: 'check_region_color', label: '区域颜色占比' },
    { key: 'detect_color_region', label: 'HSV颜色区域' },
    { key: 'match_fingerprint', label: '特征指纹匹配' },
    { key: 'async_detect', label: '后台识图' },
  ]},
  { group: '判断与循环', items: [
    { key: 'if_var_found', label: '找图结果判断' },
    { key: 'if_condition', label: '条件判断' },
    { key: 'loop', label: '循环执行' },
  ]},
  { group: '数据操作', items: [
    { key: 'set_variable_state', label: '改找图状态' },
    { key: 'set_variable', label: '设置数据值' },
    { key: 'type_text', label: '打字输入' },
  ]},
  { group: '流程控制', items: [
    { key: 'call_workflow', label: '调用其他流程' },
    { key: 'delay', label: '等一会儿' },
    { key: 'log', label: '输出日志' },
  ]},
];

export const STEP_TYPES: StepTypeItem[] = STEP_TYPE_GROUPS.flatMap((g) => g.items);

export function stepTypeLabel(kind: string): string {
  return STEP_TYPES.find((item) => item.key === kind)?.label ?? kind;
}

/* ── Visual detect kinds (支持可选分支) ── */

export const VISUAL_DETECT_KINDS: Set<StepKind> = new Set([
  'detect_image',
  'detect_color',
  'check_pixels',
  'check_region_color',
  'detect_color_region',
  'match_fingerprint',
]);

export function stepHasBranch(step: Step): boolean {
  if (step.kind === 'if_var_found' || step.kind === 'if_condition') return true;
  if (VISUAL_DETECT_KINDS.has(step.kind)) return true;
  return false;
}

export function branchLabels(kind: StepKind): { then: string; else: string } {
  if (VISUAL_DETECT_KINDS.has(kind)) return { then: '找到', else: '未找到' };
  return { then: '是', else: '否' };
}

/* ── Step data ── */

export interface Step {
  kind: StepKind;
  [key: string]: unknown;
}

export function createDefaultStep(kind: StepKind = 'key_tap'): Step {
  switch (kind) {
    case 'delay':
      return { kind: 'delay', milliseconds: 100, random_min: 0, random_max: 0 };
    case 'key_sequence':
      return { kind: 'key_sequence', sequence: [{ keys: '', delay_ms: 100 }] };
    case 'detect_image':
      return { kind: 'detect_image', template_path: '', save_as: 'target', confidence: 0.88, timeout_ms: 2500, search_step: 4 };
    case 'click_point':
      return { kind: 'click_point', source: 'var', var_name: 'target', x: 0, y: 0, offset_x: 0, offset_y: 0, button: 'left', return_cursor: true, settle_ms: 60, click_count: 1, modifiers: [], modifier_delay_ms: 50 };
    case 'if_var_found':
      return { kind: 'if_var_found', var_name: 'target', variable_scope: 'local' };
    case 'set_variable_state':
      return { kind: 'set_variable_state', var_name: 'target', variable_scope: 'local', state: 'missing' };
    case 'key_hold':
      return { kind: 'key_hold', key: '', duration_ms: 0 };
    case 'mouse_scroll':
      return { kind: 'mouse_scroll', direction: 'down', clicks: 3 };
    case 'mouse_hold':
      return { kind: 'mouse_hold', source: 'absolute', button: 'left', duration_ms: 500, var_name: 'target', x: 0, y: 0, offset_x: 0, offset_y: 0 };
    case 'detect_color':
      return { kind: 'detect_color', source: 'absolute', x: 0, y: 0, var_name: 'target', offset_x: 0, offset_y: 0, expected_color: '', tolerance: 20, save_as: 'color_result' };
    case 'loop':
      return { kind: 'loop', loop_type: 'count', max_iterations: 10, var_name: 'target', variable_scope: 'local' };
    case 'call_workflow':
      return { kind: 'call_workflow', target_workflow_id: '' };
    case 'log':
      return { kind: 'log', message: '' };
    case 'type_text':
      return { kind: 'type_text', text: '' };
    case 'mouse_move':
      return { kind: 'mouse_move', source: 'absolute', x: 0, y: 0, var_name: 'target', offset_x: 0, offset_y: 0, settle_ms: 60 };
    case 'mouse_drag':
      return { kind: 'mouse_drag', source: 'absolute', start_x: 0, start_y: 0, end_x: 0, end_y: 0, var_name: 'target', start_offset_x: 0, start_offset_y: 0, end_offset_x: 0, end_offset_y: 0, button: 'left', duration_ms: 300, steps: 20 };
    case 'if_condition':
      return { kind: 'if_condition', var_name: 'target', variable_scope: 'local', field: 'found', operator: '==', value: 'true' };
    case 'set_variable':
      return { kind: 'set_variable', var_name: 'target', field: 'found', value: '' };
    case 'check_pixels':
      return { kind: 'check_pixels', points: [{ x: 0, y: 0, expected_color: '', tolerance: 20 }], logic: 'all', save_as: 'pixel_result' };
    case 'check_region_color':
      return { kind: 'check_region_color', left: 0, top: 0, width: 100, height: 100, expected_color: '', tolerance: 20, min_ratio: 0.5, save_as: 'region_color_result' };
    case 'detect_color_region':
      return { kind: 'detect_color_region', h_min: 0, h_max: 179, s_min: 50, s_max: 255, v_min: 50, v_max: 255, region_left: 0, region_top: 0, region_width: 0, region_height: 0, min_area: 100, save_as: 'color_region_result' };
    case 'match_fingerprint':
      return { kind: 'match_fingerprint', anchor_x: 0, anchor_y: 0, sample_points: [], tolerance: 20, save_as: 'fingerprint_result' };
    case 'async_detect':
      return { kind: 'async_detect', template_path: '', confidence: 0.88, timeout_ms: 5000, save_as: 'async_target', scan_rate: 'normal', custom_interval_ms: 350, match_mode: 'normal', search_scope: 'full_screen', search_region: null, not_found_action: 'mark_missing' };
    default:
      return { kind: 'key_tap', keys: '', delay_ms_after: 100 };
  }
}

export function normalizeStep(raw: Record<string, unknown>): Step {
  const kind = (typeof raw.kind === 'string' ? raw.kind : 'key_tap') as StepKind;
  const defaults = createDefaultStep(kind);
  return { ...defaults, ...raw, kind };
}

export function normalizeSteps(rawSteps: Record<string, unknown>[]): Step[] {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps.map((s) => normalizeStep(s));
}
