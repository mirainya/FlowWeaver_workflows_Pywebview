function stepTypeLabel(kind) {
  return STEP_TYPES.find((item) => item.key === kind)?.label ?? kind;
}

function createDefaultStep(kind = 'key_tap') {
  if (kind === 'delay') {
    return { kind: 'delay', milliseconds: 100, random_min: 0, random_max: 0 };
  }
  if (kind === 'key_sequence') {
    return {
      kind: 'key_sequence',
      sequence: [
        { keys: '', delay_ms: 100 },
      ],
    };
  }
  if (kind === 'detect_image') {
    return {
      kind: 'detect_image',
      template_path: '',
      save_as: 'target',
      confidence: 0.88,
      timeout_ms: 2500,
      search_step: 4,
    };
  }
  if (kind === 'click_point') {
    return {
      kind: 'click_point',
      source: 'var',
      var_name: 'target',
      x: 0,
      y: 0,
      offset_x: 0,
      offset_y: 0,
      button: 'left',
      return_cursor: true,
      settle_ms: 60,
      modifiers: [],
      modifier_delay_ms: 50,
    };
  }
  if (kind === 'if_var_found') {
    return {
      kind: 'if_var_found',
      var_name: 'target',
      variable_scope: 'local',
      then_steps: [createDefaultStep('key_tap')],
      else_steps: [],
    };
  }
  if (kind === 'set_variable_state') {
    return {
      kind: 'set_variable_state',
      var_name: 'target',
      variable_scope: 'local',
      state: 'missing',
    };
  }
  if (kind === 'key_hold') {
    return {
      kind: 'key_hold',
      key: '',
      duration_ms: 0,
      steps: [createDefaultStep('delay')],
    };
  }
  if (kind === 'mouse_scroll') {
    return { kind: 'mouse_scroll', direction: 'down', clicks: 3 };
  }
  if (kind === 'mouse_hold') {
    return { kind: 'mouse_hold', button: 'left', duration_ms: 500, source: 'current', var_name: 'target', x: 0, y: 0, offset_x: 0, offset_y: 0, settle_ms: 60 };
  }
  if (kind === 'detect_color') {
    return { kind: 'detect_color', source: 'absolute', x: 0, y: 0, var_name: 'target', offset_x: 0, offset_y: 0, expected_color: '', tolerance: 20, save_as: 'color_result' };
  }
  if (kind === 'loop') {
    return { kind: 'loop', loop_type: 'count', max_iterations: 10, var_name: 'target', variable_scope: 'local', steps: [createDefaultStep('delay')] };
  }
  if (kind === 'call_workflow') {
    return { kind: 'call_workflow', target_workflow_id: '' };
  }
  if (kind === 'if_condition') {
    return { kind: 'if_condition', var_name: 'target', variable_scope: 'local', field: 'found', operator: '==', value: 'true', then_steps: [createDefaultStep('key_tap')], else_steps: [] };
  }
  if (kind === 'log') {
    return { kind: 'log', message: '', level: 'info' };
  }
  if (kind === 'mouse_drag') {
    return { kind: 'mouse_drag', source: 'absolute', start_x: 0, start_y: 0, end_x: 0, end_y: 0, button: 'left', duration_ms: 300, var_name: 'target', start_offset_x: 0, start_offset_y: 0, end_offset_x: 0, end_offset_y: 0 };
  }
  if (kind === 'type_text') {
    return { kind: 'type_text', text: '', interval_ms: 50 };
  }
  if (kind === 'mouse_move') {
    return { kind: 'mouse_move', source: 'absolute', x: 0, y: 0, var_name: 'target', offset_x: 0, offset_y: 0 };
  }
  if (kind === 'set_variable') {
    return { kind: 'set_variable', var_name: 'target', field: 'found', value: 'true' };
  }
  return {
    kind: 'key_tap',
    keys: '',
    delay_ms_after: 100,
  };
}

function normalizeRunMode(rawRunMode) {
  const runMode = rawRunMode && typeof rawRunMode === 'object' ? rawRunMode : {};
  const type = ['once', 'repeat_n', 'toggle_loop'].includes(runMode.type) ? runMode.type : 'once';
  const normalized = { type };
  if (type === 'repeat_n') {
    normalized.count = Math.max(1, normalizeInt(runMode.count, 1));
  }
  return normalized;
}

function normalizeSequenceItems(rawSequence) {
  const sequence = Array.isArray(rawSequence) ? rawSequence : [];
  const items = sequence.map((item) => ({
    keys: String(item?.keys ?? '').trim(),
    delay_ms: Math.max(0, normalizeInt(item?.delay_ms, 100)),
  }));
  return items.length ? items : [{ keys: '', delay_ms: 100 }];
}

function normalizeStep(rawStep) {
  const step = rawStep && typeof rawStep === 'object' ? rawStep : {};
  const kind = String(step.kind ?? step.type ?? 'key_tap');

  if (kind === 'delay') {
    return {
      kind: 'delay',
      milliseconds: Math.max(0, normalizeInt(step.milliseconds ?? step.delay_ms, 100)),
      random_min: Math.max(0, normalizeInt(step.random_min, 0)),
      random_max: Math.max(0, normalizeInt(step.random_max, 0)),
    };
  }

  if (kind === 'key_sequence') {
    return {
      kind: 'key_sequence',
      sequence: normalizeSequenceItems(step.sequence),
    };
  }

  if (kind === 'detect_image') {
    return {
      kind: 'detect_image',
      template_path: String(step.template_path ?? '').trim(),
      save_as: String(step.save_as ?? 'target').trim() || 'target',
      confidence: normalizeFloat(step.confidence, 0.88),
      timeout_ms: Math.max(100, normalizeInt(step.timeout_ms, 2500)),
      search_step: Math.max(1, normalizeInt(step.search_step, 4)),
    };
  }

  if (kind === 'click_point') {
    const source = step.source === 'absolute'
      ? 'absolute'
      : step.source === 'shared'
        ? 'shared'
        : step.source === 'current'
          ? 'current'
          : 'var';
    const allowedModifiers = ['ctrl', 'shift', 'alt'];
    const rawModifiers = Array.isArray(step.modifiers) ? step.modifiers : [];
    const modifiers = [...new Set(rawModifiers.filter((m) => allowedModifiers.includes(m)))];
    return {
      kind: 'click_point',
      source,
      var_name: String(step.var_name ?? 'target').trim() || 'target',
      x: normalizeInt(step.x, 0),
      y: normalizeInt(step.y, 0),
      offset_x: normalizeInt(step.offset_x, 0),
      offset_y: normalizeInt(step.offset_y, 0),
      button: step.button === 'right' ? 'right' : 'left',
      return_cursor: Boolean(step.return_cursor ?? true),
      settle_ms: Math.max(0, normalizeInt(step.settle_ms, 60)),
      modifier_delay_ms: Math.max(0, normalizeInt(step.modifier_delay_ms, 50)),
      click_count: Math.max(1, Math.min(5, normalizeInt(step.click_count, 1))),
      modifiers,
    };
  }

  if (kind === 'if_var_found') {
    return {
      kind: 'if_var_found',
      var_name: String(step.var_name ?? 'target').trim() || 'target',
      variable_scope: step.variable_scope === 'shared' ? 'shared' : 'local',
      then_steps: normalizeSteps(step.then_steps, false),
      else_steps: normalizeSteps(step.else_steps, true),
    };
  }

  if (kind === 'set_variable_state') {
    return {
      kind: 'set_variable_state',
      var_name: String(step.var_name ?? 'target').trim() || 'target',
      variable_scope: step.variable_scope === 'shared' ? 'shared' : 'local',
      state: step.state === 'found' ? 'found' : 'missing',
    };
  }

  if (kind === 'key_hold') {
    return {
      kind: 'key_hold',
      key: String(step.key ?? '').trim(),
      duration_ms: Math.max(0, normalizeInt(step.duration_ms, 0)),
      steps: normalizeSteps(step.steps, false),
    };
  }

  if (kind === 'mouse_scroll') {
    const direction = ['up', 'down', 'left', 'right'].includes(step.direction) ? step.direction : 'down';
    return {
      kind: 'mouse_scroll',
      direction,
      clicks: Math.max(1, Math.min(100, normalizeInt(step.clicks, 3))),
    };
  }

  if (kind === 'mouse_hold') {
    const button = ['left', 'right', 'middle'].includes(step.button) ? step.button : 'left';
    const source = ['current', 'var', 'shared', 'absolute'].includes(step.source) ? step.source : 'current';
    return {
      kind: 'mouse_hold',
      button,
      duration_ms: Math.max(0, normalizeInt(step.duration_ms, 500)),
      source,
      var_name: String(step.var_name ?? 'target').trim() || 'target',
      x: normalizeInt(step.x, 0),
      y: normalizeInt(step.y, 0),
      offset_x: normalizeInt(step.offset_x, 0),
      offset_y: normalizeInt(step.offset_y, 0),
      settle_ms: Math.max(0, normalizeInt(step.settle_ms, 60)),
    };
  }

  if (kind === 'detect_color') {
    const source = ['absolute', 'var', 'shared'].includes(step.source) ? step.source : 'absolute';
    return {
      kind: 'detect_color',
      source,
      x: normalizeInt(step.x, 0),
      y: normalizeInt(step.y, 0),
      var_name: String(step.var_name ?? 'target').trim() || 'target',
      offset_x: normalizeInt(step.offset_x, 0),
      offset_y: normalizeInt(step.offset_y, 0),
      expected_color: String(step.expected_color ?? '').trim(),
      tolerance: Math.max(0, Math.min(255, normalizeInt(step.tolerance, 20))),
      save_as: String(step.save_as ?? 'color_result').trim() || 'color_result',
    };
  }

  if (kind === 'loop') {
    const loop_type = ['count', 'while_found', 'while_not_found'].includes(step.loop_type) ? step.loop_type : 'count';
    const variable_scope = ['local', 'shared'].includes(step.variable_scope) ? step.variable_scope : 'local';
    return {
      kind: 'loop',
      loop_type,
      max_iterations: Math.max(1, Math.min(99999, normalizeInt(step.max_iterations, 10))),
      var_name: String(step.var_name ?? 'target').trim() || 'target',
      variable_scope,
      steps: normalizeSteps(step.steps, false),
    };
  }

  if (kind === 'call_workflow') {
    return {
      kind: 'call_workflow',
      target_workflow_id: String(step.target_workflow_id ?? '').trim(),
    };
  }

  if (kind === 'if_condition') {
    const variable_scope = ['local', 'shared'].includes(step.variable_scope) ? step.variable_scope : 'local';
    const operator = ['>', '>=', '<', '<=', '==', '!='].includes(step.operator) ? step.operator : '==';
    return {
      kind: 'if_condition',
      var_name: String(step.var_name ?? 'target').trim() || 'target',
      variable_scope,
      field: String(step.field ?? 'found').trim() || 'found',
      operator,
      value: String(step.value ?? 'true').trim(),
      then_steps: normalizeSteps(step.then_steps, false),
      else_steps: normalizeSteps(step.else_steps, true),
    };
  }

  if (kind === 'log') {
    const level = ['info', 'warn', 'success'].includes(step.level) ? step.level : 'info';
    return {
      kind: 'log',
      message: String(step.message ?? '').trim(),
      level,
    };
  }

  if (kind === 'mouse_drag') {
    const source = ['absolute', 'var', 'shared'].includes(step.source) ? step.source : 'absolute';
    const button = ['left', 'right', 'middle'].includes(step.button) ? step.button : 'left';
    const base = { kind: 'mouse_drag', source, button, duration_ms: clampInt(step.duration_ms, 300, 0, 60000) };
    if (source === 'absolute') {
      return { ...base, start_x: clampInt(step.start_x, 0), start_y: clampInt(step.start_y, 0), end_x: clampInt(step.end_x, 0), end_y: clampInt(step.end_y, 0) };
    }
    return { ...base, var_name: String(step.var_name ?? 'target').trim() || 'target', start_offset_x: clampInt(step.start_offset_x, 0), start_offset_y: clampInt(step.start_offset_y, 0), end_offset_x: clampInt(step.end_offset_x, 0), end_offset_y: clampInt(step.end_offset_y, 0) };
  }

  if (kind === 'type_text') {
    return {
      kind: 'type_text',
      text: String(step.text ?? ''),
      interval_ms: clampInt(step.interval_ms, 50, 0, 5000),
    };
  }

  if (kind === 'mouse_move') {
    const source = ['absolute', 'var', 'shared'].includes(step.source) ? step.source : 'absolute';
    const base = { kind: 'mouse_move', source };
    if (source === 'absolute') {
      return { ...base, x: clampInt(step.x, 0), y: clampInt(step.y, 0) };
    }
    return { ...base, var_name: String(step.var_name ?? 'target').trim() || 'target', offset_x: clampInt(step.offset_x, 0), offset_y: clampInt(step.offset_y, 0) };
  }

  if (kind === 'set_variable') {
    return {
      kind: 'set_variable',
      var_name: String(step.var_name ?? 'target').trim() || 'target',
      field: String(step.field ?? 'found').trim() || 'found',
      value: String(step.value ?? ''),
    };
  }

  return {
    kind: 'key_tap',
    keys: String(step.keys ?? '').trim(),
    delay_ms_after: Math.max(0, normalizeInt(step.delay_ms_after, 100)),
  };
}

function normalizeSteps(rawSteps, allowEmpty = true) {
  const items = Array.isArray(rawSteps) ? rawSteps : [];
  const steps = items.map(normalizeStep);
  if (steps.length) {
    return steps;
  }
  return allowEmpty ? [] : [createDefaultStep('key_tap')];
}

function createEmptyDesigner() {
  const defaults = state.designerDefaults ?? DEFAULT_DESIGNER_TEMPLATE;
  return {
    workflow_id: '',
    name: '',
    hotkey: '',
    description: '',
    enabled: true,
    run_mode: normalizeRunMode(defaults.run_mode),
    steps: normalizeSteps(defaults.steps, false),
  };
}

state.designer = createEmptyDesigner();

function normalizeAsyncMonitor(rawMonitor) {
  const monitor = rawMonitor && typeof rawMonitor === 'object' ? rawMonitor : {};
  const presetKey = Object.prototype.hasOwnProperty.call(ASYNC_MONITOR_PRESETS, monitor.preset) ? monitor.preset : 'fixed_button';
  const preset = ASYNC_MONITOR_PRESETS[presetKey];
  return {
    monitor_id: String(monitor.monitor_id ?? '').trim(),
    name: String(monitor.name ?? '').trim(),
    output_variable: String(monitor.output_variable ?? monitor.variable_name ?? 'target').trim() || 'target',
    template_path: String(monitor.template_path ?? '').trim(),
    enabled: Boolean(monitor.enabled ?? true),
    preset: presetKey,
    search_scope: ['full_screen', 'fixed_region', 'follow_last'].includes(monitor.search_scope)
      ? monitor.search_scope
      : preset.search_scope,
    fixed_region: {
      left: Math.max(0, normalizeInt(monitor.fixed_region?.left, 0)),
      top: Math.max(0, normalizeInt(monitor.fixed_region?.top, 0)),
      width: Math.max(0, normalizeInt(monitor.fixed_region?.width, 0)),
      height: Math.max(0, normalizeInt(monitor.fixed_region?.height, 0)),
    },
    scan_rate: ['low', 'normal', 'high', 'ultra'].includes(monitor.scan_rate)
      ? monitor.scan_rate
      : preset.scan_rate,
    not_found_action: ['keep_last', 'mark_missing'].includes(monitor.not_found_action)
      ? monitor.not_found_action
      : preset.not_found_action,
    match_mode: ['loose', 'normal', 'strict', 'custom'].includes(monitor.match_mode)
      ? monitor.match_mode
      : preset.match_mode,
    custom_confidence: Math.max(0.55, Math.min(0.99, normalizeFloat(monitor.custom_confidence, preset.custom_confidence))),
    follow_radius: Math.max(60, normalizeInt(monitor.follow_radius, preset.follow_radius)),
    recover_after_misses: Math.max(1, normalizeInt(monitor.recover_after_misses, preset.recover_after_misses)),
    stale_after_ms: Math.max(100, normalizeInt(monitor.stale_after_ms, preset.stale_after_ms)),
    effective_confidence: Math.max(0.55, Math.min(0.99, normalizeFloat(monitor.effective_confidence, monitor.custom_confidence ?? preset.custom_confidence))),
    effective_interval_ms: Math.max(30, normalizeInt(monitor.effective_interval_ms, 350)),
    runtime: monitor.runtime ?? {},
  };
}

function applyAsyncMonitorPreset(presetKey, baseMonitor = {}) {
  const preset = ASYNC_MONITOR_PRESETS[presetKey] ?? ASYNC_MONITOR_PRESETS.fixed_button;
  return normalizeAsyncMonitor({
    ...baseMonitor,
    preset: presetKey,
    search_scope: preset.search_scope,
    scan_rate: preset.scan_rate,
    not_found_action: preset.not_found_action,
    match_mode: preset.match_mode,
    custom_confidence: preset.custom_confidence,
    follow_radius: preset.follow_radius,
    recover_after_misses: preset.recover_after_misses,
    stale_after_ms: preset.stale_after_ms,
  });
}

function createEmptyAsyncMonitor() {
  return applyAsyncMonitorPreset('fixed_button', {
    monitor_id: '',
    name: '',
    output_variable: 'target',
    template_path: '',
    enabled: true,
    fixed_region: { left: 0, top: 0, width: 0, height: 0 },
  });
}

function getAsyncMonitorById(monitorId) {
  return state.asyncVision.monitors.find((monitor) => monitor.monitor_id === monitorId);
}

function loadAsyncMonitorIntoEditor(monitorId) {
  const monitor = getAsyncMonitorById(monitorId);
  if (!monitor) {
    return;
  }
  state.asyncVision.editor = normalizeAsyncMonitor(monitor);
  state.activeTab = 'async_vision';
  renderHero();
  renderTabs();
  renderDesigner();
  renderWorkflows();
}

function resetAsyncMonitorEditor(keepTab = true) {
  state.asyncVision.editor = createEmptyAsyncMonitor();
  if (!keepTab) {
    state.activeTab = 'async_vision';
  }
  renderHero();
  renderTabs();
  renderDesigner();
  renderWorkflows();
}

function updateAsyncMonitorField(field, value, valueType = 'text') {
  syncAsyncMonitorEditorFromDom();
  if (field === 'preset') {
    state.asyncVision.editor = applyAsyncMonitorPreset(String(value ?? 'fixed_button'), state.asyncVision.editor);
    renderWorkflows();
    return;
  }
  state.asyncVision.editor[field] = coerceValue(value, valueType);
  if (['search_scope', 'match_mode'].includes(field)) {
    renderWorkflows();
  }
}

function updateAsyncMonitorCheckbox(field, checked) {
  syncAsyncMonitorEditorFromDom();
  state.asyncVision.editor[field] = Boolean(checked);
}

function updateAsyncMonitorRegionField(field, value) {
  syncAsyncMonitorEditorFromDom();
  state.asyncVision.editor.fixed_region = state.asyncVision.editor.fixed_region ?? { left: 0, top: 0, width: 0, height: 0 };
  state.asyncVision.editor.fixed_region[field] = Math.max(0, normalizeInt(value, 0));
}

function readAsyncEditorValue(elementId, fallback = '') {
  const element = document.getElementById(elementId);
  if (!element) {
    return fallback;
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value;
  }
  return fallback;
}

function readAsyncEditorChecked(elementId, fallback = false) {
  const element = document.getElementById(elementId);
  if (!(element instanceof HTMLInputElement)) {
    return fallback;
  }
  return element.checked;
}

function syncAsyncMonitorEditorFromDom() {
  const currentEditor = state.asyncVision.editor ?? createEmptyAsyncMonitor();
  state.asyncVision.editor = {
    ...currentEditor,
    name: String(readAsyncEditorValue('async-monitor-name', currentEditor.name ?? '')).trim(),
    output_variable: String(readAsyncEditorValue('async-monitor-output-variable', currentEditor.output_variable ?? '')).trim(),
    template_path: String(readAsyncEditorValue('async-monitor-template-path', currentEditor.template_path ?? '')).trim(),
    enabled: readAsyncEditorChecked('async-monitor-enabled', Boolean(currentEditor.enabled ?? true)),
  };
}

async function flushAsyncMonitorEditorDom() {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && String(activeElement.id ?? '').startsWith('async-monitor-')) {
    activeElement.blur();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  syncAsyncMonitorEditorFromDom();
}

function collectAsyncMonitorPayload() {
  const currentEditor = state.asyncVision.editor ?? createEmptyAsyncMonitor();
  const editor = normalizeAsyncMonitor(currentEditor);
  return {
    monitor_id: String(currentEditor.monitor_id ?? '').trim(),
    name: String(currentEditor.name ?? '').trim(),
    output_variable: String(currentEditor.output_variable ?? '').trim(),
    template_path: String(currentEditor.template_path ?? '').trim(),
    enabled: Boolean(currentEditor.enabled ?? true),
    preset: editor.preset,
    search_scope: editor.search_scope,
    fixed_region: deepClone(editor.fixed_region),
    scan_rate: editor.scan_rate,
    not_found_action: editor.not_found_action,
    match_mode: editor.match_mode,
    custom_confidence: editor.custom_confidence,
    follow_radius: editor.follow_radius,
    recover_after_misses: editor.recover_after_misses,
    stale_after_ms: editor.stale_after_ms,
  };
}

state.asyncVision.editor = createEmptyAsyncMonitor();
