const STEP_TYPE_GROUPS = [
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

const STEP_TYPES = STEP_TYPE_GROUPS.flatMap((g) => g.items);

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
    key: 'async_vision',
    label: '后台识图',
    description: '后台持续识图，并把结果写入共享数据。',
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
  flowViewMode: 'card',
  flowSort: 'name',
  flowGroupBy: '',
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
  designerCollapsed: false,
  collapsedSteps: new Set(),
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
