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
  if (kind === 'check_pixels') {
    return { kind: 'check_pixels', points: [{ x: 0, y: 0, expected_color: '', tolerance: 20 }], logic: 'all', save_as: 'pixel_result' };
  }
  if (kind === 'check_region_color') {
    return { kind: 'check_region_color', left: 0, top: 0, width: 100, height: 100, expected_color: '', tolerance: 20, min_ratio: 0.5, save_as: 'region_color_result' };
  }
  if (kind === 'detect_color_region') {
    return { kind: 'detect_color_region', h_min: 0, h_max: 179, s_min: 50, s_max: 255, v_min: 50, v_max: 255, region_left: 0, region_top: 0, region_width: 0, region_height: 0, min_area: 100, save_as: 'color_region_result' };
  }
  if (kind === 'match_fingerprint') {
    return { kind: 'match_fingerprint', anchor_x: 0, anchor_y: 0, sample_points: [], tolerance: 20, save_as: 'fingerprint_result' };
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

  if (kind === 'check_pixels') {
    const rawPoints = Array.isArray(step.points) ? step.points : [];
    const points = rawPoints.map((pt) => ({
      x: clampInt(pt?.x, 0),
      y: clampInt(pt?.y, 0),
      expected_color: String(pt?.expected_color ?? '').trim(),
      tolerance: Math.max(0, Math.min(255, normalizeInt(pt?.tolerance, 20))),
    }));
    return {
      kind: 'check_pixels',
      points: points.length ? points : [{ x: 0, y: 0, expected_color: '', tolerance: 20 }],
      logic: ['all', 'any'].includes(step.logic) ? step.logic : 'all',
      save_as: String(step.save_as ?? 'pixel_result').trim() || 'pixel_result',
    };
  }

  if (kind === 'check_region_color') {
    return {
      kind: 'check_region_color',
      left: clampInt(step.left, 0),
      top: clampInt(step.top, 0),
      width: Math.max(1, normalizeInt(step.width, 100)),
      height: Math.max(1, normalizeInt(step.height, 100)),
      expected_color: String(step.expected_color ?? '').trim(),
      tolerance: Math.max(0, Math.min(255, normalizeInt(step.tolerance, 20))),
      min_ratio: Math.max(0.01, Math.min(1.0, normalizeFloat(step.min_ratio, 0.5))),
      save_as: String(step.save_as ?? 'region_color_result').trim() || 'region_color_result',
    };
  }

  if (kind === 'detect_color_region') {
    return {
      kind: 'detect_color_region',
      h_min: Math.max(0, Math.min(179, normalizeInt(step.h_min, 0))),
      h_max: Math.max(0, Math.min(179, normalizeInt(step.h_max, 179))),
      s_min: Math.max(0, Math.min(255, normalizeInt(step.s_min, 50))),
      s_max: Math.max(0, Math.min(255, normalizeInt(step.s_max, 255))),
      v_min: Math.max(0, Math.min(255, normalizeInt(step.v_min, 50))),
      v_max: Math.max(0, Math.min(255, normalizeInt(step.v_max, 255))),
      region_left: clampInt(step.region_left, 0),
      region_top: clampInt(step.region_top, 0),
      region_width: Math.max(0, normalizeInt(step.region_width, 0)),
      region_height: Math.max(0, normalizeInt(step.region_height, 0)),
      min_area: Math.max(1, normalizeInt(step.min_area, 100)),
      save_as: String(step.save_as ?? 'color_region_result').trim() || 'color_region_result',
    };
  }

  if (kind === 'match_fingerprint') {
    const rawSP = Array.isArray(step.sample_points) ? step.sample_points : [];
    const samplePoints = rawSP.map((sp) => ({
      dx: clampInt(sp?.dx, 0),
      dy: clampInt(sp?.dy, 0),
      expected_color: String(sp?.expected_color ?? '').trim(),
    }));
    return {
      kind: 'match_fingerprint',
      anchor_x: clampInt(step.anchor_x, 0),
      anchor_y: clampInt(step.anchor_y, 0),
      sample_points: samplePoints,
      tolerance: Math.max(0, Math.min(255, normalizeInt(step.tolerance, 20))),
      save_as: String(step.save_as ?? 'fingerprint_result').trim() || 'fingerprint_result',
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
  const matchType = ['template', 'check_pixels', 'check_region_color', 'detect_color_region', 'match_fingerprint'].includes(monitor.match_type)
    ? monitor.match_type
    : 'template';
  return {
    monitor_id: String(monitor.monitor_id ?? '').trim(),
    name: String(monitor.name ?? '').trim(),
    output_variable: String(monitor.output_variable ?? monitor.variable_name ?? 'target').trim() || 'target',
    template_path: String(monitor.template_path ?? '').trim(),
    enabled: Boolean(monitor.enabled ?? true),
    preset: presetKey,
    match_type: matchType,
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
    pixel_points: Array.isArray(monitor.pixel_points) ? monitor.pixel_points : [],
    pixel_logic: ['all', 'any'].includes(monitor.pixel_logic) ? monitor.pixel_logic : 'all',
    region_color_config: {
      left: Math.max(0, normalizeInt(monitor.region_color_config?.left, 0)),
      top: Math.max(0, normalizeInt(monitor.region_color_config?.top, 0)),
      width: Math.max(1, normalizeInt(monitor.region_color_config?.width, 100)),
      height: Math.max(1, normalizeInt(monitor.region_color_config?.height, 100)),
      expected_color: String(monitor.region_color_config?.expected_color ?? '#FF0000').trim(),
      tolerance: Math.max(0, normalizeInt(monitor.region_color_config?.tolerance, 20)),
      min_ratio: Math.max(0.01, Math.min(1.0, normalizeFloat(monitor.region_color_config?.min_ratio, 0.5))),
    },
    hsv_config: {
      h_min: Math.max(0, Math.min(179, normalizeInt(monitor.hsv_config?.h_min, 0))),
      h_max: Math.max(0, Math.min(179, normalizeInt(monitor.hsv_config?.h_max, 179))),
      s_min: Math.max(0, Math.min(255, normalizeInt(monitor.hsv_config?.s_min, 50))),
      s_max: Math.max(0, Math.min(255, normalizeInt(monitor.hsv_config?.s_max, 255))),
      v_min: Math.max(0, Math.min(255, normalizeInt(monitor.hsv_config?.v_min, 50))),
      v_max: Math.max(0, Math.min(255, normalizeInt(monitor.hsv_config?.v_max, 255))),
      min_area: Math.max(1, normalizeInt(monitor.hsv_config?.min_area, 100)),
    },
    fingerprint_config: {
      anchor_x: Math.max(0, normalizeInt(monitor.fingerprint_config?.anchor_x, 0)),
      anchor_y: Math.max(0, normalizeInt(monitor.fingerprint_config?.anchor_y, 0)),
      tolerance: Math.max(0, normalizeInt(monitor.fingerprint_config?.tolerance, 20)),
      sample_points: Array.isArray(monitor.fingerprint_config?.sample_points) ? monitor.fingerprint_config.sample_points : [],
    },
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
  if (['search_scope', 'match_mode', 'match_type'].includes(field)) {
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

function updateAsyncMonitorNestedField(parentField, childField, value, valueType = 'text') {
  syncAsyncMonitorEditorFromDom();
  if (!state.asyncVision.editor[parentField] || typeof state.asyncVision.editor[parentField] !== 'object') {
    state.asyncVision.editor[parentField] = {};
  }
  state.asyncVision.editor[parentField][childField] = coerceValue(value, valueType);
}

function updateAsyncMonitorJsonField(field, jsonStr) {
  syncAsyncMonitorEditorFromDom();
  try {
    state.asyncVision.editor[field] = JSON.parse(jsonStr);
  } catch (_) {
    // 用户还在编辑中，暂不更新
  }
}

function addAsyncPixelPoint() {
  syncAsyncMonitorEditorFromDom();
  if (!Array.isArray(state.asyncVision.editor.pixel_points)) {
    state.asyncVision.editor.pixel_points = [];
  }
  state.asyncVision.editor.pixel_points.push({ x: 0, y: 0, expected_color: '#000000', tolerance: 20 });
  renderWorkflows();
}

function addAsyncFingerprintSamplePoint() {
  syncAsyncMonitorEditorFromDom();
  if (!state.asyncVision.editor.fingerprint_config || typeof state.asyncVision.editor.fingerprint_config !== 'object') {
    state.asyncVision.editor.fingerprint_config = { anchor_x: 0, anchor_y: 0, tolerance: 20, sample_points: [] };
  }
  if (!Array.isArray(state.asyncVision.editor.fingerprint_config.sample_points)) {
    state.asyncVision.editor.fingerprint_config.sample_points = [];
  }
  state.asyncVision.editor.fingerprint_config.sample_points.push({ dx: 0, dy: 0, expected_color: '#000000' });
  renderWorkflows();
}

function updateAsyncMonitorNestedJsonField(parentField, childField, jsonStr) {
  syncAsyncMonitorEditorFromDom();
  if (!state.asyncVision.editor[parentField] || typeof state.asyncVision.editor[parentField] !== 'object') {
    state.asyncVision.editor[parentField] = {};
  }
  try {
    state.asyncVision.editor[parentField][childField] = JSON.parse(jsonStr);
  } catch (_) {
    // 用户还在编辑中，暂不更新
  }
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
    match_type: editor.match_type,
    search_scope: editor.search_scope,
    fixed_region: deepClone(editor.fixed_region),
    scan_rate: editor.scan_rate,
    not_found_action: editor.not_found_action,
    match_mode: editor.match_mode,
    custom_confidence: editor.custom_confidence,
    follow_radius: editor.follow_radius,
    recover_after_misses: editor.recover_after_misses,
    stale_after_ms: editor.stale_after_ms,
    pixel_points: deepClone(editor.pixel_points),
    pixel_logic: editor.pixel_logic,
    region_color_config: deepClone(editor.region_color_config),
    hsv_config: deepClone(editor.hsv_config),
    fingerprint_config: deepClone(editor.fingerprint_config),
  };
}

state.asyncVision.editor = createEmptyAsyncMonitor();
