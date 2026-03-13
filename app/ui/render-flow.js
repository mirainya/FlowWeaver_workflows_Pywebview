function renderWorkflowSettings(workflow) {
  const settings = Array.isArray(workflow.settings) ? workflow.settings : [];
  if (!settings.length) {
    return '';
  }
  return `
    <div class="setting-grid compact-grid">
      ${settings.map((setting) => `
        <label class="field-item">
          <span>${escapeHtml(setting.title)}</span>
          <input
            class="control-input"
            id="setting-${workflow.workflow_id}-${setting.key}"
            type="number"
            min="${escapeHtml(setting.min_value ?? 0)}"
            max="${escapeHtml(setting.max_value ?? 999999)}"
            step="${escapeHtml(setting.step ?? 1)}"
            value="${escapeHtml(setting.value ?? setting.default_value ?? 0)}"
          />
          <small>${escapeHtml(setting.description ?? '')}</small>
        </label>
      `).join('')}
    </div>
  `;
}

function stepPreviewText(step) {
  if (step.kind === 'delay') {
    return `等待 ${step.milliseconds}ms`;
  }
  if (step.kind === 'key_sequence') {
    return `按键序列 ${step.sequence?.length ?? 0} 步`;
  }
  if (step.kind === 'detect_image') {
    return `识图写入 ${step.save_as}`;
  }
  if (step.kind === 'click_point') {
    const modifiers = Array.isArray(step.modifiers) && step.modifiers.length
      ? step.modifiers.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join('+') + '+'
      : '';
    if (step.source === 'current') {
      return `${modifiers}点击当前位置`;
    }
    if (step.source === 'absolute') {
      return `${modifiers}点击 (${step.x}, ${step.y})`;
    }
    return step.source === 'shared'
      ? `${modifiers}点击后台识图结果 ${step.var_name}`
      : `${modifiers}点击找图结果 ${step.var_name}`;
  }
  if (step.kind === 'if_var_found') {
    return step.variable_scope === 'shared'
      ? `分支 shared.${step.var_name}.found`
      : `分支 ${step.var_name}.found`;
  }
  if (step.kind === 'set_variable_state') {
    const scopeLabel = step.variable_scope === 'shared' ? 'shared.' : '';
    return `设置 ${scopeLabel}${step.var_name} = ${step.state === 'found' ? '找到了' : '没找到'}`;
  }
  if (step.kind === 'key_hold') {
    return `按住 ${step.key || '--'} 执行 ${step.steps?.length ?? 0} 步`;
  }
  return `按键 ${step.keys || '--'}`;
}

function renderStepPreview(steps) {
  if (!steps.length) {
    return '<div class="empty-state compact">暂无步骤预览。</div>';
  }
  const visible = steps.slice(0, 5);
  const chips = visible.map((step) => `<span class="action-chip">${escapeHtml(stepPreviewText(step))}</span>`).join('');
  const extra = steps.length > visible.length ? `<span class="action-chip">+${steps.length - visible.length} 步</span>` : '';
  return `<div class="action-group">${chips}${extra}</div>`;
}

function renderWorkflowCard(workflow) {
  const runtime = getWorkflowRuntime(workflow.workflow_id);
  const steps = getWorkflowSteps(workflow);

  return `
    <article class="workflow-card compact-card">
      <div class="workflow-top">
        <div>
          <div class="badge-row">
            <span class="source-badge ${workflow.is_custom ? 'custom' : 'builtin'}">${workflow.is_custom ? '自定义' : '内置'}</span>
            <span class="category-badge">${escapeHtml(workflow.category ?? '')}</span>
            <span class="source-badge ${workflow.is_loop ? 'loop' : 'trigger'}">${escapeHtml(runModeLabel(workflow.run_mode))}</span>
          </div>
          <h4>${escapeHtml(workflow.name)}</h4>
        </div>
        <span class="runtime-badge ${escapeHtml(runtime.status ?? 'idle')}">${escapeHtml(runtime.status_label ?? '待机')}</span>
      </div>

      <div class="runtime-meta compact-meta">
        <span>触发：${escapeHtml(runtime.last_trigger_time ?? '--')}</span>
        <span>轮次：${escapeHtml(runtime.iteration_count ?? 0)}</span>
        <span>${escapeHtml(runtime.last_message ?? '尚未触发')}</span>
      </div>

      <div class="binding-actions-row">
        ${renderKeyCaptureInput({
          inputId: `hotkey-${workflow.workflow_id}`,
          value: workflow.binding?.hotkey ?? '',
          placeholder: '录入热键',
          captureTarget: 'workflow-hotkey',
        })}
        <label class="toggle toggle-card mini-toggle">
          <input id="enabled-${workflow.workflow_id}" type="checkbox" ${workflow.binding?.enabled ? 'checked' : ''} onchange="window.updateWorkflowEnabled('${workflow.workflow_id}', this.checked)" />
          启用
        </label>
        ${renderIconButton({ icon: 'success', label: '保存', onClick: `window.saveWorkflow('${workflow.workflow_id}')` })}
        ${renderIconButton({ icon: 'play-circle-o', label: '执行', variant: 'primary', onClick: `window.runWorkflow('${workflow.workflow_id}')` })}
        ${workflow.definition_editable ? renderIconButton({ icon: 'edit', label: '编辑', onClick: `window.loadWorkflowIntoDesigner('${workflow.workflow_id}')` }) : ''}
        ${workflow.is_custom ? renderIconButton({ icon: 'delete-o', label: '删除', extraClass: 'danger-button', onClick: `window.deleteCustomWorkflow('${workflow.workflow_id}')` }) : ''}
      </div>

      ${renderWorkflowSettings(workflow)}
    </article>
  `;
}


function formatAsyncUpdatedAt(rawValue) {
  const timestamp = Number(rawValue ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '--';
  }
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false });
}

function asyncMonitorStatusClass(status) {
  if (status === 'hit') {
    return 'success';
  }
  if (status === 'running') {
    return 'running';
  }
  if (status === 'error') {
    return 'error';
  }
  return 'idle';
}

function asyncMonitorStatusLabel(status) {
  return ({
    idle: '待机',
    running: '运行中',
    hit: '找到了',
    miss: '没找到',
    error: '异常',
    disabled: '已停用',
  })[status] ?? (status || '待机');
}

function asyncMonitorPresetLabel(presetKey) {
  return ASYNC_MONITOR_PRESETS[presetKey]?.label ?? '固定按钮';
}

function asyncSearchScopeLabel(scope) {
  return ({
    full_screen: '全屏查找',
    fixed_region: '固定区域查找',
    follow_last: '先全屏找到，之后优先在附近找',
  })[scope] ?? '全屏查找';
}

function asyncScanRateLabel(scanRate) {
  return ({
    low: '省资源',
    normal: '均衡',
    high: '高速',
    ultra: '超快',
  })[scanRate] ?? '均衡';
}

function asyncNotFoundActionLabel(action) {
  return ({
    keep_last: '保留上一次结果',
    mark_missing: '立即标记为未找到',
  })[action] ?? '保留上一次结果';
}

function asyncMatchModeLabel(mode) {
  return ({
    loose: '宽松',
    normal: '标准',
    strict: '严格',
    custom: '自定义',
  })[mode] ?? '标准';
}

function renderAsyncMonitorEditorCard() {
  const editor = normalizeAsyncMonitor(state.asyncVision.editor);
  const showFixedRegion = editor.search_scope === 'fixed_region';
  const showFollowConfig = editor.search_scope === 'follow_last';
  const showCustomConfidence = editor.match_mode === 'custom';
  const saveLabel = editor.monitor_id ? '更新识别' : '保存识别';
  return `
    <article class="workflow-card">
      <div class="workflow-top">
        <div>
          <div class="badge-row">
            <span class="source-badge custom">后台识图</span>
            <span class="category-badge">${escapeHtml(asyncMonitorPresetLabel(editor.preset))}</span>
          </div>
          <h4>${escapeHtml(editor.monitor_id ? `编辑识别：${editor.name || editor.monitor_id}` : '新建后台识图')}</h4>
          <p>在流程外后台持续找图，并把结果存起来，供流程步骤直接读取。</p>
        </div>
        <div class="card-actions">
          ${renderIconButton({ icon: 'plus', label: '新建识别', onClick: 'window.resetAsyncMonitorEditor()' })}
          ${renderIconButton({ icon: 'success', label: saveLabel, variant: 'primary', onClick: 'window.saveAsyncMonitor()' })}
        </div>
      </div>
      <div class="action-group">
        <span class="action-chip">${escapeHtml(asyncSearchScopeLabel(editor.search_scope))}</span>
        <span class="action-chip">${escapeHtml(asyncScanRateLabel(editor.scan_rate))}</span>
        <span class="action-chip">${escapeHtml(asyncNotFoundActionLabel(editor.not_found_action))}</span>
      </div>
      <div class="setting-grid">
        <div class="field-wide-span subsection-head">
          <div>
            <strong>基础设置</strong>
            <p>先选使用场景，再填写模板图和结果名称。</p>
          </div>
        </div>
        ${fieldItem('使用场景', `<select class="control-input" onchange="window.updateAsyncMonitorField('preset', this.value)">
          ${Object.entries(ASYNC_MONITOR_PRESETS).map(([key, item]) => `<option value="${key}" ${key === editor.preset ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
        </select>`, '系统会按场景带出推荐设置。')}
        ${fieldItem('识别名称', `<input class="control-input" id="async-monitor-name" value="${escapeHtml(editor.name)}" placeholder="例如 开始按钮 / 对话框确认 / Boss图标" oninput="window.updateAsyncMonitorField('name', this.value)" />`)}
        ${fieldItem('结果名称', `<input class="control-input" id="async-monitor-output-variable" value="${escapeHtml(editor.output_variable)}" placeholder="target" oninput="window.updateAsyncMonitorField('output_variable', this.value)" />`, '流程中的点击和分支步骤可以直接读取这个结果。')}
        ${fieldItem('模板图片', `<div class="template-upload-row">
          <input class="control-input" id="async-monitor-template-path" value="${escapeHtml(editor.template_path)}" placeholder="assets/templates/target_demo.png" oninput="window.updateAsyncMonitorField('template_path', this.value)" />
          <button class="ghost-button small-button" type="button" onclick="window.uploadTemplateForAsyncMonitor()">上传模板</button>
        </div>`, '支持直接填写路径，或上传图片保存到 assets/templates。', true)}
        <div class="field-wide-span subsection-head">
          <div>
            <strong>查找方式</strong>
            <p>尽量用“固定区域”或“附近查找”，会比全屏更省资源。</p>
          </div>
        </div>
        ${fieldItem('在哪里找', `<select class="control-input" onchange="window.updateAsyncMonitorField('search_scope', this.value)">
          <option value="full_screen" ${editor.search_scope === 'full_screen' ? 'selected' : ''}>全屏查找</option>
          <option value="fixed_region" ${editor.search_scope === 'fixed_region' ? 'selected' : ''}>固定区域查找</option>
          <option value="follow_last" ${editor.search_scope === 'follow_last' ? 'selected' : ''}>先全屏找到，之后优先在附近找</option>
        </select>`)}
        ${fieldItem('识别速度', `<select class="control-input" onchange="window.updateAsyncMonitorField('scan_rate', this.value)">
          <option value="low" ${editor.scan_rate === 'low' ? 'selected' : ''}>省资源</option>
          <option value="normal" ${editor.scan_rate === 'normal' ? 'selected' : ''}>均衡</option>
          <option value="high" ${editor.scan_rate === 'high' ? 'selected' : ''}>高速</option>
          <option value="ultra" ${editor.scan_rate === 'ultra' ? 'selected' : ''}>超快（30ms/次）</option>
        </select>`, '越快越及时，但会更占用资源。')}
        ${fieldItem('没找到时怎么办', `<select class="control-input" onchange="window.updateAsyncMonitorField('not_found_action', this.value)">
          <option value="keep_last" ${editor.not_found_action === 'keep_last' ? 'selected' : ''}>保留上一次结果</option>
          <option value="mark_missing" ${editor.not_found_action === 'mark_missing' ? 'selected' : ''}>立即标记为未找到</option>
        </select>`)}
        ${fieldItem('匹配要求', `<select class="control-input" onchange="window.updateAsyncMonitorField('match_mode', this.value)">
          <option value="loose" ${editor.match_mode === 'loose' ? 'selected' : ''}>宽松</option>
          <option value="normal" ${editor.match_mode === 'normal' ? 'selected' : ''}>标准</option>
          <option value="strict" ${editor.match_mode === 'strict' ? 'selected' : ''}>严格</option>
          <option value="custom" ${editor.match_mode === 'custom' ? 'selected' : ''}>自定义</option>
        </select>`)}
        ${showCustomConfidence ? fieldItem('自定义匹配分数', `<input class="control-input" type="number" min="0.55" max="0.99" step="0.01" value="${escapeHtml(editor.custom_confidence)}" oninput="window.updateAsyncMonitorField('custom_confidence', this.value, 'float')" />`, '分数越高越严格。') : ''}
        ${showFixedRegion ? fieldItem('区域左上 X', `<input class="control-input" type="number" min="0" step="1" value="${escapeHtml(editor.fixed_region.left)}" oninput="window.updateAsyncMonitorRegionField('left', this.value)" />`) : ''}
        ${showFixedRegion ? fieldItem('区域左上 Y', `<input class="control-input" type="number" min="0" step="1" value="${escapeHtml(editor.fixed_region.top)}" oninput="window.updateAsyncMonitorRegionField('top', this.value)" />`) : ''}
        ${showFixedRegion ? fieldItem('区域宽度', `<input class="control-input" type="number" min="0" step="1" value="${escapeHtml(editor.fixed_region.width)}" oninput="window.updateAsyncMonitorRegionField('width', this.value)" />`) : ''}
        ${showFixedRegion ? fieldItem('区域高度', `<input class="control-input" type="number" min="0" step="1" value="${escapeHtml(editor.fixed_region.height)}" oninput="window.updateAsyncMonitorRegionField('height', this.value)" />`, '先填一个大概区域，后续可再细调。') : ''}
        ${showFollowConfig ? fieldItem('附近查找范围', `<input class="control-input" type="number" min="60" max="4000" step="10" value="${escapeHtml(editor.follow_radius)}" oninput="window.updateAsyncMonitorField('follow_radius', this.value, 'int')" />`, '以上次找到的位置为中心，按这个范围继续找。') : ''}
        ${showFollowConfig ? fieldItem('连续几次没找到后，扩大查找范围', `<input class="control-input" type="number" min="1" max="30" step="1" value="${escapeHtml(editor.recover_after_misses)}" oninput="window.updateAsyncMonitorField('recover_after_misses', this.value, 'int')" />`) : ''}
        <div class="field-wide-span subsection-head">
          <div>
            <strong>高级设置</strong>
            <p>只在需要细调时修改，普通场景保持默认即可。</p>
          </div>
        </div>
        ${fieldItem('结果多久没更新算过期(毫秒)', `<input class="control-input" type="number" min="100" max="600000" step="100" value="${escapeHtml(editor.stale_after_ms)}" oninput="window.updateAsyncMonitorField('stale_after_ms', this.value, 'int')" />`)}
        <label class="toggle toggle-card mini-toggle">
          <input id="async-monitor-enabled" type="checkbox" ${editor.enabled ? 'checked' : ''} onchange="window.updateAsyncMonitorCheckbox('enabled', this.checked)" />
          启用识别
        </label>
      </div>
    </article>
  `;
}

function sortWorkflows(workflows) {
  const sorted = [...workflows];
  const sortKey = state.flowSort;
  sorted.sort((a, b) => {
    if (sortKey === 'hotkey') {
      return String(a.binding?.hotkey ?? '').localeCompare(String(b.binding?.hotkey ?? ''));
    }
    if (sortKey === 'steps') {
      return getWorkflowSteps(b).length - getWorkflowSteps(a).length;
    }
    if (sortKey === 'mode') {
      return runModeLabel(a.run_mode).localeCompare(runModeLabel(b.run_mode), 'zh-CN');
    }
    return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-CN');
  });
  return sorted;
}

function renderWorkflowRow(workflow) {
  const runtime = getWorkflowRuntime(workflow.workflow_id);
  const steps = getWorkflowSteps(workflow);
  const hotkey = workflow.binding?.hotkey || '--';
  const mode = runModeLabel(workflow.run_mode);
  const editBtn = workflow.definition_editable
    ? `<button class="ghost-button small-button" type="button" onclick="window.loadWorkflowIntoDesigner('${workflow.workflow_id}')">编辑</button>`
    : '';
  return `
    <div class="workflow-row">
      <span class="wf-row-name" title="${escapeHtml(workflow.description ?? '')}">${escapeHtml(workflow.name)}</span>
      <span class="wf-row-hotkey"><kbd>${escapeHtml(hotkey)}</kbd></span>
      <span class="wf-row-mode">${escapeHtml(mode)}</span>
      <span class="wf-row-steps">${steps.length} 步</span>
      <span class="runtime-badge ${escapeHtml(runtime.status ?? 'idle')}">${escapeHtml(runtime.status_label ?? '待机')}</span>
      <span class="wf-row-actions">
        ${editBtn}
        <button class="ghost-button small-button" type="button" onclick="window.runWorkflow('${workflow.workflow_id}')">执行</button>
        <button class="ghost-button small-button" type="button" onclick="window.saveWorkflow('${workflow.workflow_id}')">保存</button>
      </span>
    </div>
  `;
}

function renderGroupedWorkflows(workflows, renderFn, containerClass) {
  const groups = {};
  for (const wf of workflows) {
    const cat = wf.category || '未分类';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(wf);
  }
  return Object.entries(groups).map(([cat, items]) => `
    <section class="flow-group">
      <h5 class="flow-group-title">${escapeHtml(cat)}<span class="flow-group-count">${items.length}</span></h5>
      <div class="${containerClass}">${items.map(renderFn).join('')}</div>
    </section>
  `).join('');
}

function renderFlowWorkspace() {
  const workflows = sortWorkflows(getVisibleWorkflows());
  const filters = [
    { key: 'all', label: '全部流程' },
    { key: 'editable', label: '可编辑流程' },
    { key: 'loop', label: '循环流程' },
    { key: 'vision', label: '识图流程' },
  ];
  const sorts = [
    { key: 'name', label: '按名称' },
    { key: 'hotkey', label: '按热键' },
    { key: 'steps', label: '按步骤数' },
    { key: 'mode', label: '按模式' },
  ];

  const isListView = state.flowViewMode === 'list';
  const isGrouped = state.flowGroupBy === 'category';
  const clearBtn = state.flowQuery
    ? `<button class="ghost-button small-button search-clear-btn" type="button" onclick="window.updateFlowSearch('')">\u00d7</button>`
    : '';

  let workflowContent;
  if (!workflows.length) {
    workflowContent = '<div class="empty-state">没有匹配到流程，试试切换筛选或新建一个流程。</div>';
  } else if (isGrouped) {
    workflowContent = isListView
      ? renderGroupedWorkflows(workflows, renderWorkflowRow, 'workflow-list-view')
      : renderGroupedWorkflows(workflows, renderWorkflowCard, 'workflow-grid workflow-grid-page');
  } else {
    workflowContent = isListView
      ? `<div class="workflow-list-view">${workflows.map(renderWorkflowRow).join('')}</div>`
      : `<div class="workflow-grid workflow-grid-page">${workflows.map(renderWorkflowCard).join('')}</div>`;
  }

  return `
    <div class="workspace-stack">
      <article class="workflow-card workspace-panel">
        <div class="panel-head compact">
          <div>
            <h4>流程列表</h4>
          </div>
          <span class="source-badge custom">显示 ${escapeHtml(workflows.length)} / ${escapeHtml(state.workflows.length)}</span>
        </div>
        <div class="workspace-toolbar">
          <div class="search-wrap">
            <input
              class="control-input"
              value="${escapeHtml(state.flowQuery)}"
              placeholder="搜索流程名、热键、说明或分类"
              oninput="window.updateFlowSearch(this.value)"
            />
            ${clearBtn}
          </div>
          <select class="control-input compact-input" onchange="window.updateFlowFilter(this.value)">
            ${filters.map((item) => `<option value="${item.key}" ${item.key === state.flowFilter ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
          <select class="control-input compact-input" onchange="window.updateFlowSort(this.value)">
            ${sorts.map((item) => `<option value="${item.key}" ${item.key === state.flowSort ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
          <button class="ghost-button small-button${isGrouped ? ' active-toggle' : ''}" type="button" onclick="window.toggleFlowGroupBy()">分组</button>
          <button class="ghost-button small-button" type="button" onclick="window.toggleFlowViewMode()">${isListView ? '卡片' : '列表'}</button>
          <button class="primary-button" type="button" onclick="window.resetDesigner(false)">新建流程</button>
        </div>
      </article>
      ${workflowContent}
    </div>
  `;
}
