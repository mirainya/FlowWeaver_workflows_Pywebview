function renderSummary() {
  document.getElementById('workflow-count').textContent = state.summary.workflow_count ?? 0;
  document.getElementById('enabled-count').textContent = state.summary.enabled_count ?? 0;
  document.getElementById('visual-count').textContent = state.summary.visual_count ?? 0;
  document.getElementById('loop-count').textContent = state.summary.loop_count ?? 0;
  document.getElementById('active-loop-count').textContent = state.summary.active_loop_count ?? 0;
}

function renderArchitecture() {
  const container = document.getElementById('architecture-list');
  if (!container) {
    return;
  }
  if (!state.architecture.length) {
    container.innerHTML = '<div class="empty-state">暂无设计说明。</div>';
    return;
  }

  container.innerHTML = state.architecture.map((item) => `
    <article class="architecture-item">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.description)}</p>
    </article>
  `).join('');
}

function renderHero() {
  const activeTab = getActiveTabMeta();
  const source = document.getElementById('workflow-source');
  const version = document.getElementById('app-version');
  const title = document.getElementById('workspace-title');
  const subtitle = document.getElementById('workspace-subtitle');
  if (source) {
    source.textContent = state.app.workflow_source ?? '--';
  }
  if (version) {
    version.textContent = state.app.version ?? '--';
  }
  if (title) {
    title.textContent = activeTab?.label ?? '流程';
  }
  if (subtitle) {
    subtitle.textContent = activeTab?.description ?? '查看、编辑和运行自动化流程。';
  }
}

function renderTabs() {
  const tabStrip = document.getElementById('tab-strip');
  const tabMeta = document.getElementById('tab-meta');
  if (!tabStrip || !tabMeta) {
    return;
  }

  tabStrip.innerHTML = APP_TABS.map((tab) => {
    const count = typeof tab.count === 'function' ? tab.count() : null;
    return `
    <button
      class="tab-button ${tab.key === state.activeTab ? 'active' : ''}"
      type="button"
      onclick="window.setActiveTab('${tab.key}')"
    >
      <span>${escapeHtml(tab.label)}</span>
      ${count === null || count === undefined ? '' : `<strong>${escapeHtml(count)}</strong>`}
    </button>
  `;
  }).join('');

  const activeTab = getActiveTabMeta();
  if (!activeTab) {
    tabMeta.innerHTML = '';
    return;
  }

  tabMeta.innerHTML = `
    <span>${escapeHtml(activeTab.description ?? '')}</span>
    <span>${({
      flows: '在这里查看流程列表、搜索过滤，并进入流程编辑。',
      editor: '流程编辑器独立显示，保存状态会直接反馈在页头。',
      async_vision: '当前页支持新建、编辑、删除后台识图，并查看共享数据。',
      settings: '主题切换会立即生效，并保存在当前电脑。',
      about: '说明信息统一收纳到这里，主界面保持简洁。',
    })[activeTab.key] ?? ''}</span>
  `;
}

function renderDesigner() {
  const panel = document.getElementById('flow-designer-panel');
  if (!panel) {
    return;
  }

  const hasDesigner = state.designer && (state.designer.workflow_id || state.designer.name || state.designer.steps?.length > 0);
  const visible = state.activeTab === 'flows' && hasDesigner;
  panel.hidden = !visible;
  if (!visible) {
    return;
  }

  document.getElementById('designer-title').textContent = state.designer.workflow_id
    ? `编辑流程 · ${state.designer.name || state.designer.workflow_id}`
    : '新建流程';
  const subtitle = document.getElementById('designer-subtitle');
  if (subtitle) {
    subtitle.textContent = state.designer.workflow_id
      ? '修改当前流程的热键、运行模式和步骤。'
      : '从空白模板开始创建一个新流程。';
  }
  document.getElementById('designer-name').value = state.designer.name ?? '';
  const designerHotkeyInput = document.getElementById('designer-hotkey');
  designerHotkeyInput.value = state.designer.hotkey ?? '';
  designerHotkeyInput.readOnly = true;
  designerHotkeyInput.autocomplete = 'off';
  designerHotkeyInput.spellcheck = false;
  designerHotkeyInput.classList.add('capture-input');
  designerHotkeyInput.dataset.keyCapture = 'true';
  designerHotkeyInput.dataset.captureTarget = 'designer-hotkey';
  designerHotkeyInput.placeholder = '点击后直接录入触发热键';
  designerHotkeyInput.title = '点击输入框后直接按键录入，按 Backspace 或 Delete 清空';
  document.getElementById('designer-description').value = state.designer.description ?? '';
  document.getElementById('designer-enabled').checked = Boolean(state.designer.enabled);
  document.getElementById('designer-run-mode').value = normalizeRunMode(state.designer.run_mode).type;

  const repeatWrap = document.getElementById('designer-repeat-wrap');
  const repeatCount = document.getElementById('designer-repeat-count');
  const normalizedRunMode = normalizeRunMode(state.designer.run_mode);
  const showRepeat = normalizedRunMode.type === 'repeat_n';
  repeatWrap.hidden = !showRepeat;
  repeatCount.value = normalizedRunMode.count ?? 1;

  renderDesignerSaveStatus();
  renderDesignerSteps();

  const grid = document.querySelector('#flow-designer-panel .designer-grid');
  const toolbar = document.querySelector('#flow-designer-panel .step-toolbar');
  const stepRoot = document.getElementById('designer-step-list');
  const indexMap = document.getElementById('designer-step-index');
  const collapseBtn = document.getElementById('designer-collapse');
  const collapsed = state.designerCollapsed;
  if (grid) grid.hidden = collapsed;
  if (toolbar) toolbar.hidden = collapsed;
  if (stepRoot) stepRoot.hidden = collapsed;
  if (indexMap && collapsed) indexMap.hidden = true;
  if (collapseBtn) collapseBtn.textContent = collapsed ? '展开' : '收起';
}

function fieldItem(label, control, hint = '', wide = false) {
  return `
    <label class="field-item ${wide ? 'field-wide' : ''}">
      <span>${escapeHtml(label)}</span>
      ${control}
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </label>
  `;
}

function stepKindOptions(currentKind) {
  return STEP_TYPE_GROUPS.map((group) => `
    <optgroup label="${escapeHtml(group.group)}">
      ${group.items.map((item) => `
        <option value="${item.key}" ${item.key === currentKind ? 'selected' : ''}>${escapeHtml(item.label)}</option>
      `).join('')}
    </optgroup>
  `).join('');
}

function renderSequenceEditor(step, stepPath) {
  const items = Array.isArray(step.sequence) ? step.sequence : [];
  return `
    <div class="field-wide sequence-editor">
      <div class="subsection-head">
        <strong>序列步骤</strong>
        ${renderIconButton({ icon: 'plus', label: '添加序列项', extraClass: 'small-button', onClick: `window.addSequenceItem('${stepPath}')` })}
      </div>
      ${items.length ? items.map((item, index) => `
        <div class="sequence-row">
          ${renderKeyCaptureInput({
            value: item.keys,
            placeholder: '点击后录入序列按键',
            captureTarget: 'sequence-field',
            capturePath: stepPath,
            captureField: 'keys',
            captureIndex: index,
          })}
          <input
            class="control-input"
            type="number"
            min="0"
            max="600000"
            step="10"
            value="${escapeHtml(item.delay_ms)}"
            oninput="window.updateSequenceItem('${stepPath}', ${index}, 'delay_ms', this.value, 'int')"
          />
          <div class="inline-actions">
            ${renderIconButton({ icon: 'arrow-up', label: '上移序列项', extraClass: 'small-button', onClick: `window.moveSequenceItem('${stepPath}', ${index}, -1)` })}
            ${renderIconButton({ icon: 'arrow-down', label: '下移序列项', extraClass: 'small-button', onClick: `window.moveSequenceItem('${stepPath}', ${index}, 1)` })}
            ${renderIconButton({ icon: 'delete-o', label: '删除序列项', extraClass: 'small-button danger-button', onClick: `window.removeSequenceItem('${stepPath}', ${index})` })}
          </div>
        </div>
      `).join('') : '<div class="empty-state compact">暂无序列项。</div>'}
    </div>
  `;
}


function renderBranchPane(steps, listPath, title, description, branchType = '') {
  const typeClass = branchType ? ` branch-${branchType}` : '';
  return `
    <section class="branch-pane${typeClass}">
      <div class="subsection-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(description)}</p>
        </div>
        ${renderIconButton({ icon: 'plus', label: '添加分支步骤', extraClass: 'small-button', onClick: `window.addDesignerStep('${listPath}')` })}
      </div>
      <div class="step-list nested-list">
        ${steps.length ? steps.map((branchStep, index) => renderStepCard(branchStep, `${listPath}.${index}`, index + 1, true)).join('') : '<div class="empty-state compact">当前分支暂无步骤。</div>'}
      </div>
    </section>
  `;
}

function sanitizeDomToken(value) {
  return String(value ?? '')
    .trim()
    .replaceAll(/[^0-9a-zA-Z_-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '') || 'value';
}

function collectLocalVariableNames(steps, names = new Set()) {
  const items = Array.isArray(steps) ? steps : [];
  for (const step of items) {
    if (!step || typeof step !== 'object') {
      continue;
    }
    if (step.kind === 'detect_image') {
      const variableName = String(step.save_as ?? '').trim();
      if (variableName) {
        names.add(variableName);
      }
    }
    if (step.kind === 'if_var_found') {
      collectLocalVariableNames(step.then_steps, names);
      collectLocalVariableNames(step.else_steps, names);
    }
    if (step.kind === 'key_hold') {
      collectLocalVariableNames(step.steps, names);
    }
  }
  return names;
}

function getLocalVariableSuggestions() {
  return Array.from(collectLocalVariableNames(state.designer.steps))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function getSharedVariableSuggestions() {
  const names = new Set();
  for (const item of state.asyncVision.sharedVariables ?? []) {
    const variableName = String(item?.output_variable ?? item?.variable_name ?? '').trim();
    if (variableName) {
      names.add(variableName);
    }
  }
  for (const monitor of state.asyncVision.monitors ?? []) {
    const variableName = String(monitor?.output_variable ?? monitor?.variable_name ?? '').trim();
    if (variableName) {
      names.add(variableName);
    }
  }
  return Array.from(names)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function renderVariableSuggestInput({ stepPath, field, value, placeholder, scope = 'local' }) {
  const listId = `var-suggest-${sanitizeDomToken(stepPath)}-${sanitizeDomToken(field)}-${sanitizeDomToken(scope)}`;
  const suggestions = scope === 'shared' ? getSharedVariableSuggestions() : getLocalVariableSuggestions();
  return `
    <input class="control-input" list="${listId}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" oninput="window.updateStepField('${stepPath}', '${field}', this.value)" />
    <datalist id="${listId}">
      ${suggestions.map((item) => `<option value="${escapeHtml(item)}"></option>`).join('')}
    </datalist>
  `;
}


function renderStepFields(step, stepPath) {
  if (step.kind === 'delay') {
    return [
      fieldItem(
        '等待时间(毫秒)',
        `<input class="control-input" type="number" min="0" max="600000" step="10" value="${escapeHtml(step.milliseconds)}" oninput="window.updateStepField('${stepPath}', 'milliseconds', this.value, 'int')" />`,
        '固定等待。如果填了随机范围，这个值会被忽略。'
      ),
      fieldItem(
        '随机最短(毫秒)',
        `<input class="control-input" type="number" min="0" max="600000" step="10" value="${escapeHtml(step.random_min)}" oninput="window.updateStepField('${stepPath}', 'random_min', this.value, 'int')" />`,
        '随机等待的最短时间，两项都填且最长>最短时生效。'
      ),
      fieldItem(
        '随机最长(毫秒)',
        `<input class="control-input" type="number" min="0" max="600000" step="10" value="${escapeHtml(step.random_max)}" oninput="window.updateStepField('${stepPath}', 'random_max', this.value, 'int')" />`,
        '随机等待的最长时间。'
      ),
    ].join('');
  }

  if (step.kind === 'key_sequence') {
    return renderSequenceEditor(step, stepPath);
  }

  if (step.kind === 'detect_image') {
    const testId = `match-test-${sanitizeDomToken(stepPath)}`;
    return [
      fieldItem(
        '模板图路径',
        `<div class="template-upload-row">
          <input class="control-input" value="${escapeHtml(step.template_path)}" placeholder="例如 assets/templates/target_demo.png" oninput="window.updateStepField('${stepPath}', 'template_path', this.value)" />
          <button class="ghost-button small-button" type="button" onclick="window.uploadTemplateForStep('${stepPath}')">上传模板</button>
          <button class="ghost-button small-button" type="button" onclick="window.captureTemplateForStep('${stepPath}')">屏幕截取</button>
        </div>
        ${step.template_path ? `<div class="template-thumb-wrap" id="thumb-${sanitizeDomToken(stepPath)}"><img class="template-thumb" data-template-path="${escapeHtml(step.template_path)}" alt="模板预览" /></div>` : ''}`,
        '支持手动填写路径，或直接上传图片后自动保存到 assets/templates。',
        true,
      ),
      fieldItem(
        '结果名称',
        `<input class="control-input" value="${escapeHtml(step.save_as)}" placeholder="target" oninput="window.updateStepField('${stepPath}', 'save_as', this.value)" />`,
        '找到的坐标会存到这个名称里，后面的步骤可以用它。'
      ),
      fieldItem(
        '匹配精度',
        `<input class="control-input" type="number" min="0.55" max="0.99" step="0.01" value="${escapeHtml(step.confidence)}" oninput="window.updateStepField('${stepPath}', 'confidence', this.value, 'float')" />`
      ),
      fieldItem(
        '超时(毫秒)',
        `<input class="control-input" type="number" min="100" max="600000" step="100" value="${escapeHtml(step.timeout_ms)}" oninput="window.updateStepField('${stepPath}', 'timeout_ms', this.value, 'int')" />`
      ),
      fieldItem(
        '扫描间隔',
        `<input class="control-input" type="number" min="1" max="64" step="1" value="${escapeHtml(step.search_step)}" oninput="window.updateStepField('${stepPath}', 'search_step', this.value, 'int')" />`
      ),
      `<div class="field-wide-span match-test-section">
        <button class="ghost-button small-button" type="button" onclick="window.testTemplateMatch('${stepPath}', '${testId}')">测试匹配</button>
        <div id="${testId}" class="match-test-result"></div>
      </div>`,
    ].join('');
  }

  if (step.kind === 'click_point') {
    const isCurrent = step.source === 'current';

    const sourceControl = fieldItem(
      '点哪里',
      `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'source', this.value)">
        <option value="var" ${step.source === 'var' ? 'selected' : ''}>来自找图结果</option>
        <option value="shared" ${step.source === 'shared' ? 'selected' : ''}>来自后台识图</option>
        <option value="absolute" ${step.source === 'absolute' ? 'selected' : ''}>固定坐标</option>
        <option value="current" ${step.source === 'current' ? 'selected' : ''}>当前鼠标位置</option>
      </select>`,
      '建议优先和找图结果结合。'
    );

    const targetControl = isCurrent
      ? ''
      : step.source === 'absolute'
        ? [
            fieldItem(
              'X 坐标',
              `<input class="control-input" type="number" step="1" value="${escapeHtml(step.x)}" oninput="window.updateStepField('${stepPath}', 'x', this.value, 'int')" />`
            ),
            fieldItem(
              'Y 坐标',
              `<input class="control-input" type="number" step="1" value="${escapeHtml(step.y)}" oninput="window.updateStepField('${stepPath}', 'y', this.value, 'int')" />`
            ),
          ].join('')
        : fieldItem(
            '名称',
            renderVariableSuggestInput({
              stepPath,
              field: 'var_name',
              value: step.var_name,
              placeholder: 'target',
              scope: step.source === 'shared' ? 'shared' : 'local',
            }),
            step.source === 'shared' ? '可搜索后台识图结果，也可手动输入。' : '可搜索流程内找图结果，也可手动输入。'
          );

    const modifiers = Array.isArray(step.modifiers) ? step.modifiers : [];
    const modifierControl = `
      <label class="field-item field-wide-span">
        <span>修饰键</span>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <label class="toggle mini-toggle">
            <input type="checkbox" ${modifiers.includes('ctrl') ? 'checked' : ''} onchange="window.toggleStepModifier('${stepPath}', 'ctrl', this.checked)" />
            Ctrl
          </label>
          <label class="toggle mini-toggle">
            <input type="checkbox" ${modifiers.includes('shift') ? 'checked' : ''} onchange="window.toggleStepModifier('${stepPath}', 'shift', this.checked)" />
            Shift
          </label>
          <label class="toggle mini-toggle">
            <input type="checkbox" ${modifiers.includes('alt') ? 'checked' : ''} onchange="window.toggleStepModifier('${stepPath}', 'alt', this.checked)" />
            Alt
          </label>
        </div>
        <small>按住修饰键后再点击鼠标。</small>
      </label>
    `;

    const modifierDelayControl = fieldItem(
      '修饰键延迟(毫秒)',
      `<input class="control-input" type="number" min="0" max="5000" step="10"
              value="${escapeHtml(step.modifier_delay_ms)}"
              oninput="window.updateStepField('${stepPath}', 'modifier_delay_ms', this.value, 'int')" />`,
      '按下修饰键后等待多久再点击鼠标。'
    );

    const extraControls = isCurrent
      ? ''
      : [
          fieldItem(
            'X 偏移',
            `<input class="control-input" type="number" step="1" value="${escapeHtml(step.offset_x)}" oninput="window.updateStepField('${stepPath}', 'offset_x', this.value, 'int')" />`
          ),
          fieldItem(
            'Y 偏移',
            `<input class="control-input" type="number" step="1" value="${escapeHtml(step.offset_y)}" oninput="window.updateStepField('${stepPath}', 'offset_y', this.value, 'int')" />`
          ),
          fieldItem(
            '点击后停顿(毫秒)',
            `<input class="control-input" type="number" min="0" max="600000" step="10" value="${escapeHtml(step.settle_ms)}" oninput="window.updateStepField('${stepPath}', 'settle_ms', this.value, 'int')" />`
          ),
          `
            <label class="toggle toggle-card mini-toggle">
              <input type="checkbox" ${step.return_cursor ? 'checked' : ''} onchange="window.updateStepCheckbox('${stepPath}', 'return_cursor', this.checked)" />
              点击后鼠标回位
            </label>
          `,
        ].join('');

    return [
      sourceControl,
      targetControl,
      fieldItem(
        '鼠标按键',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'button', this.value)">
          <option value="left" ${step.button !== 'right' ? 'selected' : ''}>左键</option>
          <option value="right" ${step.button === 'right' ? 'selected' : ''}>右键</option>
        </select>`
      ),
      fieldItem(
        '点击次数',
        `<input class="control-input" type="number" min="1" max="5" step="1" value="${escapeHtml(step.click_count)}" oninput="window.updateStepField('${stepPath}', 'click_count', this.value, 'int')" />`,
        '1=单击，2=双击。'
      ),
      modifierControl,
      modifierDelayControl,
      extraControls,
    ].join('');
  }

  if (step.kind === 'if_var_found') {
    const thenSteps = Array.isArray(step.then_steps) ? step.then_steps : [];
    const elseSteps = Array.isArray(step.else_steps) ? step.else_steps : [];
    return [
      fieldItem(
        '数据来源',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'variable_scope', this.value)">
          <option value="local" ${step.variable_scope !== 'shared' ? 'selected' : ''}>流程内找图结果</option>
          <option value="shared" ${step.variable_scope === 'shared' ? 'selected' : ''}>后台识图结果</option>
        </select>`,
        '后台识图的结果是共享的；流程里"截图找图"的结果是本地的。',
      ),
      fieldItem(
        '要判断的名称',
        renderVariableSuggestInput({
          stepPath,
          field: 'var_name',
          value: step.var_name,
          placeholder: 'target',
          scope: step.variable_scope === 'shared' ? 'shared' : 'local',
        }),
        step.variable_scope === 'shared' ? '可搜索后台识图结果，也可手动输入。' : '可搜索流程内找图结果，也可手动输入。',
        true,
      ),
      `
        <div class="branch-grid field-wide-span">
          ${renderBranchPane(thenSteps, `${stepPath}.then_steps`, '找到了', '图片匹配成功时执行', 'hit')}
          ${renderBranchPane(elseSteps, `${stepPath}.else_steps`, '没找到', '图片匹配失败时执行', 'miss')}
        </div>
      `,
    ].join('');
  }

  if (step.kind === 'set_variable_state') {
    return [
      fieldItem(
        '数据来源',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'variable_scope', this.value)">
          <option value="local" ${step.variable_scope !== 'shared' ? 'selected' : ''}>流程内找图结果</option>
          <option value="shared" ${step.variable_scope === 'shared' ? 'selected' : ''}>后台识图结果</option>
        </select>`,
        '可把找图结果直接改成"找到了"或"没找到"。',
      ),
      fieldItem(
        '名称',
        renderVariableSuggestInput({
          stepPath,
          field: 'var_name',
          value: step.var_name,
          placeholder: 'target',
          scope: step.variable_scope === 'shared' ? 'shared' : 'local',
        }),
        step.variable_scope === 'shared' ? '可搜索后台识图结果，也可手动输入。' : '可搜索流程内找图结果，也可手动输入。',
      ),
      fieldItem(
        '改成什么',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'state', this.value)">
          <option value="found" ${step.state === 'found' ? 'selected' : ''}>找到了</option>
          <option value="missing" ${step.state !== 'found' ? 'selected' : ''}>没找到</option>
        </select>`,
        '比如在"找到了"分支执行完后，手动把状态改回"没找到"。',
      ),
    ].join('');
  }

  if (step.kind === 'key_hold') {
    const holdSteps = Array.isArray(step.steps) ? step.steps : [];
    return [
      fieldItem(
        '按住按键',
        `${renderKeyCaptureInput({
          value: step.key,
          placeholder: '点击后录入要按住的按键',
          captureTarget: 'step-field',
          capturePath: stepPath,
          captureField: 'key',
        })}`,
        '按住该键期间执行下方的步骤，或按住指定时长后松开。'
      ),
      fieldItem(
        '定时长按(毫秒)',
        `<input class="control-input" type="number" min="0" max="600000" step="50" value="${escapeHtml(step.duration_ms)}" oninput="window.updateStepField('${stepPath}', 'duration_ms', this.value, 'int')" />`,
        '大于0时忽略下方步骤，按住N毫秒后自动松开。设为0则执行下方步骤。'
      ),
      `
        <div class="field-wide-span">
          ${renderBranchPane(holdSteps, `${stepPath}.steps`, '按住期间执行的步骤', '按键按住期间依次执行以下步骤（定时长按>0时忽略）')}
        </div>
      `,
    ].join('');
  }

  if (step.kind === 'mouse_scroll') {
    return [
      fieldItem(
        '滚动方向',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'direction', this.value)">
          <option value="down" ${step.direction === 'down' ? 'selected' : ''}>向下</option>
          <option value="up" ${step.direction === 'up' ? 'selected' : ''}>向上</option>
          <option value="left" ${step.direction === 'left' ? 'selected' : ''}>向左</option>
          <option value="right" ${step.direction === 'right' ? 'selected' : ''}>向右</option>
        </select>`
      ),
      fieldItem(
        '滚动格数',
        `<input class="control-input" type="number" min="1" max="100" step="1" value="${escapeHtml(step.clicks)}" oninput="window.updateStepField('${stepPath}', 'clicks', this.value, 'int')" />`,
        '每格约等于鼠标滚轮一格（120单位）。'
      ),
    ].join('');
  }

  if (step.kind === 'mouse_hold') {
    const isAbsolute = step.source === 'absolute';
    const isCurrent = step.source === 'current';
    return [
      fieldItem(
        '鼠标按键',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'button', this.value)">
          <option value="left" ${step.button === 'left' ? 'selected' : ''}>左键</option>
          <option value="right" ${step.button === 'right' ? 'selected' : ''}>右键</option>
          <option value="middle" ${step.button === 'middle' ? 'selected' : ''}>中键</option>
        </select>`
      ),
      fieldItem(
        '长按时长(毫秒)',
        `<input class="control-input" type="number" min="0" max="600000" step="50" value="${escapeHtml(step.duration_ms)}" oninput="window.updateStepField('${stepPath}', 'duration_ms', this.value, 'int')" />`,
        '按住鼠标按键的持续时间。'
      ),
      fieldItem(
        '点哪里',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'source', this.value)">
          <option value="current" ${step.source === 'current' ? 'selected' : ''}>当前鼠标位置</option>
          <option value="var" ${step.source === 'var' ? 'selected' : ''}>来自找图结果</option>
          <option value="shared" ${step.source === 'shared' ? 'selected' : ''}>来自后台识图</option>
          <option value="absolute" ${step.source === 'absolute' ? 'selected' : ''}>固定坐标</option>
        </select>`,
        '选择在哪个位置按住鼠标。'
      ),
      isCurrent ? '' : isAbsolute
        ? [
            fieldItem('X 坐标', `<input class="control-input" type="number" step="1" value="${escapeHtml(step.x)}" oninput="window.updateStepField('${stepPath}', 'x', this.value, 'int')" />`),
            fieldItem('Y 坐标', `<input class="control-input" type="number" step="1" value="${escapeHtml(step.y)}" oninput="window.updateStepField('${stepPath}', 'y', this.value, 'int')" />`),
          ].join('')
        : [
            fieldItem(
              '名称',
              renderVariableSuggestInput({
                stepPath,
                field: 'var_name',
                value: step.var_name,
                placeholder: 'target',
                scope: step.source === 'shared' ? 'shared' : 'local',
              })
            ),
            fieldItem('X 偏移', `<input class="control-input" type="number" step="1" value="${escapeHtml(step.offset_x)}" oninput="window.updateStepField('${stepPath}', 'offset_x', this.value, 'int')" />`),
            fieldItem('Y 偏移', `<input class="control-input" type="number" step="1" value="${escapeHtml(step.offset_y)}" oninput="window.updateStepField('${stepPath}', 'offset_y', this.value, 'int')" />`),
          ].join(''),
    ].join('');
  }

  if (step.kind === 'detect_color') {
    const isAbsolute = step.source === 'absolute';
    return [
      fieldItem(
        '点哪里',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'source', this.value)">
          <option value="absolute" ${step.source === 'absolute' ? 'selected' : ''}>固定坐标</option>
          <option value="var" ${step.source === 'var' ? 'selected' : ''}>来自找图结果</option>
          <option value="shared" ${step.source === 'shared' ? 'selected' : ''}>来自后台识图</option>
        </select>`,
        '选择在哪个位置取色。'
      ),
      isAbsolute
        ? [
            fieldItem('X 坐标', `<input class="control-input" type="number" step="1" value="${escapeHtml(step.x)}" oninput="window.updateStepField('${stepPath}', 'x', this.value, 'int')" />`),
            fieldItem('Y 坐标', `<input class="control-input" type="number" step="1" value="${escapeHtml(step.y)}" oninput="window.updateStepField('${stepPath}', 'y', this.value, 'int')" />`),
          ].join('')
        : [
            fieldItem(
              '名称',
              renderVariableSuggestInput({
                stepPath,
                field: 'var_name',
                value: step.var_name,
                placeholder: 'target',
                scope: step.source === 'shared' ? 'shared' : 'local',
              })
            ),
            fieldItem('X 偏移', `<input class="control-input" type="number" step="1" value="${escapeHtml(step.offset_x)}" oninput="window.updateStepField('${stepPath}', 'offset_x', this.value, 'int')" />`),
            fieldItem('Y 偏移', `<input class="control-input" type="number" step="1" value="${escapeHtml(step.offset_y)}" oninput="window.updateStepField('${stepPath}', 'offset_y', this.value, 'int')" />`),
          ].join(''),
      fieldItem(
        '期望色值',
        `<input class="control-input" value="${escapeHtml(step.expected_color)}" placeholder="#FF0000" oninput="window.updateStepField('${stepPath}', 'expected_color', this.value)" />`,
        '十六进制颜色值（如 #FF0000）。留空则只取色不判断。'
      ),
      fieldItem(
        '容差',
        `<input class="control-input" type="number" min="0" max="255" step="1" value="${escapeHtml(step.tolerance)}" oninput="window.updateStepField('${stepPath}', 'tolerance', this.value, 'int')" />`,
        'RGB 各通道允许的偏差值（0=精确匹配）。'
      ),
      fieldItem(
        '结果名称',
        `<input class="control-input" value="${escapeHtml(step.save_as)}" placeholder="color_result" oninput="window.updateStepField('${stepPath}', 'save_as', this.value)" />`,
        '取色结果（含是否匹配、颜色值、RGB分量）存到这个名称里。'
      ),
    ].join('');
  }

  if (step.kind === 'loop') {
    const loopSteps = Array.isArray(step.steps) ? step.steps : [];
    const isCount = step.loop_type === 'count';
    return [
      fieldItem(
        '循环类型',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'loop_type', this.value)">
          <option value="count" ${step.loop_type === 'count' ? 'selected' : ''}>固定次数</option>
          <option value="while_found" ${step.loop_type === 'while_found' ? 'selected' : ''}>找到了就一直循环</option>
          <option value="while_not_found" ${step.loop_type === 'while_not_found' ? 'selected' : ''}>没找到就一直循环</option>
        </select>`
      ),
      fieldItem(
        isCount ? '循环次数' : '最多循环几次',
        `<input class="control-input" type="number" min="1" max="99999" step="1" value="${escapeHtml(step.max_iterations)}" oninput="window.updateStepField('${stepPath}', 'max_iterations', this.value, 'int')" />`,
        isCount ? '重复执行里面步骤的次数。' : '防止死循环的安全上限。'
      ),
      isCount ? '' : [
        fieldItem(
          '数据来源',
          `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'variable_scope', this.value)">
            <option value="local" ${step.variable_scope !== 'shared' ? 'selected' : ''}>流程内找图结果</option>
            <option value="shared" ${step.variable_scope === 'shared' ? 'selected' : ''}>后台识图结果</option>
          </select>`
        ),
        fieldItem(
          '要判断的名称',
          renderVariableSuggestInput({
            stepPath,
            field: 'var_name',
            value: step.var_name,
            placeholder: 'target',
            scope: step.variable_scope === 'shared' ? 'shared' : 'local',
          })
        ),
      ].join(''),
      `
        <div class="field-wide-span">
          ${renderBranchPane(loopSteps, `${stepPath}.steps`, '循环体', '每次循环执行以下步骤')}
        </div>
      `,
    ].join('');
  }

  if (step.kind === 'call_workflow') {
    return [
      fieldItem(
        '流程名称',
        `<input class="control-input" value="${escapeHtml(step.target_workflow_id)}" placeholder="输入要调用的流程ID" oninput="window.updateStepField('${stepPath}', 'target_workflow_id', this.value)" />`,
        '填写目标流程的 ID，执行完后会自动回到当前流程继续。'
      ),
    ].join('');
  }

  if (step.kind === 'if_condition') {
    const thenSteps = Array.isArray(step.then_steps) ? step.then_steps : [];
    const elseSteps = Array.isArray(step.else_steps) ? step.else_steps : [];
    return [
      fieldItem(
        '数据来源',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'variable_scope', this.value)">
          <option value="local" ${step.variable_scope !== 'shared' ? 'selected' : ''}>流程内找图结果</option>
          <option value="shared" ${step.variable_scope === 'shared' ? 'selected' : ''}>后台识图结果</option>
        </select>`
      ),
      fieldItem(
        '名称',
        renderVariableSuggestInput({
          stepPath,
          field: 'var_name',
          value: step.var_name,
          placeholder: 'target',
          scope: step.variable_scope === 'shared' ? 'shared' : 'local',
        })
      ),
      fieldItem(
        '要看哪个字段',
        `<input class="control-input" value="${escapeHtml(step.field)}" placeholder="found" oninput="window.updateStepField('${stepPath}', 'field', this.value)" />`,
        '比如 found（是否找到）、x、y、color 等。'
      ),
      fieldItem(
        '运算符',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'operator', this.value)">
          <option value="==" ${step.operator === '==' ? 'selected' : ''}>==(等于)</option>
          <option value="!=" ${step.operator === '!=' ? 'selected' : ''}>!=(不等于)</option>
          <option value=">" ${step.operator === '>' ? 'selected' : ''}>>(大于)</option>
          <option value=">=" ${step.operator === '>=' ? 'selected' : ''}>=(大于等于)</option>
          <option value="<" ${step.operator === '<' ? 'selected' : ''}><(小于)</option>
          <option value="<=" ${step.operator === '<=' ? 'selected' : ''}<=(小于等于)</option>
        </select>`
      ),
      fieldItem(
        '比较值',
        `<input class="control-input" value="${escapeHtml(step.value)}" placeholder="true" oninput="window.updateStepField('${stepPath}', 'value', this.value)" />`,
        '数值或字符串。true/false 表示是/否。'
      ),
      `<div class="field-wide-span">
        ${renderBranchPane(thenSteps, `${stepPath}.then_steps`, '满足条件时', '条件为真时执行', 'hit')}
      </div>`,
      `<div class="field-wide-span">
        ${renderBranchPane(elseSteps, `${stepPath}.else_steps`, '不满足条件时', '条件为假时执行（可选）', 'miss')}
      </div>`,
    ].join('');
  }

  if (step.kind === 'log') {
    return [
      fieldItem(
        '输出内容',
        `<input class="control-input" value="${escapeHtml(step.message)}" placeholder="支持 {名称.字段} 引用，如 {target.x}" oninput="window.updateStepField('${stepPath}', 'message', this.value)" />`,
        '支持用 {名称.字段} 引用数据，如 {target.x}。'
      ),
      fieldItem(
        '日志级别',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'level', this.value)">
          <option value="info" ${step.level === 'info' ? 'selected' : ''}>信息</option>
          <option value="warn" ${step.level === 'warn' ? 'selected' : ''}>警告</option>
          <option value="success" ${step.level === 'success' ? 'selected' : ''}>成功</option>
        </select>`
      ),
    ].join('');
  }

  if (step.kind === 'mouse_drag') {
    const isAbsolute = step.source === 'absolute';
    const coordFields = isAbsolute ? [
      fieldItem('起点X', `<input class="control-input" type="number" value="${escapeHtml(step.start_x)}" oninput="window.updateStepField('${stepPath}', 'start_x', this.value, 'int')" />`),
      fieldItem('起点Y', `<input class="control-input" type="number" value="${escapeHtml(step.start_y)}" oninput="window.updateStepField('${stepPath}', 'start_y', this.value, 'int')" />`),
      fieldItem('终点X', `<input class="control-input" type="number" value="${escapeHtml(step.end_x)}" oninput="window.updateStepField('${stepPath}', 'end_x', this.value, 'int')" />`),
      fieldItem('终点Y', `<input class="control-input" type="number" value="${escapeHtml(step.end_y)}" oninput="window.updateStepField('${stepPath}', 'end_y', this.value, 'int')" />`),
    ] : [
      fieldItem('名称', renderVariableSuggestInput({ stepPath, field: 'var_name', value: step.var_name, placeholder: 'target', scope: step.source === 'shared' ? 'shared' : 'local' })),
      fieldItem('起点偏移X', `<input class="control-input" type="number" value="${escapeHtml(step.start_offset_x)}" oninput="window.updateStepField('${stepPath}', 'start_offset_x', this.value, 'int')" />`),
      fieldItem('起点偏移Y', `<input class="control-input" type="number" value="${escapeHtml(step.start_offset_y)}" oninput="window.updateStepField('${stepPath}', 'start_offset_y', this.value, 'int')" />`),
      fieldItem('终点偏移X', `<input class="control-input" type="number" value="${escapeHtml(step.end_offset_x)}" oninput="window.updateStepField('${stepPath}', 'end_offset_x', this.value, 'int')" />`),
      fieldItem('终点偏移Y', `<input class="control-input" type="number" value="${escapeHtml(step.end_offset_y)}" oninput="window.updateStepField('${stepPath}', 'end_offset_y', this.value, 'int')" />`),
    ];
    return [
      fieldItem(
        '点哪里',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'source', this.value)">
          <option value="absolute" ${step.source === 'absolute' ? 'selected' : ''}>固定坐标</option>
          <option value="var" ${step.source === 'var' ? 'selected' : ''}>找图结果偏移</option>
          <option value="shared" ${step.source === 'shared' ? 'selected' : ''}>后台识图偏移</option>
        </select>`
      ),
      ...coordFields,
      fieldItem(
        '鼠标按键',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'button', this.value)">
          <option value="left" ${step.button === 'left' ? 'selected' : ''}>左键</option>
          <option value="right" ${step.button === 'right' ? 'selected' : ''}>右键</option>
          <option value="middle" ${step.button === 'middle' ? 'selected' : ''}>中键</option>
        </select>`
      ),
      fieldItem(
        '拖拽时长(毫秒)',
        `<input class="control-input" type="number" min="0" max="60000" step="50" value="${escapeHtml(step.duration_ms)}" oninput="window.updateStepField('${stepPath}', 'duration_ms', this.value, 'int')" />`,
        '从起点到终点的移动耗时，越大越慢。'
      ),
    ].join('');
  }

  if (step.kind === 'type_text') {
    return [
      fieldItem(
        '输入文本',
        `<textarea class="control-input" rows="2" placeholder="要输入的文本内容" oninput="window.updateStepField('${stepPath}', 'text', this.value)">${escapeHtml(step.text)}</textarea>`,
        '逐字符输入，支持中文和特殊字符。'
      ),
      fieldItem(
        '字符间隔(毫秒)',
        `<input class="control-input" type="number" min="0" max="5000" step="10" value="${escapeHtml(step.interval_ms)}" oninput="window.updateStepField('${stepPath}', 'interval_ms', this.value, 'int')" />`,
        '每个字符之间的等待时间。'
      ),
    ].join('');
  }

  if (step.kind === 'mouse_move') {
    const isAbsolute = step.source === 'absolute';
    const coordFields = isAbsolute ? [
      fieldItem('X', `<input class="control-input" type="number" value="${escapeHtml(step.x)}" oninput="window.updateStepField('${stepPath}', 'x', this.value, 'int')" />`),
      fieldItem('Y', `<input class="control-input" type="number" value="${escapeHtml(step.y)}" oninput="window.updateStepField('${stepPath}', 'y', this.value, 'int')" />`),
    ] : [
      fieldItem('名称', renderVariableSuggestInput({ stepPath, field: 'var_name', value: step.var_name, placeholder: 'target', scope: step.source === 'shared' ? 'shared' : 'local' })),
      fieldItem('偏移X', `<input class="control-input" type="number" value="${escapeHtml(step.offset_x)}" oninput="window.updateStepField('${stepPath}', 'offset_x', this.value, 'int')" />`),
      fieldItem('偏移Y', `<input class="control-input" type="number" value="${escapeHtml(step.offset_y)}" oninput="window.updateStepField('${stepPath}', 'offset_y', this.value, 'int')" />`),
    ];
    return [
      fieldItem(
        '点哪里',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'source', this.value)">
          <option value="absolute" ${step.source === 'absolute' ? 'selected' : ''}>固定坐标</option>
          <option value="var" ${step.source === 'var' ? 'selected' : ''}>找图结果偏移</option>
          <option value="shared" ${step.source === 'shared' ? 'selected' : ''}>后台识图偏移</option>
        </select>`
      ),
      ...coordFields,
    ].join('');
  }

  if (step.kind === 'set_variable') {
    return [
      fieldItem(
        '名称',
        renderVariableSuggestInput({ stepPath, field: 'var_name', value: step.var_name, placeholder: 'target', scope: 'local' })
      ),
      fieldItem(
        '要改哪个字段',
        `<input class="control-input" value="${escapeHtml(step.field)}" placeholder="found" oninput="window.updateStepField('${stepPath}', 'field', this.value)" />`,
        '比如 found、x、y 或自定义的字段名。'
      ),
      fieldItem(
        '值',
        `<input class="control-input" value="${escapeHtml(step.value)}" placeholder="true" oninput="window.updateStepField('${stepPath}', 'value', this.value)" />`,
        '自动识别类型：true/false 表示是/否，纯数字为数值，其余为文本。'
      ),
    ].join('');
  }

  if (step.kind === 'check_pixels') {
    const points = Array.isArray(step.points) ? step.points : [];
    const pointRows = points.map((pt, i) => `
      <div class="pixel-point-row" style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
        <input class="control-input" type="number" style="width:70px" placeholder="X" value="${pt.x || 0}" oninput="window.updateStepField('${stepPath}', 'points.${i}.x', this.value, 'int')" />
        <input class="control-input" type="number" style="width:70px" placeholder="Y" value="${pt.y || 0}" oninput="window.updateStepField('${stepPath}', 'points.${i}.y', this.value, 'int')" />
        <input class="control-input" style="width:90px" placeholder="#RRGGBB" value="${escapeHtml(pt.expected_color || '')}" oninput="window.updateStepField('${stepPath}', 'points.${i}.expected_color', this.value)" />
        <input class="control-input" type="number" style="width:55px" min="0" max="255" value="${pt.tolerance || 20}" oninput="window.updateStepField('${stepPath}', 'points.${i}.tolerance', this.value, 'int')" />
        <button class="ghost-button small-button" type="button" onclick="window.removeCheckPixelPoint('${stepPath}', ${i})">删</button>
      </div>
    `).join('');
    return [
      fieldItem(
        '检测点列表',
        `<div class="pixel-points-container">
          <div style="display:flex;gap:6px;margin-bottom:4px;font-size:11px;color:var(--text-muted);">
            <span style="width:70px">X</span><span style="width:70px">Y</span><span style="width:90px">颜色</span><span style="width:55px">容差</span>
          </div>
          ${pointRows}
          <button class="ghost-button small-button" type="button" onclick="window.addCheckPixelPoint('${stepPath}')">+ 添加检测点</button>
        </div>`,
        '每个检测点指定坐标和期望颜色，容差为 RGB 各通道允许偏差。',
        true
      ),
      fieldItem(
        '匹配逻辑',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'logic', this.value)">
          <option value="all" ${step.logic === 'all' ? 'selected' : ''}>全部匹配 (AND)</option>
          <option value="any" ${step.logic === 'any' ? 'selected' : ''}>任一匹配 (OR)</option>
        </select>`
      ),
      fieldItem(
        '结果名称',
        `<input class="control-input" value="${escapeHtml(step.save_as || 'pixel_result')}" placeholder="pixel_result" oninput="window.updateStepField('${stepPath}', 'save_as', this.value)" />`
      ),
    ].join('');
  }

  if (step.kind === 'check_region_color') {
    return [
      fieldItem(
        '区域左上角 X',
        `<input class="control-input" type="number" step="1" value="${escapeHtml(step.left)}" oninput="window.updateStepField('${stepPath}', 'left', this.value, 'int')" />`
      ),
      fieldItem(
        '区域左上角 Y',
        `<input class="control-input" type="number" step="1" value="${escapeHtml(step.top)}" oninput="window.updateStepField('${stepPath}', 'top', this.value, 'int')" />`
      ),
      fieldItem(
        '宽度',
        `<input class="control-input" type="number" min="1" step="1" value="${escapeHtml(step.width)}" oninput="window.updateStepField('${stepPath}', 'width', this.value, 'int')" />`
      ),
      fieldItem(
        '高度',
        `<input class="control-input" type="number" min="1" step="1" value="${escapeHtml(step.height)}" oninput="window.updateStepField('${stepPath}', 'height', this.value, 'int')" />`
      ),
      fieldItem(
        '期望颜色',
        `<input class="control-input" value="${escapeHtml(step.expected_color)}" placeholder="#FF0000" oninput="window.updateStepField('${stepPath}', 'expected_color', this.value)" />`
      ),
      fieldItem(
        '容差',
        `<input class="control-input" type="number" min="0" max="255" step="1" value="${escapeHtml(step.tolerance)}" oninput="window.updateStepField('${stepPath}', 'tolerance', this.value, 'int')" />`
      ),
      fieldItem(
        '最低占比',
        `<input class="control-input" type="number" min="0.01" max="1" step="0.01" value="${escapeHtml(step.min_ratio)}" oninput="window.updateStepField('${stepPath}', 'min_ratio', this.value, 'float')" />`,
        '区域内匹配像素占比达到此值则 found=true，范围 0.01~1.0。'
      ),
      fieldItem(
        '结果名称',
        `<input class="control-input" value="${escapeHtml(step.save_as || 'region_color_result')}" placeholder="region_color_result" oninput="window.updateStepField('${stepPath}', 'save_as', this.value)" />`
      ),
    ].join('');
  }

  if (step.kind === 'detect_color_region') {
    return [
      fieldItem(
        'H 范围',
        `<div style="display:flex;gap:6px;align-items:center;">
          <input class="control-input" type="number" min="0" max="179" style="width:70px" value="${escapeHtml(step.h_min)}" oninput="window.updateStepField('${stepPath}', 'h_min', this.value, 'int')" />
          <span>~</span>
          <input class="control-input" type="number" min="0" max="179" style="width:70px" value="${escapeHtml(step.h_max)}" oninput="window.updateStepField('${stepPath}', 'h_max', this.value, 'int')" />
        </div>`,
        'HSV 色相范围 0~179。'
      ),
      fieldItem(
        'S 范围',
        `<div style="display:flex;gap:6px;align-items:center;">
          <input class="control-input" type="number" min="0" max="255" style="width:70px" value="${escapeHtml(step.s_min)}" oninput="window.updateStepField('${stepPath}', 's_min', this.value, 'int')" />
          <span>~</span>
          <input class="control-input" type="number" min="0" max="255" style="width:70px" value="${escapeHtml(step.s_max)}" oninput="window.updateStepField('${stepPath}', 's_max', this.value, 'int')" />
        </div>`,
        '饱和度范围 0~255。'
      ),
      fieldItem(
        'V 范围',
        `<div style="display:flex;gap:6px;align-items:center;">
          <input class="control-input" type="number" min="0" max="255" style="width:70px" value="${escapeHtml(step.v_min)}" oninput="window.updateStepField('${stepPath}', 'v_min', this.value, 'int')" />
          <span>~</span>
          <input class="control-input" type="number" min="0" max="255" style="width:70px" value="${escapeHtml(step.v_max)}" oninput="window.updateStepField('${stepPath}', 'v_max', this.value, 'int')" />
        </div>`,
        '明度范围 0~255。'
      ),
      fieldItem(
        '搜索区域(可选)',
        `<div style="display:flex;gap:6px;flex-wrap:wrap;">
          <input class="control-input" type="number" style="width:70px" placeholder="左" value="${step.region_left || 0}" oninput="window.updateStepField('${stepPath}', 'region_left', this.value, 'int')" />
          <input class="control-input" type="number" style="width:70px" placeholder="上" value="${step.region_top || 0}" oninput="window.updateStepField('${stepPath}', 'region_top', this.value, 'int')" />
          <input class="control-input" type="number" style="width:70px" placeholder="宽" value="${step.region_width || 0}" oninput="window.updateStepField('${stepPath}', 'region_width', this.value, 'int')" />
          <input class="control-input" type="number" style="width:70px" placeholder="高" value="${step.region_height || 0}" oninput="window.updateStepField('${stepPath}', 'region_height', this.value, 'int')" />
        </div>`,
        '宽高都为 0 时搜索全屏。'
      ),
      fieldItem(
        '最小面积',
        `<input class="control-input" type="number" min="1" step="10" value="${escapeHtml(step.min_area)}" oninput="window.updateStepField('${stepPath}', 'min_area', this.value, 'int')" />`,
        '忽略面积小于此值的区域。'
      ),
      fieldItem(
        '结果名称',
        `<input class="control-input" value="${escapeHtml(step.save_as || 'color_region_result')}" placeholder="color_region_result" oninput="window.updateStepField('${stepPath}', 'save_as', this.value)" />`
      ),
    ].join('');
  }

  if (step.kind === 'match_fingerprint') {
    const samplePoints = Array.isArray(step.sample_points) ? step.sample_points : [];
    const spRows = samplePoints.map((sp, i) => `
      <div class="pixel-point-row" style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
        <input class="control-input" type="number" style="width:60px" placeholder="dx" value="${sp.dx || 0}" oninput="window.updateStepField('${stepPath}', 'sample_points.${i}.dx', this.value, 'int')" />
        <input class="control-input" type="number" style="width:60px" placeholder="dy" value="${sp.dy || 0}" oninput="window.updateStepField('${stepPath}', 'sample_points.${i}.dy', this.value, 'int')" />
        <input class="control-input" style="width:90px" placeholder="#RRGGBB" value="${escapeHtml(sp.expected_color || '')}" oninput="window.updateStepField('${stepPath}', 'sample_points.${i}.expected_color', this.value)" />
        <button class="ghost-button small-button" type="button" onclick="window.removeFingerprintPoint('${stepPath}', ${i})">删</button>
      </div>
    `).join('');
    return [
      fieldItem(
        '锚点 X',
        `<input class="control-input" type="number" step="1" value="${escapeHtml(step.anchor_x)}" oninput="window.updateStepField('${stepPath}', 'anchor_x', this.value, 'int')" />`
      ),
      fieldItem(
        '锚点 Y',
        `<input class="control-input" type="number" step="1" value="${escapeHtml(step.anchor_y)}" oninput="window.updateStepField('${stepPath}', 'anchor_y', this.value, 'int')" />`
      ),
      fieldItem(
        '采样点列表',
        `<div class="pixel-points-container">
          <div style="display:flex;gap:6px;margin-bottom:4px;font-size:11px;color:var(--text-muted);">
            <span style="width:60px">dx</span><span style="width:60px">dy</span><span style="width:90px">颜色</span>
          </div>
          ${spRows}
          <button class="ghost-button small-button" type="button" onclick="window.addFingerprintPoint('${stepPath}')">+ 添加采样点</button>
        </div>`,
        '每个采样点为相对锚点的偏移和期望颜色。',
        true
      ),
      fieldItem(
        '容差',
        `<input class="control-input" type="number" min="0" max="255" step="1" value="${escapeHtml(step.tolerance)}" oninput="window.updateStepField('${stepPath}', 'tolerance', this.value, 'int')" />`
      ),
      fieldItem(
        '结果名称',
        `<input class="control-input" value="${escapeHtml(step.save_as || 'fingerprint_result')}" placeholder="fingerprint_result" oninput="window.updateStepField('${stepPath}', 'save_as', this.value)" />`
      ),
    ].join('');
  }

  return [
    fieldItem(
      '按键',
      `${renderKeyCaptureInput({
        value: step.keys,
        placeholder: '点击后录入触发按键',
        captureTarget: 'step-field',
        capturePath: stepPath,
        captureField: 'keys',
      })}`,
      '点击输入框后直接按键录入，按 Backspace 或 Delete 清空。'
    ),
    fieldItem(
      '按后等待(毫秒)',
      `<input class="control-input" type="number" min="0" max="600000" step="10" value="${escapeHtml(step.delay_ms_after)}" oninput="window.updateStepField('${stepPath}', 'delay_ms_after', this.value, 'int')" />`
    ),
  ].join('');
}

function renderDesignerIndexMap() {
  const container = document.getElementById('designer-step-index');
  if (!container) {
    return;
  }
  const steps = Array.isArray(state.designer.steps) ? state.designer.steps : [];
  if (steps.length < 2) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = steps.map((step, index) => `
    <span class="step-index-chip" title="${escapeHtml(stepPreviewText(step))}" onclick="window.scrollToDesignerStep(${index})">
      <span class="chip-num">${index + 1}</span>${escapeHtml(stepTypeLabel(step.kind))}
    </span>
  `).join('');
}

function _isStepRunning(stepIndex) {
  const wfId = state.designer.workflow_id;
  if (!wfId) return false;
  const rt = state.runtime?.workflow_states?.[wfId];
  if (!rt || !rt.active) return false;
  return rt.current_step_index === stepIndex;
}

function renderStepCard(step, stepPath, index, nested = false) {
  const collapsed = state.collapsedSteps.has(stepPath);
  const collapseIcon = collapsed ? 'arrow-down' : 'arrow-up';
  const collapseLabel = collapsed ? '展开' : '收起';
  const cardId = nested ? '' : ` id="step-card-${stepPath.replaceAll('.', '-')}"`;
  const isRunning = !nested && _isStepRunning(index - 1);
  return `
    <article class="step-card ${nested ? 'nested' : ''} ${collapsed ? 'collapsed' : ''} ${isRunning ? 'step-running' : ''}"${cardId}>
      <div class="step-header">
        <div class="step-header-left" onclick="window.toggleStepCollapse('${stepPath}')">
          <small class="step-index">步骤 ${index}</small>
          <strong>${escapeHtml(stepTypeLabel(step.kind))}</strong>
          ${collapsed ? `<span class="step-preview-inline">${escapeHtml(stepPreviewText(step))}</span>` : ''}
        </div>
        <div class="step-header-actions">
          <select class="control-input compact-input" onchange="window.changeDesignerStepKind('${stepPath}', this.value)">
            ${stepKindOptions(step.kind)}
          </select>
          ${renderIconButton({ icon: 'copy', label: '复制步骤', extraClass: 'small-button', onClick: `window.duplicateDesignerStep('${stepPath}')` })}
          ${renderIconButton({ icon: 'delete-o', label: '删除步骤', extraClass: 'small-button danger-button', onClick: `window.removeDesignerStep('${stepPath}')` })}
          ${renderIconButton({ icon: 'arrow-up', label: '上移步骤', extraClass: 'small-button', onClick: `window.moveDesignerStep('${stepPath}', -1)` })}
          ${renderIconButton({ icon: 'arrow-down', label: '下移步骤', extraClass: 'small-button', onClick: `window.moveDesignerStep('${stepPath}', 1)` })}
          ${renderIconButton({ icon: collapseIcon, label: collapseLabel, extraClass: 'small-button', onClick: `window.toggleStepCollapse('${stepPath}')` })}
        </div>
      </div>
      ${collapsed ? '' : `<div class="step-grid">${renderStepFields(step, stepPath)}</div>`}
    </article>
  `;
}


function renderDesignerSteps() {
  const container = document.getElementById('designer-step-list');
  if (!container) {
    return;
  }

  const steps = Array.isArray(state.designer.steps) ? state.designer.steps : [];
  container.innerHTML = steps.length
    ? `<div class="step-list">${steps.map((step, index) => renderStepCard(step, `steps.${index}`, index + 1)).join('')}</div>`
    : '<div class="empty-state">当前流程还没有步骤，先添加一个节点。</div>';
  renderDesignerIndexMap();
  loadTemplateThumbnails();
}

function loadTemplateThumbnails() {
  const imgs = document.querySelectorAll('img.template-thumb[data-template-path]');
  for (const img of imgs) {
    const tplPath = img.dataset.templatePath;
    if (!tplPath || img.src) continue;
    const client = api();
    if (!client?.get_template_thumbnail) continue;
    client.get_template_thumbnail({ template_path: tplPath, max_size: 120 }).then((res) => {
      if (res?.ok && res.data_url) {
        img.src = res.data_url;
        img.title = `${res.width}×${res.height}`;
      } else {
        const wrap = img.closest('.template-thumb-wrap');
        if (wrap) wrap.hidden = true;
      }
    }).catch(() => {
      const wrap = img.closest('.template-thumb-wrap');
      if (wrap) wrap.hidden = true;
    });
  }
}
