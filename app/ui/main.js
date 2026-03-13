async function uploadTemplateForAsyncMonitor() {
  try {
    await flushAsyncMonitorEditorDom();
    const templatePath = await uploadTemplateImage();
    if (!templatePath) {
      return;
    }
    updateAsyncMonitorField('template_path', templatePath);
    const templateInput = document.getElementById('async-monitor-template-path');
    if (templateInput instanceof HTMLInputElement) {
      templateInput.value = templatePath;
    }
    showToast('模板图已上传。', 'success');
  } catch (error) {
    window.alert(`上传模板失败：${error}`);
  }
}

async function saveAsyncMonitor() {
  const client = api();
  if (!client?.save_async_monitor) {
    return;
  }

  await flushAsyncMonitorEditorDom();
  const payload = collectAsyncMonitorPayload();
  const isEditingExisting = Boolean(payload.monitor_id);
  if (!payload.name) {
    window.alert('请先填写识别名称。');
    return;
  }
  if (!payload.output_variable) {
    window.alert('请先填写结果名称。');
    return;
  }
  if (!payload.template_path) {
    window.alert('请先选择模板图片。');
    return;
  }

  try {
    const result = await client.save_async_monitor(payload);
    await loadBootstrap();
    if (isEditingExisting && result?.monitor?.monitor_id) {
      loadAsyncMonitorIntoEditor(result.monitor.monitor_id);
    } else {
      resetAsyncMonitorEditor();
    }
    showToast(isEditingExisting ? '后台识图已更新。' : '后台识图已保存，可继续新建下一条。', 'success');
  } catch (error) {
    window.alert(`保存识别失败：${error}`);
  }
}

async function deleteAsyncMonitor(monitorId) {
  const client = api();
  if (!client?.delete_async_monitor) {
    return;
  }

  const monitor = getAsyncMonitorById(monitorId);
  if (!monitor) {
    return;
  }

  if (!window.confirm(`确认删除后台识图「${monitor.name}」吗？`)) {
    return;
  }

  await client.delete_async_monitor(monitorId);
  if (state.asyncVision.editor?.monitor_id === monitorId) {
    state.asyncVision.editor = createEmptyAsyncMonitor();
  }
  await loadBootstrap();
  showToast('后台识图已删除。', 'success');
}

function renderWorkflows() {
  const container = document.getElementById('workflow-grid');
  if (!container) {
    return;
  }

  container.hidden = false;

  if (state.activeTab === 'async_vision') {
    container.innerHTML = renderAsyncVisionWorkspace();
    return;
  }

  if (state.activeTab === 'settings') {
    container.innerHTML = renderSettingsPanel();
    return;
  }

  if (state.activeTab === 'about') {
    container.innerHTML = renderAboutPanel();
    return;
  }

  container.innerHTML = renderFlowWorkspace();
}

function renderRuntimeOverview() {
  const container = document.getElementById('runtime-overview');
  if (!container) {
    return;
  }

  const items = state.workflows.map((workflow) => ({
    workflow,
    runtime: getWorkflowRuntime(workflow.workflow_id),
  })).sort((left, right) => {
    const activeDelta = Number(right.runtime.active) - Number(left.runtime.active);
    if (activeDelta !== 0) {
      return activeDelta;
    }
    return String(left.workflow.name).localeCompare(String(right.workflow.name), 'zh-CN');
  });

  if (!items.length) {
    container.innerHTML = '<div class="empty-state">暂无运行状态。</div>';
    return;
  }

  container.innerHTML = items.map(({ workflow, runtime }) => `
    <article class="runtime-item">
      <header>
        <strong>${escapeHtml(workflow.name)}</strong>
        <span class="runtime-badge ${escapeHtml(runtime.status ?? 'idle')}">${escapeHtml(runtime.status_label ?? '待机')}</span>
      </header>
      <div class="runtime-item-meta">
        <span>模式：${escapeHtml(runModeLabel(workflow.run_mode))}</span>
        <span>轮次：${escapeHtml(runtime.iteration_count ?? 0)}</span>
        <span>按键：${escapeHtml(runtime.key_event_count ?? 0)}</span>
        <span>最后按键：${escapeHtml(runtime.last_key ?? '--')}</span>
      </div>
      <p>${escapeHtml(runtime.last_message ?? '尚未触发')}</p>
    </article>
  `).join('');
}

function renderKeyEvents() {
  const container = document.getElementById('key-event-list');
  if (!container) {
    return;
  }

  const events = Array.isArray(state.runtime.key_events) ? state.runtime.key_events : [];
  if (!events.length) {
    container.innerHTML = '<div class="empty-state">还没有按键记录。按下热键或让宏输出按键后会显示在这里。</div>';
    return;
  }

  container.innerHTML = events.map((event) => `
    <article class="activity-item">
      <header>
        <strong>${escapeHtml(event.workflow_name ?? event.workflow_id ?? '未知流程')}</strong>
        <span>${escapeHtml(event.time ?? '--')}</span>
      </header>
      <p>${escapeHtml(event.description ?? '')}</p>
      <small>按键：${escapeHtml(event.key ?? '--')} · 来源：${escapeHtml(event.source ?? '--')}</small>
    </article>
  `).join('');
}

function renderLogs() {
  const container = document.getElementById('log-list');
  if (!container) {
    return;
  }

  if (!state.logs.length) {
    container.innerHTML = '<div class="empty-state">暂无运行日志。</div>';
    return;
  }

  container.innerHTML = state.logs.map((log) => `
    <article class="log-item">
      <header>
        <strong>${escapeHtml(log.time ?? '--')}</strong>
        <span class="log-level ${escapeHtml(log.level ?? 'info')}">${escapeHtml(log.level ?? 'info')}</span>
      </header>
      <p>${escapeHtml(log.message ?? '')}</p>
    </article>
  `).join('');
}

function renderRuntime() {
  renderSummary();
  renderRuntimeOverview();
  renderKeyEvents();
}

function renderAll() {
  applyTheme();
  renderHero();
  renderSummary();
  renderArchitecture();
  renderTabs();
  renderDesigner();
  renderWorkflows();
  renderRuntime();
  renderLogs();
  renderToast();
}

function setBootstrap(data) {
  state.tabs = data.tabs ?? [];
  state.workflows = data.workflows ?? [];
  state.logs = data.logs ?? [];
  state.summary = data.summary ?? {};
  state.app = data.app ?? {};
  state.architecture = data.architecture ?? [];
  state.runtime = data.runtime ?? state.runtime;
  state.designerDefaults = data.designer_defaults ?? state.designerDefaults;
  state.asyncVision.monitors = data.async_vision?.monitors ?? [];
  state.asyncVision.sharedVariables = data.async_vision?.shared_variables ?? [];
  state.asyncVision.editor = state.asyncVision.editor
    ? normalizeAsyncMonitor(state.asyncVision.editor)
    : createEmptyAsyncMonitor();

  ensureActiveTab();
  if (state.designer.workflow_id && !getWorkflowById(state.designer.workflow_id)) {
    state.designer = createEmptyDesigner();
    resetDesignerSaveState();
  }
  if (state.asyncVision.editor.monitor_id && !getAsyncMonitorById(state.asyncVision.editor.monitor_id)) {
    state.asyncVision.editor = createEmptyAsyncMonitor();
  }
  renderAll();
}

function updateFlowSearch(value) {
  state.flowQuery = String(value ?? '');
  renderWorkflows();
}

function updateFlowFilter(value) {
  state.flowFilter = String(value ?? 'all');
  renderWorkflows();
}

function updateFlowSort(value) {
  state.flowSort = String(value ?? 'name');
  renderWorkflows();
}

function toggleFlowViewMode() {
  state.flowViewMode = state.flowViewMode === 'card' ? 'list' : 'card';
  renderWorkflows();
}

function toggleFlowGroupBy() {
  state.flowGroupBy = state.flowGroupBy === 'category' ? '' : 'category';
  renderWorkflows();
}

function setTheme(theme) {
  applyTheme(theme);
  renderWorkflows();
  showToast(`主题已切换为${({ dark: '深色', graphite: '石墨', light: '浅色' })[state.theme] ?? '深色'}。`, 'success');
}

function collectSettings(workflow) {
  const settings = {};
  for (const setting of workflow.settings ?? []) {
    const element = document.getElementById(`setting-${workflow.workflow_id}-${setting.key}`);
    if (!element) {
      continue;
    }
    settings[setting.key] = element.value;
  }
  return settings;
}

function collectDesignerPayload() {
  const runModeType = document.getElementById('designer-run-mode')?.value ?? 'once';
  const repeatCount = document.getElementById('designer-repeat-count')?.value ?? 1;

  return {
    workflow_id: state.designer.workflow_id,
    name: document.getElementById('designer-name')?.value.trim() ?? '',
    hotkey: document.getElementById('designer-hotkey')?.value.trim() ?? '',
    description: document.getElementById('designer-description')?.value.trim() ?? '',
    enabled: document.getElementById('designer-enabled')?.checked ?? true,
    run_mode: normalizeRunMode({ type: runModeType, count: repeatCount }),
    steps: normalizeSteps(state.designer.steps, false),
  };
}

async function loadBootstrap() {
  const client = api();
  if (!client?.bootstrap) {
    return;
  }
  const data = await client.bootstrap();
  setBootstrap(data);
}

async function refreshLogs() {
  const client = api();
  if (!client?.list_logs) {
    return;
  }
  state.logs = await client.list_logs();
  renderLogs();
}

async function refreshRuntime() {
  const client = api();
  if (!client?.get_runtime_snapshot) {
    return;
  }
  state.runtime = await client.get_runtime_snapshot();
  if (client?.get_async_vision_snapshot) {
    const asyncVision = await client.get_async_vision_snapshot();
    state.asyncVision.monitors = asyncVision?.monitors ?? state.asyncVision.monitors;
    state.asyncVision.sharedVariables = asyncVision?.shared_variables ?? state.asyncVision.sharedVariables;
    if (state.activeTab === 'async_vision') {
      refreshAsyncVisionRuntimePanels();
    }
  }
  renderRuntime();
}

async function saveWorkflow(workflowId) {
  const client = api();
  if (!client?.save_binding) {
    return;
  }

  const workflow = getWorkflowById(workflowId);
  if (!workflow) {
    return;
  }

  const hotkey = document.getElementById(`hotkey-${workflowId}`)?.value?.trim() ?? '';
  const enabled = document.getElementById(`enabled-${workflowId}`)?.checked ?? true;
  const settings = collectSettings(workflow);

  updateWorkflowBindingState(workflowId, { hotkey, enabled });
  await client.save_binding(workflowId, hotkey, enabled, settings);
  await loadBootstrap();
}

async function updateWorkflowEnabled(workflowId, enabled) {
  const workflow = getWorkflowById(workflowId);
  if (!workflow) {
    return;
  }

  const normalizedEnabled = Boolean(enabled);
  const previousEnabled = Boolean(workflow.binding?.enabled);
  updateWorkflowBindingState(workflowId, { enabled: normalizedEnabled });

  try {
    await saveWorkflow(workflowId);
  } catch (error) {
    updateWorkflowBindingState(workflowId, { enabled: previousEnabled });
    renderWorkflows();
    window.alert(`保存启用状态失败：${error}`);
  }
}

async function saveCustomFlow() {
  const client = api();
  if (!client?.save_custom_flow && !client?.save_loop_macro) {
    return;
  }

  const payload = collectDesignerPayload();
  if (!payload.name) {
    window.alert('请先填写流程名字。');
    return;
  }
  if (!payload.hotkey) {
    window.alert('请先填写触发热键。');
    return;
  }
  if (!payload.steps.length) {
    window.alert('至少添加一个步骤。');
    return;
  }

  try {
    setDesignerSaveStatus('saving');
    const result = client.save_custom_flow
      ? await client.save_custom_flow(payload)
      : await client.save_loop_macro(payload);
    await loadBootstrap();
    if (result?.workflow?.workflow_id) {
      loadWorkflowIntoDesigner(result.workflow.workflow_id);
    } else {
      resetDesigner(true);
    }
    setDesignerSaveStatus('saved');
    showToast('流程已保存。', 'success');
  } catch (error) {
    setDesignerSaveStatus('error', String(error));
    window.alert(`保存流程失败：${error}`);
  }
}

async function uploadTemplateForStep(stepPath) {
  try {
    const templatePath = await uploadTemplateImage();
    if (!templatePath) {
      return;
    }
    window.updateStepField(stepPath, 'template_path', templatePath);
    renderDesignerSteps();
    showToast('模板图已上传。', 'success');
  } catch (error) {
    window.alert(`上传模板失败：${error}`);
  }
}

async function deleteCustomWorkflow(workflowId) {
  const client = api();
  if (!client?.delete_custom_workflow) {
    return;
  }

  const workflow = getWorkflowById(workflowId);
  if (!workflow?.is_custom) {
    return;
  }

  if (!window.confirm(`确认删除流程“${workflow.name}”吗？`)) {
    return;
  }

  await client.delete_custom_workflow(workflowId);
  if (state.designer.workflow_id === workflowId) {
    state.designer = createEmptyDesigner();
    resetDesignerSaveState();
  }
  await loadBootstrap();
  showToast('流程已删除。', 'success');
}

async function runWorkflow(workflowId) {
  const client = api();
  if (!client?.run_workflow_now) {
    return;
  }

  await client.run_workflow_now(workflowId);
  window.setTimeout(refreshRuntime, 180);
  window.setTimeout(refreshLogs, 220);
}

async function initializeApp() {
  if (state.bootstrapped) {
    return;
  }
  if (!api()?.bootstrap) {
    return;
  }

  state.bootstrapped = true;
  applyTheme(state.theme);
  state.designer = createEmptyDesigner();
  await loadBootstrap();

  if (!state.timersStarted) {
    state.timersStarted = true;
    window.setInterval(refreshRuntime, 700);
    window.setInterval(refreshLogs, 1400);
  }
}

window.setActiveTab = setActiveTab;
window.resetDesigner = resetDesigner;
window.loadWorkflowIntoDesigner = loadWorkflowIntoDesigner;
window.addDesignerStep = addDesignerStep;
window.removeDesignerStep = removeDesignerStep;
window.moveDesignerStep = moveDesignerStep;
window.changeDesignerStepKind = changeDesignerStepKind;
window.toggleStepCollapse = toggleStepCollapse;
window.duplicateDesignerStep = duplicateDesignerStep;
window.updateStepField = updateStepField;
window.updateStepCheckbox = updateStepCheckbox;
window.toggleStepModifier = toggleStepModifier;
window.addSequenceItem = addSequenceItem;
window.removeSequenceItem = removeSequenceItem;
window.moveSequenceItem = moveSequenceItem;
window.updateSequenceItem = updateSequenceItem;
window.loadAsyncMonitorIntoEditor = loadAsyncMonitorIntoEditor;
window.resetAsyncMonitorEditor = resetAsyncMonitorEditor;
window.updateAsyncMonitorField = updateAsyncMonitorField;
window.updateAsyncMonitorRegionField = updateAsyncMonitorRegionField;
window.updateAsyncMonitorCheckbox = updateAsyncMonitorCheckbox;
window.saveAsyncMonitor = saveAsyncMonitor;
window.uploadTemplateForAsyncMonitor = uploadTemplateForAsyncMonitor;
window.saveWorkflow = saveWorkflow;
window.updateWorkflowEnabled = updateWorkflowEnabled;
window.uploadTemplateForStep = uploadTemplateForStep;
window.runWorkflow = runWorkflow;
window.deleteAsyncMonitor = deleteAsyncMonitor;
window.deleteCustomWorkflow = deleteCustomWorkflow;
window.updateFlowSearch = updateFlowSearch;
window.updateFlowFilter = updateFlowFilter;
window.updateFlowSort = updateFlowSort;
window.toggleFlowViewMode = toggleFlowViewMode;
window.toggleFlowGroupBy = toggleFlowGroupBy;
window.setTheme = setTheme;

function toggleDesignerCollapse() {
  state.designerCollapsed = !state.designerCollapsed;
  const grid = document.querySelector('#flow-designer-panel .designer-grid');
  const toolbar = document.querySelector('#flow-designer-panel .step-toolbar');
  const stepRoot = document.getElementById('designer-step-list');
  const indexMap = document.getElementById('designer-step-index');
  const btn = document.getElementById('designer-collapse');
  const collapsed = state.designerCollapsed;
  if (grid) grid.hidden = collapsed;
  if (toolbar) toolbar.hidden = collapsed;
  if (stepRoot) stepRoot.hidden = collapsed;
  if (indexMap) {
    if (collapsed) {
      indexMap.hidden = true;
    } else {
      renderDesignerIndexMap();
    }
  }
  if (btn) btn.textContent = collapsed ? '展开' : '收起';
}
window.toggleDesignerCollapse = toggleDesignerCollapse;

function scrollToDesignerStep(index) {
  const element = document.getElementById(`step-card-steps-${index}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
window.scrollToDesignerStep = scrollToDesignerStep;

function toggleBottomPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) {
    return;
  }
  panel.classList.toggle('panel-collapsed');
}
window.toggleBottomPanel = toggleBottomPanel;

window.addEventListener('pywebviewready', initializeApp);
window.addEventListener('beforeunload', () => callCaptureApi('end_key_capture'));

window.addEventListener('DOMContentLoaded', () => {
  decorateStaticButtons();
  document.addEventListener('keydown', handleCapturedKeyInput, true);
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('input[data-key-capture]')) {
      requestCaptureSuspend();
      window.setTimeout(() => target.select(), 0);
    }
  });
  document.addEventListener('focusout', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches('input[data-key-capture]')) {
      requestCaptureResume();
    }
  });
  document.getElementById('refresh-button').addEventListener('click', loadBootstrap);
  document.getElementById('designer-reset').addEventListener('click', () => resetDesigner(true));
  document.getElementById('designer-save').addEventListener('click', saveCustomFlow);
  document.getElementById('designer-step-add').addEventListener('click', () => addDesignerStep('steps'));

  document.getElementById('designer-name').addEventListener('input', (event) => updateDesignerField('name', event.target.value));
  document.getElementById('designer-hotkey').addEventListener('input', (event) => updateDesignerField('hotkey', event.target.value));
  document.getElementById('designer-description').addEventListener('input', (event) => updateDesignerField('description', event.target.value));
  document.getElementById('designer-enabled').addEventListener('change', (event) => updateDesignerEnabled(event.target.checked));
  document.getElementById('designer-run-mode').addEventListener('change', (event) => updateDesignerRunMode(event.target.value));
  document.getElementById('designer-repeat-count').addEventListener('input', (event) => updateDesignerRunCount(event.target.value));

  window.setTimeout(initializeApp, 300);
});
