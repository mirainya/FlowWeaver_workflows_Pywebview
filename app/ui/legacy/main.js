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

  for (const { workflow, runtime } of items) {
    const wid = workflow.workflow_id;
    let el = document.getElementById(`rt-item-${wid}`);
    if (!el) {
      container.innerHTML = items.map(({ workflow: w, runtime: r }) => `
        <article class="runtime-item" id="rt-item-${escapeHtml(w.workflow_id)}">
          <header>
            <strong class="rt-name">${escapeHtml(w.name)}</strong>
            <span class="runtime-badge rt-badge ${escapeHtml(r.status ?? 'idle')}">${escapeHtml(r.status_label ?? '待机')}</span>
          </header>
          <div class="runtime-item-meta">
            <span class="rt-mode">模式：${escapeHtml(runModeLabel(w.run_mode))}</span>
            <span class="rt-iter">轮次：${escapeHtml(r.iteration_count ?? 0)}</span>
            <span class="rt-keys">按键：${escapeHtml(r.key_event_count ?? 0)}</span>
            <span class="rt-lastkey">最后按键：${escapeHtml(r.last_key ?? '--')}</span>
          </div>
          <p class="rt-msg">${escapeHtml(r.last_message ?? '尚未触发')}</p>
        </article>
      `).join('');
      return;
    }
    const badge = el.querySelector('.rt-badge');
    if (badge) {
      badge.className = `runtime-badge rt-badge ${escapeHtml(runtime.status ?? 'idle')}`;
      badge.textContent = runtime.status_label ?? '待机';
    }
    const iter = el.querySelector('.rt-iter');
    if (iter) iter.textContent = `轮次：${runtime.iteration_count ?? 0}`;
    const keys = el.querySelector('.rt-keys');
    if (keys) keys.textContent = `按键：${runtime.key_event_count ?? 0}`;
    const lastkey = el.querySelector('.rt-lastkey');
    if (lastkey) lastkey.textContent = `最后按键：${runtime.last_key ?? '--'}`;
    const msg = el.querySelector('.rt-msg');
    if (msg) msg.textContent = runtime.last_message ?? '尚未触发';
  }
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

  const currentCount = container.querySelectorAll('.activity-item').length;
  if (currentCount === events.length) return;

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

  const currentCount = container.querySelectorAll('.log-item').length;
  if (currentCount === state.logs.length) return;

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

function updateStepRunningHighlight() {
  const wfId = state.designer.workflow_id;
  const rt = wfId ? state.runtime?.workflow_states?.[wfId] : null;
  const activeIndex = (rt && rt.active) ? (rt.current_step_index ?? -1) : -1;
  const steps = Array.isArray(state.designer.steps) ? state.designer.steps : [];
  for (let i = 0; i < steps.length; i++) {
    const el = document.getElementById(`step-card-steps-${i}`);
    if (!el) continue;
    el.classList.toggle('step-running', i === activeIndex);
  }
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
  updateStepRunningHighlight();
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
window.addCheckPixelPoint = addCheckPixelPoint;
window.removeCheckPixelPoint = removeCheckPixelPoint;
window.addFingerprintPoint = addFingerprintPoint;
window.removeFingerprintPoint = removeFingerprintPoint;
window.loadAsyncMonitorIntoEditor = loadAsyncMonitorIntoEditor;
window.resetAsyncMonitorEditor = resetAsyncMonitorEditor;
window.updateAsyncMonitorField = updateAsyncMonitorField;
window.updateAsyncMonitorRegionField = updateAsyncMonitorRegionField;
window.updateAsyncMonitorCheckbox = updateAsyncMonitorCheckbox;
window.updateAsyncMonitorNestedField = updateAsyncMonitorNestedField;
window.updateAsyncMonitorJsonField = updateAsyncMonitorJsonField;
window.addAsyncPixelPoint = addAsyncPixelPoint;
window.addAsyncFingerprintSamplePoint = addAsyncFingerprintSamplePoint;
window.updateAsyncMonitorNestedJsonField = updateAsyncMonitorNestedJsonField;
window.saveAsyncMonitor = saveAsyncMonitor;
window.uploadTemplateForAsyncMonitor = uploadTemplateForAsyncMonitor;

async function pickRegionForAsyncMonitor() {
  try {
    const region = await openRegionSelectOverlay();
    if (!region) return;
    window.updateAsyncMonitorRegionField('left', String(region.left));
    window.updateAsyncMonitorRegionField('top', String(region.top));
    window.updateAsyncMonitorRegionField('width', String(region.width));
    window.updateAsyncMonitorRegionField('height', String(region.height));
    renderWorkflows();
    showToast('已从屏幕框选设置区域。', 'success');
  } catch (err) {
    window.alert(`区域框选失败：${err}`);
  }
}
window.pickRegionForAsyncMonitor = pickRegionForAsyncMonitor;

async function pickRegionForAsyncMonitorConfig(configField) {
  try {
    const region = await openRegionSelectOverlay();
    if (!region) return;
    window.updateAsyncMonitorNestedField(configField, 'left', String(region.left), 'int');
    window.updateAsyncMonitorNestedField(configField, 'top', String(region.top), 'int');
    window.updateAsyncMonitorNestedField(configField, 'width', String(region.width), 'int');
    window.updateAsyncMonitorNestedField(configField, 'height', String(region.height), 'int');
    renderWorkflows();
    showToast('已从屏幕框选设置区域。', 'success');
  } catch (err) {
    window.alert(`区域框选失败：${err}`);
  }
}
window.pickRegionForAsyncMonitorConfig = pickRegionForAsyncMonitorConfig;

async function pickPixelPointForAsync() {
  try {
    const resp = await fetch('/api/pick_color', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    if (!data.ok) {
      window.alert(`取色失败：${data.error ?? '未知错误'}`);
      return;
    }
    syncAsyncMonitorEditorFromDom();
    if (!Array.isArray(state.asyncVision.editor.pixel_points)) {
      state.asyncVision.editor.pixel_points = [];
    }
    state.asyncVision.editor.pixel_points.push({
      x: data.x ?? 0,
      y: data.y ?? 0,
      expected_color: data.hex ?? '#000000',
      tolerance: 20,
    });
    renderWorkflows();
    showToast(`已添加检测点 (${data.x}, ${data.y}) ${data.hex}`, 'success');
  } catch (err) {
    window.alert(`取色失败：${err}`);
  }
}
window.pickPixelPointForAsync = pickPixelPointForAsync;

async function captureFingerprint() {
  try {
    syncAsyncMonitorEditorFromDom();
    const cfg = state.asyncVision.editor.fingerprint_config || {};
    const anchorX = cfg.anchor_x ?? 0;
    const anchorY = cfg.anchor_y ?? 0;
    if (!anchorX && !anchorY) {
      window.alert('请先设置锚点坐标（anchor_x, anchor_y）。');
      return;
    }
    const offsets = [];
    for (let dx = -20; dx <= 20; dx += 10) {
      for (let dy = -20; dy <= 20; dy += 10) {
        if (dx === 0 && dy === 0) continue;
        offsets.push([dx, dy]);
      }
    }
    const resp = await fetch('/api/capture_fingerprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor_x: anchorX, anchor_y: anchorY, offsets }),
    });
    const data = await resp.json();
    if (!data.ok) {
      window.alert(`采集指纹失败：${data.error ?? '未知错误'}`);
      return;
    }
    if (!state.asyncVision.editor.fingerprint_config || typeof state.asyncVision.editor.fingerprint_config !== 'object') {
      state.asyncVision.editor.fingerprint_config = { anchor_x: anchorX, anchor_y: anchorY, tolerance: 20, sample_points: [] };
    }
    state.asyncVision.editor.fingerprint_config.sample_points = data.sample_points ?? [];
    renderWorkflows();
    showToast(`已采集 ${(data.sample_points ?? []).length} 个指纹采样点。`, 'success');
  } catch (err) {
    window.alert(`采集指纹失败：${err}`);
  }
}
window.captureFingerprint = captureFingerprint;
window.saveWorkflow = saveWorkflow;
window.updateWorkflowEnabled = updateWorkflowEnabled;
window.uploadTemplateForStep = uploadTemplateForStep;
window.runWorkflow = runWorkflow;

async function testTemplateMatch(stepPath, resultId) {
  const step = readPath(state.designer, stepPath);
  if (!step || !step.template_path) {
    window.alert('请先填写模板图路径。');
    return;
  }
  const resultEl = document.getElementById(resultId);
  if (resultEl) {
    resultEl.innerHTML = '<span class="capture-hint">匹配中…</span>';
  }
  try {
    const client = api();
    if (!client?.test_template_match) {
      throw new Error('当前版本不支持匹配测试。');
    }
    const res = await client.test_template_match({
      template_path: step.template_path,
      confidence: step.confidence ?? 0.88,
    });
    if (!res?.ok) {
      throw new Error(res?.error || '匹配测试失败。');
    }
    if (resultEl) {
      const statusClass = res.found ? 'match-found' : 'match-miss';
      const previewHtml = res.preview_url
        ? `<img class="match-preview-img" src="${res.preview_url}" alt="匹配预览" />`
        : '';
      resultEl.innerHTML = `
        <div class="match-test-info ${statusClass}">
          <span>${escapeHtml(res.message || '')}</span>
          ${res.found ? `<span class="match-coords">(${res.x}, ${res.y})</span>` : ''}
        </div>
        ${previewHtml}
      `;
    }
  } catch (err) {
    if (resultEl) {
      resultEl.innerHTML = `<span class="match-test-info match-miss">${escapeHtml(String(err))}</span>`;
    }
  }
}
window.testTemplateMatch = testTemplateMatch;
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
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      if (state.activeTab === 'designer' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        undoDesigner();
      }
    }
    if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
      if (state.activeTab === 'designer' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        redoDesigner();
      }
    }
  });
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

  const tplBtn = document.getElementById('designer-template-insert');
  const tplMenu = document.getElementById('designer-template-menu');
  if (tplBtn && tplMenu) {
    tplMenu.innerHTML = Object.entries(STEP_TEMPLATES).map(([key, tpl]) =>
      `<button class="dropdown-item" type="button" data-tpl="${key}"><strong>${escapeHtml(tpl.label)}</strong><small>${escapeHtml(tpl.description)}</small></button>`
    ).join('');
    tplBtn.addEventListener('click', () => { tplMenu.hidden = !tplMenu.hidden; });
    tplMenu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-tpl]');
      if (!item) return;
      insertStepTemplate('steps', item.dataset.tpl);
      tplMenu.hidden = true;
    });
    document.addEventListener('click', (e) => {
      if (!tplBtn.contains(e.target) && !tplMenu.contains(e.target)) {
        tplMenu.hidden = true;
      }
    });
  }

  document.getElementById('designer-name').addEventListener('input', (event) => updateDesignerField('name', event.target.value));
  document.getElementById('designer-hotkey').addEventListener('input', (event) => updateDesignerField('hotkey', event.target.value));
  document.getElementById('designer-description').addEventListener('input', (event) => updateDesignerField('description', event.target.value));
  document.getElementById('designer-enabled').addEventListener('change', (event) => updateDesignerEnabled(event.target.checked));
  document.getElementById('designer-run-mode').addEventListener('change', (event) => updateDesignerRunMode(event.target.value));
  document.getElementById('designer-repeat-count').addEventListener('input', (event) => updateDesignerRunCount(event.target.value));

  window.setTimeout(initializeApp, 300);
});
