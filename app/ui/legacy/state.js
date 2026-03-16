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
  pushDesignerUndoSnapshot();
  setDesignerSaveStatus('dirty', '流程有未保存修改');
}

/* ── 撤销/重做 ── */
const _UNDO_MAX = 50;
const _undoStack = [];
let _redoStack = [];
let _lastSnapshotJson = '';

function _designerSnapshot() {
  return JSON.stringify(state.designer.steps);
}

function pushDesignerUndoSnapshot() {
  const snap = _designerSnapshot();
  if (snap === _lastSnapshotJson) return;
  _undoStack.push(_lastSnapshotJson);
  if (_undoStack.length > _UNDO_MAX) _undoStack.shift();
  _redoStack = [];
  _lastSnapshotJson = snap;
}

function resetDesignerUndoHistory() {
  _undoStack.length = 0;
  _redoStack = [];
  _lastSnapshotJson = _designerSnapshot();
}

function undoDesigner() {
  if (!_undoStack.length) return;
  _redoStack.push(_designerSnapshot());
  const prev = _undoStack.pop();
  _lastSnapshotJson = prev;
  try {
    state.designer.steps = JSON.parse(prev);
  } catch { return; }
  renderDesignerSteps();
  setDesignerSaveStatus('dirty', '已撤销');
}

function redoDesigner() {
  if (!_redoStack.length) return;
  _undoStack.push(_designerSnapshot());
  const next = _redoStack.pop();
  _lastSnapshotJson = next;
  try {
    state.designer.steps = JSON.parse(next);
  } catch { return; }
  renderDesignerSteps();
  setDesignerSaveStatus('dirty', '已重做');
}

function canUndo() { return _undoStack.length > 0; }
function canRedo() { return _redoStack.length > 0; }

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

