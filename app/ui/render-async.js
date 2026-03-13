function renderSettingsPanel() {
  return `
    <div class="workspace-stack">
      <article class="workflow-card workspace-panel">
        <div class="workflow-top">
          <div>
            <div class="badge-row">
              <span class="source-badge custom">设置</span>
            </div>
            <h4>界面设置</h4>
            <p>这里先提供主题切换，后续可以继续扩展更多界面偏好。</p>
          </div>
        </div>
        <div class="setting-grid">
          ${fieldItem(
            '界面主题',
            `<select class="control-input" id="theme-select" onchange="window.setTheme(this.value)">
              <option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>深色</option>
              <option value="graphite" ${state.theme === 'graphite' ? 'selected' : ''}>石墨</option>
              <option value="light" ${state.theme === 'light' ? 'selected' : ''}>浅色</option>
            </select>`,
            '切换后立即生效，并保存在当前电脑。',
          )}
          ${fieldItem('流程来源', `<input class="control-input" value="${escapeHtml(state.app.workflow_source ?? '--')}" readonly />`)}
          ${fieldItem('当前版本', `<input class="control-input" value="${escapeHtml(state.app.version ?? '--')}" readonly />`)}
          ${fieldItem('流程总数', `<input class="control-input" value="${escapeHtml(state.summary.workflow_count ?? 0)}" readonly />`)}
          ${fieldItem('后台识图数量', `<input class="control-input" value="${escapeHtml(state.asyncVision.monitors.length)}" readonly />`)}
          ${fieldItem('共享数据', `<input class="control-input" value="${escapeHtml(state.asyncVision.sharedVariables.length)}" readonly />`)}
        </div>
      </article>
    </div>
  `;
}

function renderAboutPanel() {
  const architectureItems = state.architecture.length
    ? state.architecture.map((item) => `
      <article class="architecture-item">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.description)}</p>
      </article>
    `).join('')
    : '<div class="empty-state compact">暂无架构说明。</div>';

  return `
    <div class="workspace-stack">
      <article class="workflow-card workspace-panel">
        <div class="workflow-top">
          <div>
            <div class="badge-row">
              <span class="source-badge custom">关于</span>
            </div>
            <h4>Luoqi Assistant</h4>
            <p>当前主界面聚焦在流程、流程编辑、后台识图和运行状态，说明信息统一收纳到这里。</p>
          </div>
        </div>
        <div class="note-group">
          <span class="action-chip">流程编排</span>
          <span class="action-chip">后台识图</span>
          <span class="action-chip">共享数据</span>
          <span class="action-chip">主题切换</span>
        </div>
      </article>
      <article class="workflow-card workspace-panel">
        <div class="panel-head compact">
          <div>
            <h4>架构约定</h4>
          </div>
        </div>
        <div class="architecture-list">${architectureItems}</div>
      </article>
      <article class="workflow-card workspace-panel">
        <div class="panel-head compact">
          <div>
            <h4>配置位置</h4>
          </div>
        </div>
        <ul class="guide-list">
          <li>流程编排数据保存在 <code>data/config.json</code> 的 <code>custom_workflows.flows</code>。</li>
          <li>后台识图配置保存在 <code>data/config.json</code> 的 <code>async_vision.monitors</code>。</li>
          <li>上传的模板图会写入 <code>assets/templates</code>，流程与后台识图都可复用。</li>
        </ul>
      </article>
    </div>
  `;
}

function renderAsyncMonitorCard(monitor) {
  const runtime = monitor.runtime ?? {};
  const status = String(runtime.status ?? (monitor.enabled ? 'idle' : 'disabled'));
  return `
    <article class="workflow-card compact-card">
      <div class="workflow-top">
        <div>
          <div class="badge-row">
            <span class="source-badge custom">后台识图</span>
            <span class="category-badge">${escapeHtml(asyncMonitorPresetLabel(monitor.preset))}</span>
            <span class="source-badge ${monitor.enabled ? 'trigger' : 'loop'}">${monitor.enabled ? '启用' : '停用'}</span>
          </div>
          <h4>${escapeHtml(monitor.name ?? monitor.monitor_id ?? '未命名识别')}</h4>
        </div>
        <span class="runtime-badge ${escapeHtml(asyncMonitorStatusClass(status))}">${escapeHtml(asyncMonitorStatusLabel(status))}</span>
      </div>
      <div class="compact-meta">
        <span>结果：${escapeHtml(monitor.output_variable ?? 'target')}</span>
        <span>${escapeHtml(asyncSearchScopeLabel(monitor.search_scope))}</span>
        <span>${escapeHtml(asyncScanRateLabel(monitor.scan_rate))}</span>
        <span>刷新：${escapeHtml(monitor.effective_interval_ms ?? 350)}ms</span>
        <span>${escapeHtml(runtime.message ?? '暂无识图结果')}</span>
      </div>
      <div class="binding-actions-row">
        ${renderIconButton({ icon: 'edit', label: '编辑', onClick: `window.loadAsyncMonitorIntoEditor('${monitor.monitor_id}')` })}
        ${renderIconButton({ icon: 'delete-o', label: '删除', extraClass: 'danger-button', onClick: `window.deleteAsyncMonitor('${monitor.monitor_id}')` })}
      </div>
    </article>
  `;
}

function renderSharedVariablePanel() {
  const items = Array.isArray(state.asyncVision.sharedVariables) ? state.asyncVision.sharedVariables : [];
  const body = items.length
    ? `<div class="shared-var-list">${items.map((item) => {
        const meta = item._shared ?? {};
        const status = String(meta.status ?? 'idle');
        const point = item.found ? `(${item.x ?? '--'}, ${item.y ?? '--'})` : '--';
        return `
          <div class="shared-var-row">
            <strong>${escapeHtml(item.output_variable ?? item.variable_name ?? 'target')}</strong>
            <span class="runtime-badge ${escapeHtml(asyncMonitorStatusClass(status))}">${escapeHtml(asyncMonitorStatusLabel(status))}</span>
            <span>${escapeHtml(item.found ? '找到' : '未找到')}</span>
            <span>坐标 ${escapeHtml(point)}</span>
            <span class="muted-text">${escapeHtml(meta.monitor_name ?? '未绑定')}</span>
          </div>
        `;
      }).join('')}</div>`
    : '<div class="empty-state">暂无共享数据。保存并启用识别后会显示在这里。</div>';

  return `
    <article class="workflow-card compact-card">
      <div class="panel-head compact">
        <div><h4>共享数据</h4></div>
        <span class="source-badge custom">${escapeHtml(items.length)} 条</span>
      </div>
      ${body}
    </article>
  `;
}

function renderAsyncMonitorList() {
  const monitors = Array.isArray(state.asyncVision.monitors) ? state.asyncVision.monitors : [];
  return monitors.length
    ? `<div class="workflow-grid workflow-grid-page">${monitors.map(renderAsyncMonitorCard).join('')}</div>`
    : '<div class="empty-state">当前还没有后台识图，先保存一个开始后台识图。</div>';
}

function refreshAsyncVisionRuntimePanels() {
  const monitorContainer = document.getElementById('async-vision-monitor-list');
  const sharedContainer = document.getElementById('async-vision-shared-variables');
  if (!monitorContainer || !sharedContainer) {
    renderWorkflows();
    return;
  }
  monitorContainer.innerHTML = renderAsyncMonitorList();
  sharedContainer.innerHTML = renderSharedVariablePanel();
}

function renderAsyncVisionWorkspace() {
  return `
    <div class="workspace-stack">
      ${renderAsyncMonitorEditorCard()}
      <div id="async-vision-monitor-list">${renderAsyncMonitorList()}</div>
      <div id="async-vision-shared-variables">${renderSharedVariablePanel()}</div>
    </div>
  `;
}
