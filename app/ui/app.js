const STEP_TYPES = [
  { key: 'key_tap', label: '按键触发' },
  { key: 'delay', label: '延时等待' },
  { key: 'key_sequence', label: '按键序列' },
  { key: 'detect_image', label: '识图存变量' },
  { key: 'click_point', label: '点击坐标' },
  { key: 'if_var_found', label: '识图分支' },
  { key: 'set_variable_state', label: '变量赋值' },
  { key: 'key_hold', label: '按住按键' },
];

const DEFAULT_DESIGNER_TEMPLATE = {
  run_mode: { type: 'once' },
  steps: [
    {
      kind: 'key_tap',
      keys: '',
      delay_ms_after: 100,
    },
  ],
};

const APP_TABS = [
  {
    key: 'flows',
    label: '流程',
    description: '查看、搜索、执行和管理全部流程。',
    count: () => state.workflows.length,
  },
  {
    key: 'editor',
    label: '流程编辑',
    description: '单独编辑流程的热键、运行模式和步骤。',
  },
  {
    key: 'async_vision',
    label: '异步识图',
    description: '后台持续识图，并把结果写入共享变量。',
    count: () => state.asyncVision.monitors.length,
  },
  {
    key: 'settings',
    label: '设置',
    description: '切换主题并查看当前界面配置。',
  },
  {
    key: 'about',
    label: '关于',
    description: '查看产品说明、架构约定和配置位置。',
  },
];

const ASYNC_MONITOR_PRESETS = {
  fixed_button: {
    label: '固定按钮',
    search_scope: 'fixed_region',
    scan_rate: 'normal',
    not_found_action: 'keep_last',
    match_mode: 'normal',
    custom_confidence: 0.88,
    follow_radius: 220,
    recover_after_misses: 2,
    stale_after_ms: 1200,
  },
  dialog_confirm: {
    label: '弹窗确认',
    search_scope: 'full_screen',
    scan_rate: 'high',
    not_found_action: 'mark_missing',
    match_mode: 'normal',
    custom_confidence: 0.88,
    follow_radius: 220,
    recover_after_misses: 1,
    stale_after_ms: 700,
  },
  moving_target: {
    label: '移动目标',
    search_scope: 'follow_last',
    scan_rate: 'high',
    not_found_action: 'mark_missing',
    match_mode: 'loose',
    custom_confidence: 0.82,
    follow_radius: 260,
    recover_after_misses: 2,
    stale_after_ms: 500,
  },
  status_check: {
    label: '状态检测',
    search_scope: 'fixed_region',
    scan_rate: 'low',
    not_found_action: 'keep_last',
    match_mode: 'strict',
    custom_confidence: 0.95,
    follow_radius: 200,
    recover_after_misses: 3,
    stale_after_ms: 2000,
  },
  custom: {
    label: '自定义',
    search_scope: 'full_screen',
    scan_rate: 'normal',
    not_found_action: 'keep_last',
    match_mode: 'custom',
    custom_confidence: 0.88,
    follow_radius: 220,
    recover_after_misses: 2,
    stale_after_ms: 1200,
  },
};

const INITIAL_THEME = (() => {
  try {
    return localStorage.getItem('luoqi-theme') || 'graphite';
  } catch {
    return 'graphite';
  }
})();

const state = {
  tabs: [],
  activeTab: 'flows',
  workflows: [],
  logs: [],
  summary: {},
  app: {},
  architecture: [],
  flowQuery: '',
  flowFilter: 'all',
  theme: INITIAL_THEME,
  runtime: {
    workflow_states: {},
    key_events: [],
    active_loop_count: 0,
  },
  designerDefaults: DEFAULT_DESIGNER_TEMPLATE,
  designer: null,
  asyncVision: {
    monitors: [],
    sharedVariables: [],
    editor: null,
  },
  designerSave: {
    status: 'idle',
    lastSavedAt: 0,
    message: '',
  },
  toast: {
    visible: false,
    tone: 'info',
    message: '',
  },
  bootstrapped: false,
  timersStarted: false,
  captureSuspended: false,
  captureReleaseTimer: null,
  toastTimer: null,
};

function api() {
  return window.pywebview?.api;
}

const TEMPLATE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/bmp,image/webp';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeInt(rawValue, fallback = 0) {
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFloat(rawValue, fallback = 0) {
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coerceValue(rawValue, valueType = 'text') {
  if (valueType === 'int') {
    return normalizeInt(rawValue, 0);
  }
  if (valueType === 'float') {
    return normalizeFloat(rawValue, 0);
  }
  if (valueType === 'bool') {
    return Boolean(rawValue);
  }
  return String(rawValue ?? '');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取模板文件失败。'));
    reader.readAsDataURL(file);
  });
}

function chooseTemplateImageFile() {
  return new Promise((resolve, reject) => {
    const fileInput = document.createElement('input');
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('focus', handleWindowFocus, true);
      fileInput.remove();
    };

    const resolveOnce = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (!settled && !(fileInput.files?.length)) {
          resolveOnce(null);
        }
      }, 0);
    };

    fileInput.type = 'file';
    fileInput.accept = TEMPLATE_IMAGE_ACCEPT;
    fileInput.tabIndex = -1;
    fileInput.setAttribute('aria-hidden', 'true');
    fileInput.style.position = 'fixed';
    fileInput.style.left = '-9999px';
    fileInput.style.top = '0';
    fileInput.style.width = '1px';
    fileInput.style.height = '1px';
    fileInput.style.opacity = '0';
    fileInput.style.pointerEvents = 'none';
    fileInput.addEventListener('change', () => {
      const [selectedFile] = Array.from(fileInput.files ?? []);
      resolveOnce(selectedFile instanceof File ? selectedFile : null);
    }, { once: true });

    document.body.appendChild(fileInput);
    window.addEventListener('focus', handleWindowFocus, true);

    try {
      if (typeof fileInput.showPicker === 'function') {
        fileInput.showPicker();
      } else {
        fileInput.click();
      }
    } catch (error) {
      rejectOnce(error);
    }
  });
}

async function uploadTemplateImage() {
  const client = api();
  if (!client) {
    throw new Error('当前版本暂不支持模板上传。');
  }

  if (typeof client.pick_template_image === 'function') {
    try {
      const result = await client.pick_template_image();
      if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'template_path')) {
        return String(result.template_path ?? '').trim();
      }
    } catch (error) {
      console.warn('原生模板选择失败，回退到网页文件选择器。', error);
    }
  }

  if (!client.upload_template_image) {
    throw new Error('当前版本暂不支持模板上传。');
  }

  const selectedFile = await chooseTemplateImageFile();
  if (!(selectedFile instanceof File)) {
    return '';
  }

  const dataUrl = await readFileAsDataUrl(selectedFile);
  const result = await client.upload_template_image({
    filename: selectedFile.name,
    data_url: dataUrl,
  });
  const templatePath = String(result?.template_path ?? '').trim();
  if (!templatePath) {
    throw new Error('上传接口没有返回模板路径。');
  }
  return templatePath;
}


const KEY_CODE_MAP = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'space',
  Escape: 'esc',
  Tab: 'tab',
  Enter: 'enter',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  CapsLock: 'capslock',
  PrintScreen: 'printscreen',
  ScrollLock: 'scrolllock',
  Pause: 'pause',
  NumpadDecimal: 'numdecimal',
  NumpadAdd: 'numplus',
  NumpadSubtract: 'numminus',
  NumpadMultiply: 'nummultiply',
  NumpadDivide: 'numdivide',
  NumpadEnter: 'enter',
};

function normalizeKeyFromEvent(event) {
  const code = String(event.code ?? '');
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  if (/^Digit\d$/.test(code)) {
    return code.slice(5);
  }
  if (/^F\d{1,2}$/.test(code)) {
    return code.toLowerCase();
  }
  if (/^Numpad\d$/.test(code)) {
    return `num${code.slice(6)}`;
  }
  if (KEY_CODE_MAP[code]) {
    return KEY_CODE_MAP[code];
  }

  const rawKey = String(event.key ?? '').toLowerCase();
  const keyMap = {
    ' ': 'space',
    escape: 'esc',
    control: 'ctrl',
    shift: 'shift',
    alt: 'alt',
    meta: 'win',
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
  };
  if (keyMap[rawKey]) {
    return keyMap[rawKey];
  }
  return rawKey;
}

function buildCapturedKey(event) {
  const mainKey = normalizeKeyFromEvent(event);
  if (!mainKey || ['ctrl', 'shift', 'alt', 'win'].includes(mainKey)) {
    return '';
  }

  const parts = [];
  if (event.ctrlKey) {
    parts.push('ctrl');
  }
  if (event.altKey) {
    parts.push('alt');
  }
  if (event.shiftKey) {
    parts.push('shift');
  }
  if (event.metaKey) {
    parts.push('win');
  }
  parts.push(mainKey);
  return parts.join('+');
}

function renderKeyCaptureInput(options = {}) {
  const attrs = [
    `class="${escapeHtml(options.className ?? 'control-input capture-input')}"`,
    `value="${escapeHtml(options.value ?? '')}"`,
    `placeholder="${escapeHtml(options.placeholder ?? '点击后按下按键')}"`,
    `title="${escapeHtml(options.title ?? '点击输入框后直接按键录入，按 Backspace 或 Delete 清空')}"`,
    'autocomplete="off"',
    'spellcheck="false"',
    'readonly',
    'data-key-capture="true"',
  ];

  if (options.inputId) {
    attrs.push(`id="${escapeHtml(options.inputId)}"`);
  }
  if (options.captureTarget) {
    attrs.push(`data-capture-target="${escapeHtml(options.captureTarget)}"`);
  }
  if (options.capturePath) {
    attrs.push(`data-capture-path="${escapeHtml(options.capturePath)}"`);
  }
  if (options.captureField) {
    attrs.push(`data-capture-field="${escapeHtml(options.captureField)}"`);
  }
  if (options.captureIndex !== undefined && options.captureIndex !== null) {
    attrs.push(`data-capture-index="${escapeHtml(options.captureIndex)}"`);
  }

  return `<input ${attrs.join(' ')} />`;
}


const VANT_ICON_SVG = {
  'apps-o': '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="4.5" width="6" height="6" rx="1.2"></rect><rect x="13.5" y="4.5" width="6" height="6" rx="1.2"></rect><rect x="4.5" y="13.5" width="6" height="6" rx="1.2"></rect><rect x="13.5" y="13.5" width="6" height="6" rx="1.2"></rect></svg>',
  plus: '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
  replay: '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 5v6h-6"></path><path d="M20 11a8 8 0 1 0 2 5.2"></path></svg>',
  success: '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M8.5 12.5 10.8 14.8 15.8 9.8"></path></svg>',
  'arrow-up': '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V6"></path><path d="M6.5 11.5 12 6l5.5 5.5"></path></svg>',
  'arrow-down': '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v13"></path><path d="M6.5 12.5 12 18l5.5-5.5"></path></svg>',
  'delete-o': '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 7.5h15"></path><path d="M9.5 7.5V5h5v2.5"></path><path d="M7.5 7.5 8.4 19h7.2l.9-11.5"></path><path d="M10 10.5v5.5"></path><path d="M14 10.5v5.5"></path></svg>',
  'play-circle-o': '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M10 9.5v5l4.5-2.5-4.5-2.5Z" fill="currentColor" stroke="none"></path></svg>',
  edit: '<svg class="van-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 19.5h4l9.7-9.7a2.3 2.3 0 0 0-3.2-3.2L5.3 16.3v3.2Z"></path><path d="m13.8 7.8 2.4 2.4"></path></svg>',
};

function renderVantIcon(iconName) {
  return VANT_ICON_SVG[iconName] ?? VANT_ICON_SVG['apps-o'];
}


function renderIconButton(options = {}) {
  const label = String(options.label ?? '').trim() || '按钮';
  const iconName = String(options.icon ?? 'apps-o').trim() || 'apps-o';
  const variantClass = options.variant === 'primary' ? 'primary-button' : 'ghost-button';
  const className = [variantClass, 'icon-button', options.extraClass ?? ''].filter(Boolean).join(' ');
  const attrs = [
    `class="${escapeHtml(className)}"`,
    'type="button"',
    `title="${escapeHtml(label)}"`,
    `aria-label="${escapeHtml(label)}"`,
  ];

  if (options.buttonId) {
    attrs.push(`id="${escapeHtml(options.buttonId)}"`);
  }
  if (options.onClick) {
    attrs.push(`onclick="${escapeHtml(options.onClick)}"`);
  }

  return `<button ${attrs.join(' ')}>${renderVantIcon(iconName)}<span class="sr-only">${escapeHtml(label)}</span></button>`;
}

function decorateStaticButtons() {
  return;
}

function normalizeTheme(theme) {
  return ['dark', 'light', 'graphite'].includes(theme) ? theme : 'graphite';
}

function applyTheme(theme = state.theme) {
  const normalized = normalizeTheme(theme);
  state.theme = normalized;
  document.documentElement.dataset.theme = normalized;
  try {
    localStorage.setItem('luoqi-theme', normalized);
  } catch {
    return;
  }
}

function formatDesignerSavedAt(timestamp) {
  if (!timestamp) {
    return '尚未保存';
  }
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function setDesignerSaveStatus(status, message = '') {
  state.designerSave.status = status;
  state.designerSave.message = message;
  if (status === 'saved') {
    state.designerSave.lastSavedAt = Date.now();
  }
  renderDesignerSaveStatus();
}

function resetDesignerSaveState() {
  state.designerSave = {
    status: 'idle',
    lastSavedAt: 0,
    message: '',
  };
  renderDesignerSaveStatus();
}

function markDesignerDirty() {
  if (state.designerSave.status === 'saving') {
    return;
  }
  setDesignerSaveStatus('dirty', '流程有未保存修改');
}

function renderDesignerSaveStatus() {
  const badge = document.getElementById('designer-save-badge');
  const text = document.getElementById('designer-save-text');
  if (!badge || !text) {
    return;
  }

  const status = state.designerSave.status;
  const preset = {
    idle: {
      label: '未修改',
      text: '当前内容与已保存版本一致',
    },
    dirty: {
      label: '待保存',
      text: '流程已有修改，请记得保存',
    },
    saving: {
      label: '保存中',
      text: '正在保存流程配置…',
    },
    saved: {
      label: '已保存',
      text: `最近保存于 ${formatDesignerSavedAt(state.designerSave.lastSavedAt)}`,
    },
    error: {
      label: '保存失败',
      text: state.designerSave.message || '保存未成功，请重试',
    },
  }[status] ?? {
    label: '未修改',
    text: '当前内容与已保存版本一致',
  };

  badge.className = `status-badge ${status}`;
  badge.textContent = preset.label;
  text.textContent = preset.text;
}

function renderToast() {
  const element = document.getElementById('workspace-toast');
  if (!element) {
    return;
  }
  const { visible, tone, message } = state.toast;
  element.hidden = !visible;
  element.className = `toast-banner ${tone}`;
  element.textContent = message;
}

function showToast(message, tone = 'success') {
  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer);
  }
  state.toast = {
    visible: true,
    tone,
    message,
  };
  renderToast();
  state.toastTimer = window.setTimeout(() => {
    state.toast = { visible: false, tone: 'info', message: '' };
    renderToast();
  }, 2400);
}

function applyCapturedInputValue(input, value) {
  input.value = value;
  const target = input.dataset.captureTarget;
  if (target === 'designer-hotkey') {
    updateDesignerField('hotkey', value);
    return;
  }
  if (target === 'step-field') {
    updateStepField(input.dataset.capturePath, input.dataset.captureField, value);
    return;
  }
  if (target === 'sequence-field') {
    updateSequenceItem(
      input.dataset.capturePath,
      Number(input.dataset.captureIndex ?? 0),
      input.dataset.captureField,
      value,
    );
  }
}

function handleCapturedKeyInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.matches('input[data-key-capture]')) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const hasModifier = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
  if (!hasModifier && ['Backspace', 'Delete'].includes(event.key)) {
    applyCapturedInputValue(target, '');
    return;
  }

  if (event.repeat) {
    return;
  }

  const captured = buildCapturedKey(event);
  if (!captured) {
    return;
  }
  applyCapturedInputValue(target, captured);
}

function callCaptureApi(methodName) {
  const method = api()?.[methodName];
  if (typeof method !== 'function') {
    return;
  }
  Promise.resolve(method()).catch(() => undefined);
}

function requestCaptureSuspend() {
  if (state.captureReleaseTimer) {
    window.clearTimeout(state.captureReleaseTimer);
    state.captureReleaseTimer = null;
  }
  if (state.captureSuspended) {
    return;
  }
  state.captureSuspended = true;
  callCaptureApi('begin_key_capture');
}

function requestCaptureResume() {
  if (state.captureReleaseTimer) {
    window.clearTimeout(state.captureReleaseTimer);
  }
  state.captureReleaseTimer = window.setTimeout(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLInputElement && activeElement.matches('input[data-key-capture]')) {
      return;
    }
    if (!state.captureSuspended) {
      return;
    }
    state.captureSuspended = false;
    callCaptureApi('end_key_capture');
  }, 120);
}

function stepTypeLabel(kind) {
  return STEP_TYPES.find((item) => item.key === kind)?.label ?? kind;
}

function createDefaultStep(kind = 'key_tap') {
  if (kind === 'delay') {
    return { kind: 'delay', milliseconds: 100 };
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
      steps: [createDefaultStep('delay')],
    };
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
      steps: normalizeSteps(step.steps, false),
    };
  }

  return {
    kind: 'key_tap',
    keys: String(step.keys ?? '').trim(),
    delay_ms_after: Math.max(0, normalizeInt(step.delay_ms_after ?? step.delay_ms, 100)),
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
  resetDesignerSaveState();
  if (!keepTab) {
    state.activeTab = 'editor';
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
  resetDesignerSaveState();
  state.activeTab = 'editor';
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

function updateStepField(stepPath, field, value, valueType = 'text') {
  const step = readPath(state.designer, stepPath);
  if (!step) {
    return;
  }
  step[field] = coerceValue(value, valueType);
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

function renderSummary() {
  document.getElementById('workflow-count').textContent = state.summary.workflow_count ?? 0;
  document.getElementById('enabled-count').textContent = state.summary.enabled_count ?? 0;
  document.getElementById('custom-flow-count').textContent = state.summary.custom_flow_count ?? 0;
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
      async_vision: '当前页支持新建、编辑、删除异步识图，并查看共享变量。',
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

  const visible = state.activeTab === 'editor';
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
  return STEP_TYPES.map((item) => `
    <option value="${item.key}" ${item.key === currentKind ? 'selected' : ''}>${escapeHtml(item.label)}</option>
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


function renderBranchPane(steps, listPath, title, description) {
  return `
    <section class="branch-pane">
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
    return fieldItem(
      '等待时间(ms)',
      `<input class="control-input" type="number" min="0" max="600000" step="10" value="${escapeHtml(step.milliseconds)}" oninput="window.updateStepField('${stepPath}', 'milliseconds', this.value, 'int')" />`,
      '用于主动等待下一步执行。'
    );
  }

  if (step.kind === 'key_sequence') {
    return renderSequenceEditor(step, stepPath);
  }

  if (step.kind === 'detect_image') {
    return [
      fieldItem(
        '模板图路径',
        `<div class="template-upload-row">
          <input class="control-input" value="${escapeHtml(step.template_path)}" placeholder="例如 assets/templates/target_demo.png" oninput="window.updateStepField('${stepPath}', 'template_path', this.value)" />
          <button class="ghost-button small-button" type="button" onclick="window.uploadTemplateForStep('${stepPath}')">上传模板</button>
        </div>`,
        '支持手动填写路径，或直接上传图片后自动保存到 assets/templates。',
        true,
      ),
      fieldItem(
        '保存变量名',
        `<input class="control-input" value="${escapeHtml(step.save_as)}" placeholder="target" oninput="window.updateStepField('${stepPath}', 'save_as', this.value)" />`,
        '命中的坐标会写入这个变量。'
      ),
      fieldItem(
        '置信度',
        `<input class="control-input" type="number" min="0.55" max="0.99" step="0.01" value="${escapeHtml(step.confidence)}" oninput="window.updateStepField('${stepPath}', 'confidence', this.value, 'float')" />`
      ),
      fieldItem(
        '超时(ms)',
        `<input class="control-input" type="number" min="100" max="600000" step="100" value="${escapeHtml(step.timeout_ms)}" oninput="window.updateStepField('${stepPath}', 'timeout_ms', this.value, 'int')" />`
      ),
      fieldItem(
        '搜索步长',
        `<input class="control-input" type="number" min="1" max="64" step="1" value="${escapeHtml(step.search_step)}" oninput="window.updateStepField('${stepPath}', 'search_step', this.value, 'int')" />`
      ),
    ].join('');
  }

  if (step.kind === 'click_point') {
    const isCurrent = step.source === 'current';

    const sourceControl = fieldItem(
      '坐标来源',
      `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'source', this.value)">
        <option value="var" ${step.source === 'var' ? 'selected' : ''}>来自本地变量</option>
        <option value="shared" ${step.source === 'shared' ? 'selected' : ''}>来自共享变量</option>
        <option value="absolute" ${step.source === 'absolute' ? 'selected' : ''}>固定坐标</option>
        <option value="current" ${step.source === 'current' ? 'selected' : ''}>当前鼠标位置</option>
      </select>`,
      '建议优先和识图变量结合。'
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
            '变量名',
            renderVariableSuggestInput({
              stepPath,
              field: 'var_name',
              value: step.var_name,
              placeholder: 'target',
              scope: step.source === 'shared' ? 'shared' : 'local',
            }),
            step.source === 'shared' ? '支持搜索并选择异步识图共享变量，也可手动输入。' : '支持搜索并选择流程内识图变量，也可手动输入。'
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
      '修饰键延迟(ms)',
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
            '点击后停顿(ms)',
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
        '变量来源',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'variable_scope', this.value)">
          <option value="local" ${step.variable_scope !== 'shared' ? 'selected' : ''}>本地变量</option>
          <option value="shared" ${step.variable_scope === 'shared' ? 'selected' : ''}>异步识图共享变量</option>
        </select>`,
        '异步识图写入的是共享变量；流程内 detect_image 写入的是本地变量。',
      ),
      fieldItem(
        '判断变量名',
        renderVariableSuggestInput({
          stepPath,
          field: 'var_name',
          value: step.var_name,
          placeholder: 'target',
          scope: step.variable_scope === 'shared' ? 'shared' : 'local',
        }),
        step.variable_scope === 'shared' ? '支持搜索并选择异步识图共享变量，也可手动输入。' : '支持搜索并选择流程内识图变量，也可手动输入。',
        true,
      ),
      `
        <div class="branch-grid field-wide-span">
          ${renderBranchPane(thenSteps, `${stepPath}.then_steps`, '命中分支', '当变量 found=true 时执行')}
          ${renderBranchPane(elseSteps, `${stepPath}.else_steps`, '未命中分支', '当变量 found=false 时执行')}
        </div>
      `,
    ].join('');
  }

  if (step.kind === 'set_variable_state') {
    return [
      fieldItem(
        '变量来源',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'variable_scope', this.value)">
          <option value="local" ${step.variable_scope !== 'shared' ? 'selected' : ''}>本地变量</option>
          <option value="shared" ${step.variable_scope === 'shared' ? 'selected' : ''}>异步识图共享变量</option>
        </select>`,
        '可把流程内变量或异步识图共享变量直接设为命中 / 未命中。',
      ),
      fieldItem(
        '变量名',
        renderVariableSuggestInput({
          stepPath,
          field: 'var_name',
          value: step.var_name,
          placeholder: 'target',
          scope: step.variable_scope === 'shared' ? 'shared' : 'local',
        }),
        step.variable_scope === 'shared' ? '支持搜索并选择异步识图共享变量，也可手动输入。' : '支持搜索并选择流程内识图变量，也可手动输入。',
      ),
      fieldItem(
        '设置结果',
        `<select class="control-input" onchange="window.updateStepField('${stepPath}', 'state', this.value)">
          <option value="found" ${step.state === 'found' ? 'selected' : ''}>设为命中</option>
          <option value="missing" ${step.state !== 'found' ? 'selected' : ''}>设为未命中</option>
        </select>`,
        '适合在命中分支执行完后，手动把变量复位。',
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
        '按住该键期间执行下方子步骤，结束后自动松开。'
      ),
      `
        <div class="field-wide-span">
          ${renderBranchPane(holdSteps, `${stepPath}.steps`, '按住期间执行的步骤', '按键按住期间依次执行以下步骤')}
        </div>
      `,
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
      '按后等待(ms)',
      `<input class="control-input" type="number" min="0" max="600000" step="10" value="${escapeHtml(step.delay_ms_after)}" oninput="window.updateStepField('${stepPath}', 'delay_ms_after', this.value, 'int')" />`
    ),
  ].join('');
}

function renderStepCard(step, stepPath, index, nested = false) {
  return `
    <article class="step-card ${nested ? 'nested' : ''}">
      <div class="step-header">
        <div>
          <div class="eyebrow">步骤 ${index}</div>
          <strong>${escapeHtml(stepTypeLabel(step.kind))}</strong>
        </div>
        <div class="step-header-actions">
          <select class="control-input compact-input" onchange="window.changeDesignerStepKind('${stepPath}', this.value)">
            ${stepKindOptions(step.kind)}
          </select>
          ${renderIconButton({ icon: 'delete-o', label: '删除步骤', extraClass: 'small-button danger-button', onClick: `window.removeDesignerStep('${stepPath}')` })}
          ${renderIconButton({ icon: 'arrow-up', label: '上移步骤', extraClass: 'small-button', onClick: `window.moveDesignerStep('${stepPath}', -1)` })}
          ${renderIconButton({ icon: 'arrow-down', label: '下移步骤', extraClass: 'small-button', onClick: `window.moveDesignerStep('${stepPath}', 1)` })}
        </div>
      </div>
      <div class="step-grid">
        ${renderStepFields(step, stepPath)}
      </div>
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
}

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
      ? `${modifiers}点击共享变量 ${step.var_name}`
      : `${modifiers}点击变量 ${step.var_name}`;
  }
  if (step.kind === 'if_var_found') {
    return step.variable_scope === 'shared'
      ? `分支 shared.${step.var_name}.found`
      : `分支 ${step.var_name}.found`;
  }
  if (step.kind === 'set_variable_state') {
    const scopeLabel = step.variable_scope === 'shared' ? 'shared.' : '';
    return `设置 ${scopeLabel}${step.var_name} = ${step.state === 'found' ? '命中' : '未命中'}`;
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
  const notes = Array.isArray(workflow.notes) ? workflow.notes : [];
  const issues = Array.isArray(workflow.issues) ? workflow.issues : [];

  return `
    <article class="workflow-card">
      <div class="workflow-top">
        <div>
          <div class="badge-row">
            <span class="source-badge ${workflow.is_custom ? 'custom' : 'builtin'}">${workflow.is_custom ? '自定义' : '内置'}</span>
            <span class="category-badge">${escapeHtml(workflow.category ?? '')}</span>
            <span class="source-badge ${workflow.is_loop ? 'loop' : 'trigger'}">${escapeHtml(runModeLabel(workflow.run_mode))}</span>
            ${workflow.is_custom ? renderIconButton({ icon: 'delete-o', label: '删除流程', extraClass: 'badge-button danger-button', onClick: `window.deleteCustomWorkflow('${workflow.workflow_id}')` }) : ''}
          </div>
          <h4>${escapeHtml(workflow.name)}</h4>
          <p>${escapeHtml(workflow.description ?? '')}</p>
        </div>
        <span class="runtime-badge ${escapeHtml(runtime.status ?? 'idle')}">${escapeHtml(runtime.status_label ?? '待机')}</span>
      </div>

      ${renderStepPreview(steps)}

      ${notes.length ? `<div class="note-group">${notes.map((note) => `<span class="action-chip">${escapeHtml(note)}</span>`).join('')}</div>` : ''}
      ${issues.length ? `<div class="issue-group">${issues.map((issue) => `<span class="issue-badge">${escapeHtml(issue)}</span>`).join('')}</div>` : ''}

      <div class="binding-row">
        ${renderKeyCaptureInput({
          inputId: `hotkey-${workflow.workflow_id}`,
          value: workflow.binding?.hotkey ?? '',
          placeholder: '点击后直接录入触发热键',
          captureTarget: 'workflow-hotkey',
        })}
        <label class="toggle toggle-card mini-toggle">
          <input id="enabled-${workflow.workflow_id}" type="checkbox" ${workflow.binding?.enabled ? 'checked' : ''} onchange="window.updateWorkflowEnabled('${workflow.workflow_id}', this.checked)" />
          启用
        </label>
      </div>

      ${renderWorkflowSettings(workflow)}

      <div class="runtime-meta">
        <span>最近触发：${escapeHtml(runtime.last_trigger_time ?? '--')}</span>
        <span>最近完成：${escapeHtml(runtime.last_finish_time ?? '--')}</span>
        <span>轮次：${escapeHtml(runtime.iteration_count ?? 0)}</span>
        <span>按键记录：${escapeHtml(runtime.key_event_count ?? 0)}</span>
        <span>最后按键：${escapeHtml(runtime.last_key ?? '--')}</span>
      </div>

      <p class="runtime-message">${escapeHtml(runtime.last_message ?? '尚未触发')}</p>

      <div class="card-actions">
        ${renderIconButton({ icon: 'success', label: '保存热键', onClick: `window.saveWorkflow('${workflow.workflow_id}')` })}
        ${renderIconButton({ icon: 'play-circle-o', label: '立即执行', variant: 'primary', onClick: `window.runWorkflow('${workflow.workflow_id}')` })}
        ${workflow.definition_editable ? renderIconButton({ icon: 'edit', label: '编辑流程', onClick: `window.loadWorkflowIntoDesigner('${workflow.workflow_id}')` }) : ''}
      </div>
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
    hit: '命中',
    miss: '未命中',
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
            <span class="source-badge custom">异步识图</span>
            <span class="category-badge">${escapeHtml(asyncMonitorPresetLabel(editor.preset))}</span>
          </div>
          <h4>${escapeHtml(editor.monitor_id ? `编辑识别：${editor.name || editor.monitor_id}` : '新建异步识图')}</h4>
          <p>在流程外后台持续识图，并把结果写入变量，供流程步骤直接读取。</p>
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
            <p>先选使用场景，再填写模板图和变量名。</p>
          </div>
        </div>
        ${fieldItem('使用场景', `<select class="control-input" onchange="window.updateAsyncMonitorField('preset', this.value)">
          ${Object.entries(ASYNC_MONITOR_PRESETS).map(([key, item]) => `<option value="${key}" ${key === editor.preset ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
        </select>`, '系统会按场景带出推荐设置。')}
        ${fieldItem('识别名称', `<input class="control-input" id="async-monitor-name" value="${escapeHtml(editor.name)}" placeholder="例如 开始按钮 / 对话框确认 / Boss图标" oninput="window.updateAsyncMonitorField('name', this.value)" />`)}
        ${fieldItem('保存到变量', `<input class="control-input" id="async-monitor-output-variable" value="${escapeHtml(editor.output_variable)}" placeholder="target" oninput="window.updateAsyncMonitorField('output_variable', this.value)" />`, '流程中的点击和分支步骤可以直接读取这个变量。')}
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
        ${showFollowConfig ? fieldItem('附近查找范围', `<input class="control-input" type="number" min="60" max="4000" step="10" value="${escapeHtml(editor.follow_radius)}" oninput="window.updateAsyncMonitorField('follow_radius', this.value, 'int')" />`, '以上次命中点为中心，按这个范围继续找。') : ''}
        ${showFollowConfig ? fieldItem('连续几次没找到后，扩大查找范围', `<input class="control-input" type="number" min="1" max="30" step="1" value="${escapeHtml(editor.recover_after_misses)}" oninput="window.updateAsyncMonitorField('recover_after_misses', this.value, 'int')" />`) : ''}
        <div class="field-wide-span subsection-head">
          <div>
            <strong>高级设置</strong>
            <p>只在需要细调时修改，普通场景保持默认即可。</p>
          </div>
        </div>
        ${fieldItem('结果多久没更新算过期(ms)', `<input class="control-input" type="number" min="100" max="600000" step="100" value="${escapeHtml(editor.stale_after_ms)}" oninput="window.updateAsyncMonitorField('stale_after_ms', this.value, 'int')" />`)}
        <label class="toggle toggle-card mini-toggle">
          <input id="async-monitor-enabled" type="checkbox" ${editor.enabled ? 'checked' : ''} onchange="window.updateAsyncMonitorCheckbox('enabled', this.checked)" />
          启用识别
        </label>
      </div>
    </article>
  `;
}

function renderFlowWorkspace() {
  const workflows = getVisibleWorkflows();
  const filters = [
    { key: 'all', label: '全部流程' },
    { key: 'editable', label: '可编辑流程' },
    { key: 'loop', label: '循环流程' },
    { key: 'vision', label: '识图流程' },
  ];

  return `
    <div class="workspace-stack">
      <article class="workflow-card workspace-panel">
        <div class="panel-head compact">
          <div>
            <div class="eyebrow">流程</div>
            <h4>流程列表</h4>
          </div>
          <span class="source-badge custom">显示 ${escapeHtml(workflows.length)} / ${escapeHtml(state.workflows.length)}</span>
        </div>
        <div class="workspace-toolbar">
          <input
            class="control-input"
            value="${escapeHtml(state.flowQuery)}"
            placeholder="搜索流程名、热键、说明或分类"
            oninput="window.updateFlowSearch(this.value)"
          />
          <select class="control-input compact-input" onchange="window.updateFlowFilter(this.value)">
            ${filters.map((item) => `<option value="${item.key}" ${item.key === state.flowFilter ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
          <button class="primary-button" type="button" onclick="window.resetDesigner(false)">新建流程</button>
        </div>
      </article>
      ${workflows.length
        ? `<div class="workflow-grid workflow-grid-page">${workflows.map(renderWorkflowCard).join('')}</div>`
        : '<div class="empty-state">没有匹配到流程，试试切换筛选或新建一个流程。</div>'}
    </div>
  `;
}

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
          ${fieldItem('异步识图数量', `<input class="control-input" value="${escapeHtml(state.asyncVision.monitors.length)}" readonly />`)}
          ${fieldItem('共享变量', `<input class="control-input" value="${escapeHtml(state.asyncVision.sharedVariables.length)}" readonly />`)}
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
            <p>当前主界面聚焦在流程、流程编辑、异步识图和运行状态，说明信息统一收纳到这里。</p>
          </div>
        </div>
        <div class="note-group">
          <span class="action-chip">流程编排</span>
          <span class="action-chip">异步识图</span>
          <span class="action-chip">共享变量</span>
          <span class="action-chip">主题切换</span>
        </div>
      </article>
      <article class="workflow-card workspace-panel">
        <div class="panel-head compact">
          <div>
            <div class="eyebrow">Architecture</div>
            <h4>架构约定</h4>
          </div>
        </div>
        <div class="architecture-list">${architectureItems}</div>
      </article>
      <article class="workflow-card workspace-panel">
        <div class="panel-head compact">
          <div>
            <div class="eyebrow">Config</div>
            <h4>配置位置</h4>
          </div>
        </div>
        <ul class="guide-list">
          <li>流程编排数据保存在 <code>data/config.json</code> 的 <code>custom_workflows.flows</code>。</li>
          <li>异步识图配置保存在 <code>data/config.json</code> 的 <code>async_vision.monitors</code>。</li>
          <li>上传的模板图会写入 <code>assets/templates</code>，流程与异步识图都可复用。</li>
        </ul>
      </article>
    </div>
  `;
}

function renderAsyncMonitorCard(monitor) {
  const runtime = monitor.runtime ?? {};
  const status = String(runtime.status ?? (monitor.enabled ? 'idle' : 'disabled'));
  return `
    <article class="workflow-card">
      <div class="workflow-top">
        <div>
          <div class="badge-row">
            <span class="source-badge custom">异步识图</span>
            <span class="category-badge">${escapeHtml(asyncMonitorPresetLabel(monitor.preset))}</span>
            <span class="source-badge ${monitor.enabled ? 'trigger' : 'loop'}">${monitor.enabled ? '启用' : '停用'}</span>
          </div>
          <h4>${escapeHtml(monitor.name ?? monitor.monitor_id ?? '未命名识别')}</h4>
          <p>${escapeHtml(monitor.template_path ?? '')}</p>
        </div>
        <span class="runtime-badge ${escapeHtml(asyncMonitorStatusClass(status))}">${escapeHtml(asyncMonitorStatusLabel(status))}</span>
      </div>
      <div class="action-group">
        <span class="action-chip">变量：${escapeHtml(monitor.output_variable ?? 'target')}</span>
        <span class="action-chip">${escapeHtml(asyncSearchScopeLabel(monitor.search_scope))}</span>
        <span class="action-chip">${escapeHtml(asyncScanRateLabel(monitor.scan_rate))}</span>
      </div>
      <p class="runtime-message">${escapeHtml(runtime.message ?? '暂无识图结果。')}</p>
      <div class="runtime-meta">
        <span>没找到时：${escapeHtml(asyncNotFoundActionLabel(monitor.not_found_action))}</span>
        <span>匹配要求：${escapeHtml(asyncMatchModeLabel(monitor.match_mode))}</span>
        <span>刷新：${escapeHtml(monitor.effective_interval_ms ?? 350)}ms</span>
        <span>更新时间：${escapeHtml(formatAsyncUpdatedAt(runtime.updated_at))}</span>
      </div>
      <div class="card-actions">
        ${renderIconButton({ icon: 'edit', label: '编辑识别', onClick: `window.loadAsyncMonitorIntoEditor('${monitor.monitor_id}')` })}
        ${renderIconButton({ icon: 'delete-o', label: '删除识别', extraClass: 'danger-button', onClick: `window.deleteAsyncMonitor('${monitor.monitor_id}')` })}
      </div>
    </article>
  `;
}

function renderSharedVariablePanel() {
  const items = Array.isArray(state.asyncVision.sharedVariables) ? state.asyncVision.sharedVariables : [];
  const body = items.length
    ? `<div class="activity-list">${items.map((item) => {
        const meta = item._shared ?? {};
        const status = String(meta.status ?? 'idle');
        const point = item.found ? `(${item.x ?? '--'}, ${item.y ?? '--'})` : '未命中';
        return `
          <article class="activity-item">
            <header>
              <strong>${escapeHtml(item.output_variable ?? item.variable_name ?? 'target')}</strong>
              <span class="runtime-badge ${escapeHtml(asyncMonitorStatusClass(status))}">${escapeHtml(asyncMonitorStatusLabel(status))}</span>
            </header>
            <p>${escapeHtml(meta.monitor_name ?? '未绑定识别')} · ${escapeHtml(meta.message ?? '')}</p>
            <small>状态=${escapeHtml(item.found ? '已找到' : '未找到')} · 坐标=${escapeHtml(point)} · 过期=${escapeHtml(item.stale ? '是' : '否')} · 更新时间=${escapeHtml(formatAsyncUpdatedAt(meta.updated_at))}</small>
          </article>
        `;
      }).join('')}</div>`
    : '<div class="empty-state">暂无共享变量。保存并启用识别后会显示在这里。</div>';

  return `
    <article class="workflow-card">
      <div class="workflow-top">
        <div>
          <div class="badge-row">
            <span class="source-badge custom">共享变量</span>
          </div>
          <h4>异步识图输出</h4>
          <p>流程中的点击和分支步骤可以直接读取这些共享变量。</p>
        </div>
      </div>
      ${body}
    </article>
  `;
}

function renderAsyncMonitorList() {
  const monitors = Array.isArray(state.asyncVision.monitors) ? state.asyncVision.monitors : [];
  return monitors.length
    ? `<div class="workflow-grid workflow-grid-page">${monitors.map(renderAsyncMonitorCard).join('')}</div>`
    : '<div class="empty-state">当前还没有异步识图，先保存一个开始后台识图。</div>';
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
    window.alert('请先填写保存变量。');
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
    showToast(isEditingExisting ? '异步识图已更新。' : '异步识图已保存，可继续新建下一条。', 'success');
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

  if (!window.confirm(`确认删除异步识图「${monitor.name}」吗？`)) {
    return;
  }

  await client.delete_async_monitor(monitorId);
  if (state.asyncVision.editor?.monitor_id === monitorId) {
    state.asyncVision.editor = createEmptyAsyncMonitor();
  }
  await loadBootstrap();
  showToast('异步识图已删除。', 'success');
}

function renderWorkflows() {
  const container = document.getElementById('workflow-grid');
  if (!container) {
    return;
  }

  const editorOnly = state.activeTab === 'editor';
  container.hidden = editorOnly;
  if (editorOnly) {
    container.innerHTML = '';
    return;
  }

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
window.setTheme = setTheme;

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
