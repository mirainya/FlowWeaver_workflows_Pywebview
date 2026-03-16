function actionToStep(action) {
  const params = deepClone(action?.params ?? {});
  return normalizeStep({ kind: action?.kind ?? 'key_tap', ...params });
}

function getWorkflowSteps(workflow) {
  if (Array.isArray(workflow?.steps)) {
    return normalizeSteps(workflow.steps, true);
  }
  return normalizeSteps((workflow?.actions ?? []).map(actionToStep), true);
}

function getWorkflowById(workflowId) {
  return state.workflows.find((workflow) => workflow.workflow_id === workflowId);
}

function updateWorkflowBindingState(workflowId, patch = {}) {
  const workflow = getWorkflowById(workflowId);
  if (!workflow) {
    return null;
  }
  const currentBinding = workflow.binding && typeof workflow.binding === 'object'
    ? workflow.binding
    : { hotkey: '', enabled: true };
  workflow.binding = {
    ...currentBinding,
    ...patch,
  };
  return workflow;
}

function getWorkflowRuntime(workflowId) {
  return state.runtime.workflow_states?.[workflowId] ?? {
    status: 'idle',
    status_label: '待机',
    active: false,
    last_message: '尚未触发',
    last_key: '--',
    last_key_time: '--',
    key_event_count: 0,
    iteration_count: 0,
    last_trigger_time: '--',
    last_finish_time: '--',
  };
}

function stepListHasVision(steps) {
  for (const step of Array.isArray(steps) ? steps : []) {
    if (['detect_image', 'if_var_found'].includes(step.kind)) {
      return true;
    }
    if (stepListHasVision(step.then_steps) || stepListHasVision(step.else_steps)) {
      return true;
    }
  }
  return false;
}

function getVisibleWorkflows() {
  const keyword = state.flowQuery.trim().toLowerCase();
  return state.workflows.filter((workflow) => {
    if (state.flowFilter === 'editable' && !workflow.definition_editable) {
      return false;
    }
    if (state.flowFilter === 'loop' && !workflow.is_loop) {
      return false;
    }
    if (state.flowFilter === 'vision' && !stepListHasVision(getWorkflowSteps(workflow))) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const haystack = [
      workflow.name,
      workflow.description,
      workflow.category,
      workflow.binding?.hotkey,
    ].join(' ').toLowerCase();
    return haystack.includes(keyword);
  });
}

function ensureActiveTab() {
  if (!APP_TABS.some((tab) => tab.key === state.activeTab)) {
    state.activeTab = 'flows';
  }
}

function getActiveTabMeta() {
  return APP_TABS.find((tab) => tab.key === state.activeTab) ?? null;
}

function runModeLabel(runMode) {
  const normalized = normalizeRunMode(runMode);
  if (normalized.type === 'toggle_loop') {
    return '开关循环';
  }
  if (normalized.type === 'repeat_n') {
    return `次数循环 × ${normalized.count}`;
  }
  return '执行一次';
}

function parsePath(pathText) {
  return String(pathText)
    .split('.')
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function readPath(root, pathText) {
  return parsePath(pathText).reduce((current, segment) => current?.[segment], root);
}

function getParentAndKey(pathText) {
  const segments = parsePath(pathText);
  const key = segments.pop();
  const parent = segments.reduce((current, segment) => current?.[segment], state.designer);
  return { parent, key };
}

function setActiveTab(tabKey) {
  state.activeTab = tabKey;
  renderHero();
  renderTabs();
  renderDesigner();
  renderWorkflows();
}

function resetDesigner(keepTab = true) {
  state.designer = createEmptyDesigner();
  state.designerCollapsed = false;
  resetDesignerSaveState();
  if (!keepTab) {
    state.activeTab = 'flows';
  }
  renderHero();
  renderTabs();
  renderDesigner();
  renderWorkflows();
}

function workflowToDesigner(workflow) {
  return {
    workflow_id: workflow.workflow_id,
    name: workflow.name ?? '',
    hotkey: workflow.binding?.hotkey ?? '',
    description: workflow.description ?? '',
    enabled: Boolean(workflow.binding?.enabled ?? true),
    run_mode: normalizeRunMode(workflow.run_mode),
    steps: normalizeSteps(getWorkflowSteps(workflow), false),
  };
}

function loadWorkflowIntoDesigner(workflowId) {
  const workflow = getWorkflowById(workflowId);
  if (!workflow?.is_custom) {
    return;
  }
  state.designer = workflowToDesigner(workflow);
  state.collapsedSteps = new Set(
    state.designer.steps.map((_, i) => i)
  );
  resetDesignerSaveState();
  resetDesignerUndoHistory();
  state.activeTab = 'flows';
  renderHero();
  renderTabs();
  renderDesigner();
  renderWorkflows();
}

function updateDesignerField(field, value, valueType = 'text') {
  state.designer[field] = coerceValue(value, valueType);
  markDesignerDirty();
}

function updateDesignerEnabled(checked) {
  state.designer.enabled = Boolean(checked);
  markDesignerDirty();
}

function updateDesignerRunMode(value) {
  state.designer.run_mode = normalizeRunMode({
    type: value,
    count: state.designer.run_mode?.count ?? 1,
  });
  markDesignerDirty();
  renderDesigner();
}

function updateDesignerRunCount(value) {
  state.designer.run_mode = normalizeRunMode({
    type: 'repeat_n',
    count: value,
  });
  markDesignerDirty();
}

function addDesignerStep(listPath, kind = 'key_tap') {
  const list = readPath(state.designer, listPath);
  if (!Array.isArray(list)) {
    return;
  }
  list.push(createDefaultStep(kind));
  markDesignerDirty();
  renderDesignerSteps();
}

const STEP_TEMPLATES = {
  find_and_click: {
    label: '找图+点击',
    description: '先识图，再点击找到的位置',
    steps: [
      { kind: 'detect_image', template_path: '', save_as: 'target', confidence: 0.88, timeout_ms: 5000, search_step: 1 },
      { kind: 'click_point', source: 'var', variable_name: 'target', button: 'left', click_type: 'single' },
    ],
  },
  find_click_delay: {
    label: '找图+点击+等待',
    description: '识图→点击→延迟，适合菜单操作',
    steps: [
      { kind: 'detect_image', template_path: '', save_as: 'target', confidence: 0.88, timeout_ms: 5000, search_step: 1 },
      { kind: 'click_point', source: 'var', variable_name: 'target', button: 'left', click_type: 'single' },
      { kind: 'delay', milliseconds: 500 },
    ],
  },
  conditional_click: {
    label: '条件找图+点击',
    description: '找图后判断是否找到再点击',
    steps: [
      { kind: 'detect_image', template_path: '', save_as: 'target', confidence: 0.88, timeout_ms: 3000, search_step: 1 },
      { kind: 'if_var_found', variable_name: 'target', then_steps: [
        { kind: 'click_point', source: 'var', variable_name: 'target', button: 'left', click_type: 'single' },
      ], else_steps: [] },
    ],
  },
  key_combo: {
    label: '组合按键',
    description: '按键+延迟+按键',
    steps: [
      { kind: 'key_tap', key: '', modifiers: [] },
      { kind: 'delay', milliseconds: 200 },
      { kind: 'key_tap', key: '', modifiers: [] },
    ],
  },
};

function insertStepTemplate(listPath, templateKey) {
  const list = readPath(state.designer, listPath);
  if (!Array.isArray(list)) return;
  const tpl = STEP_TEMPLATES[templateKey];
  if (!tpl) return;
  const newSteps = tpl.steps.map(s => normalizeStep(deepClone(s)));
  list.push(...newSteps);
  markDesignerDirty();
  renderDesignerSteps();
}

function removeDesignerStep(stepPath) {
  const { parent, key } = getParentAndKey(stepPath);
  if (!Array.isArray(parent)) {
    return;
  }
  parent.splice(Number(key), 1);
  markDesignerDirty();
  renderDesignerSteps();
}

function moveDesignerStep(stepPath, direction) {
  const { parent, key } = getParentAndKey(stepPath);
  if (!Array.isArray(parent)) {
    return;
  }
  const index = Number(key);
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= parent.length) {
    return;
  }
  [parent[index], parent[targetIndex]] = [parent[targetIndex], parent[index]];
  markDesignerDirty();
  renderDesignerSteps();
}

function changeDesignerStepKind(stepPath, kind) {
  const { parent, key } = getParentAndKey(stepPath);
  if (!Array.isArray(parent)) {
    return;
  }
  parent[key] = createDefaultStep(kind);
  markDesignerDirty();
  renderDesignerSteps();
}

function toggleStepCollapse(stepPath) {
  if (state.collapsedSteps.has(stepPath)) {
    state.collapsedSteps.delete(stepPath);
  } else {
    state.collapsedSteps.add(stepPath);
  }
  renderDesignerSteps();
}

function duplicateDesignerStep(stepPath) {
  const { parent, key } = getParentAndKey(stepPath);
  if (!Array.isArray(parent)) {
    return;
  }
  const clone = deepClone(parent[key]);
  parent.splice(Number(key) + 1, 0, clone);
  markDesignerDirty();
  renderDesignerSteps();
}

function updateStepField(stepPath, field, value, valueType = 'text') {
  const step = readPath(state.designer, stepPath);
  if (!step) {
    return;
  }
  const parts = field.split('.');
  if (parts.length > 1) {
    let target = step;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
      if (target[key] == null) {
        target[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      target = target[key];
    }
    const lastKey = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts[parts.length - 1]) : parts[parts.length - 1];
    target[lastKey] = coerceValue(value, valueType);
  } else {
    step[field] = coerceValue(value, valueType);
  }
  markDesignerDirty();
  if (field === 'source' || field === 'variable_scope') {
    renderDesignerSteps();
  }
}

function updateStepCheckbox(stepPath, field, checked) {
  const step = readPath(state.designer, stepPath);
  if (!step) {
    return;
  }
  step[field] = Boolean(checked);
  markDesignerDirty();
}

function toggleStepModifier(stepPath, modifier, checked) {
  const step = readPath(state.designer, stepPath);
  if (!step) {
    return;
  }
  const modifiers = Array.isArray(step.modifiers) ? [...step.modifiers] : [];
  if (checked && !modifiers.includes(modifier)) {
    modifiers.push(modifier);
  } else if (!checked) {
    const index = modifiers.indexOf(modifier);
    if (index !== -1) {
      modifiers.splice(index, 1);
    }
  }
  step.modifiers = modifiers;
  markDesignerDirty();
}

function addSequenceItem(stepPath) {
  const step = readPath(state.designer, stepPath);
  if (!step) {
    return;
  }
  step.sequence = Array.isArray(step.sequence) ? step.sequence : [];
  step.sequence.push({ keys: '', delay_ms: 100 });
  markDesignerDirty();
  renderDesignerSteps();
}

function removeSequenceItem(stepPath, index) {
  const step = readPath(state.designer, stepPath);
  if (!step || !Array.isArray(step.sequence)) {
    return;
  }
  step.sequence.splice(index, 1);
  markDesignerDirty();
  renderDesignerSteps();
}

function moveSequenceItem(stepPath, index, direction) {
  const step = readPath(state.designer, stepPath);
  if (!step || !Array.isArray(step.sequence)) {
    return;
  }
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= step.sequence.length) {
    return;
  }
  [step.sequence[index], step.sequence[targetIndex]] = [step.sequence[targetIndex], step.sequence[index]];
  markDesignerDirty();
  renderDesignerSteps();
}

function updateSequenceItem(stepPath, index, field, value, valueType = 'text') {
  const step = readPath(state.designer, stepPath);
  if (!step || !Array.isArray(step.sequence) || !step.sequence[index]) {
    return;
  }
  step.sequence[index][field] = coerceValue(value, valueType);
  markDesignerDirty();
}

function addCheckPixelPoint(stepPath) {
  const step = readPath(state.designer, stepPath);
  if (!step) return;
  step.points = Array.isArray(step.points) ? step.points : [];
  step.points.push({ x: 0, y: 0, expected_color: '', tolerance: 20 });
  markDesignerDirty();
  renderDesignerSteps();
}

function removeCheckPixelPoint(stepPath, index) {
  const step = readPath(state.designer, stepPath);
  if (!step || !Array.isArray(step.points)) return;
  step.points.splice(index, 1);
  markDesignerDirty();
  renderDesignerSteps();
}

function addFingerprintPoint(stepPath) {
  const step = readPath(state.designer, stepPath);
  if (!step) return;
  step.sample_points = Array.isArray(step.sample_points) ? step.sample_points : [];
  step.sample_points.push({ dx: 0, dy: 0, expected_color: '' });
  markDesignerDirty();
  renderDesignerSteps();
}

function removeFingerprintPoint(stepPath, index) {
  const step = readPath(state.designer, stepPath);
  if (!step || !Array.isArray(step.sample_points)) return;
  step.sample_points.splice(index, 1);
  markDesignerDirty();
  renderDesignerSteps();
}
