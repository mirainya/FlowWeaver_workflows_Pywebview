/**
 * 屏幕区域截图覆盖层
 * 用于在截屏上框选区域，裁剪保存为模板图片。
 */

let _overlayState = null;

function _createOverlayDOM() {
  const overlay = document.createElement('div');
  overlay.id = 'capture-overlay';
  overlay.innerHTML = `
    <canvas id="capture-overlay-canvas"></canvas>
    <div class="capture-toolbar" id="capture-toolbar">
      <span class="capture-hint" id="capture-hint">拖拽框选区域</span>
      <span class="capture-size" id="capture-size"></span>
      <button class="ghost-button small-button" type="button" id="capture-confirm" disabled>确认裁剪</button>
      <button class="ghost-button small-button" type="button" id="capture-cancel">取消</button>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function _removeOverlay() {
  const el = document.getElementById('capture-overlay');
  if (el) {
    el.remove();
  }
  _overlayState = null;
}

function _drawOverlay() {
  const s = _overlayState;
  if (!s) return;
  const ctx = s.ctx;
  const canvas = s.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(s.img, 0, 0, canvas.width, canvas.height);

  if (s.rect) {
    // dim outside selection
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, s.rect.y);
    ctx.fillRect(0, s.rect.y, s.rect.x, s.rect.h);
    ctx.fillRect(s.rect.x + s.rect.w, s.rect.y, canvas.width - s.rect.x - s.rect.w, s.rect.h);
    ctx.fillRect(0, s.rect.y + s.rect.h, canvas.width, canvas.height - s.rect.y - s.rect.h);
    // selection border
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function _updateSizeLabel() {
  const s = _overlayState;
  if (!s) return;
  const sizeEl = document.getElementById('capture-size');
  const confirmBtn = document.getElementById('capture-confirm');
  const hintEl = document.getElementById('capture-hint');
  if (s.rect && s.rect.w > 2 && s.rect.h > 2) {
    const realW = Math.round(s.rect.w * s.scaleX);
    const realH = Math.round(s.rect.h * s.scaleY);
    if (sizeEl) sizeEl.textContent = `${realW} × ${realH}`;
    if (confirmBtn) confirmBtn.disabled = false;
    if (hintEl) hintEl.textContent = '已选区域';
  } else {
    if (sizeEl) sizeEl.textContent = '';
    if (confirmBtn) confirmBtn.disabled = true;
    if (hintEl) hintEl.textContent = '拖拽框选区域';
  }
}

function _normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

function _canvasCoords(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (e.clientX - r.left) * (canvas.width / r.width))),
    y: Math.max(0, Math.min(canvas.height, (e.clientY - r.top) * (canvas.height / r.height))),
  };
}

function _onMouseDown(e) {
  if (e.button !== 0) return;
  const s = _overlayState;
  if (!s) return;
  const p = _canvasCoords(e, s.canvas);
  s.dragging = true;
  s.startX = p.x;
  s.startY = p.y;
  s.rect = null;
  _drawOverlay();
  _updateSizeLabel();
}

function _onMouseMove(e) {
  const s = _overlayState;
  if (!s || !s.dragging) return;
  const p = _canvasCoords(e, s.canvas);
  s.rect = _normalizeRect(s.startX, s.startY, p.x, p.y);
  _drawOverlay();
  _updateSizeLabel();
}

function _onMouseUp(e) {
  const s = _overlayState;
  if (!s || !s.dragging) return;
  s.dragging = false;
  const p = _canvasCoords(e, s.canvas);
  s.rect = _normalizeRect(s.startX, s.startY, p.x, p.y);
  _drawOverlay();
  _updateSizeLabel();
}

function _onKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    _finishCapture(null);
  }
}

let _resolveCapture = null;

function _finishCapture(result) {
  document.removeEventListener('keydown', _onKeyDown, true);
  _removeOverlay();
  if (_resolveCapture) {
    _resolveCapture(result);
    _resolveCapture = null;
  }
}

async function _confirmCrop() {
  const s = _overlayState;
  if (!s || !s.rect || s.rect.w < 2 || s.rect.h < 2) return;

  const realLeft = Math.round(s.rect.x * s.scaleX);
  const realTop = Math.round(s.rect.y * s.scaleY);
  const realW = Math.round(s.rect.w * s.scaleX);
  const realH = Math.round(s.rect.h * s.scaleY);

  const confirmBtn = document.getElementById('capture-confirm');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '裁剪中…';
  }

  try {
    const client = api();
    if (!client?.crop_and_save_template) {
      throw new Error('当前版本不支持裁剪保存。');
    }
    const result = await client.crop_and_save_template({
      data_url: s.dataUrl,
      left: realLeft,
      top: realTop,
      width: realW,
      height: realH,
      filename: 'screen-crop',
    });
    if (!result?.ok) {
      throw new Error(result?.error || '裁剪保存失败。');
    }
    _finishCapture(result.template_path || '');
  } catch (err) {
    window.alert(`裁剪失败：${err}`);
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认裁剪';
    }
  }
}

/**
 * 打开截图覆盖层，返回 Promise<string|null>
 * 成功返回模板路径，取消返回 null
 */
async function openCaptureOverlay() {
  if (_overlayState) return null;

  const client = api();
  if (!client?.capture_screen_for_crop) {
    throw new Error('当前版本不支持屏幕截图。');
  }

  const snap = await client.capture_screen_for_crop();
  if (!snap?.ok) {
    throw new Error(snap?.error || '截屏失败。');
  }

  return new Promise((resolve) => {
    _resolveCapture = resolve;

    const overlay = _createOverlayDOM();
    const canvas = document.getElementById('capture-overlay-canvas');
    const ctx = canvas.getContext('2d');

    const img = new window.Image();
    img.onload = () => {
      const maxW = window.innerWidth;
      const maxH = window.innerHeight - 48;
      let dispW = img.naturalWidth;
      let dispH = img.naturalHeight;
      const ratio = Math.min(maxW / dispW, maxH / dispH, 1);
      dispW = Math.round(dispW * ratio);
      dispH = Math.round(dispH * ratio);

      canvas.width = dispW;
      canvas.height = dispH;
      canvas.style.width = dispW + 'px';
      canvas.style.height = dispH + 'px';

      _overlayState = {
        canvas, ctx, img, overlay,
        dataUrl: snap.data_url,
        scaleX: img.naturalWidth / dispW,
        scaleY: img.naturalHeight / dispH,
        rect: null,
        dragging: false,
        startX: 0, startY: 0,
      };

      _drawOverlay();
      _updateSizeLabel();

      canvas.addEventListener('mousedown', _onMouseDown);
      canvas.addEventListener('mousemove', _onMouseMove);
      canvas.addEventListener('mouseup', _onMouseUp);
      document.addEventListener('keydown', _onKeyDown, true);

      document.getElementById('capture-confirm').addEventListener('click', _confirmCrop);
      document.getElementById('capture-cancel').addEventListener('click', () => _finishCapture(null));
    };
    img.src = snap.data_url;
  });
}

window.openCaptureOverlay = openCaptureOverlay;

/**
 * 打开截图覆盖层（区域选择模式），返回 Promise<{left,top,width,height}|null>
 * 只返回选区坐标，不裁剪保存。
 */
async function openRegionSelectOverlay() {
  if (_overlayState) return null;

  const client = api();
  if (!client?.capture_screen_for_crop) {
    throw new Error('当前版本不支持屏幕截图。');
  }

  const snap = await client.capture_screen_for_crop();
  if (!snap?.ok) {
    throw new Error(snap?.error || '截屏失败。');
  }

  return new Promise((resolve) => {
    _resolveCapture = resolve;

    const overlay = _createOverlayDOM();
    const canvas = document.getElementById('capture-overlay-canvas');
    const ctx = canvas.getContext('2d');
    const confirmBtn = document.getElementById('capture-confirm');
    if (confirmBtn) confirmBtn.textContent = '确认区域';

    const img = new window.Image();
    img.onload = () => {
      const maxW = window.innerWidth;
      const maxH = window.innerHeight - 48;
      let dispW = img.naturalWidth;
      let dispH = img.naturalHeight;
      const ratio = Math.min(maxW / dispW, maxH / dispH, 1);
      dispW = Math.round(dispW * ratio);
      dispH = Math.round(dispH * ratio);

      canvas.width = dispW;
      canvas.height = dispH;
      canvas.style.width = dispW + 'px';
      canvas.style.height = dispH + 'px';

      _overlayState = {
        canvas, ctx, img, overlay,
        dataUrl: snap.data_url,
        scaleX: img.naturalWidth / dispW,
        scaleY: img.naturalHeight / dispH,
        rect: null,
        dragging: false,
        startX: 0, startY: 0,
        regionMode: true,
      };

      _drawOverlay();
      _updateSizeLabel();

      canvas.addEventListener('mousedown', _onMouseDown);
      canvas.addEventListener('mousemove', _onMouseMove);
      canvas.addEventListener('mouseup', _onMouseUp);
      document.addEventListener('keydown', _onKeyDown, true);

      confirmBtn.addEventListener('click', _confirmRegion);
      document.getElementById('capture-cancel').addEventListener('click', () => _finishCapture(null));
    };
    img.src = snap.data_url;
  });
}

function _confirmRegion() {
  const s = _overlayState;
  if (!s || !s.rect || s.rect.w < 2 || s.rect.h < 2) return;
  _finishCapture({
    left: Math.round(s.rect.x * s.scaleX),
    top: Math.round(s.rect.y * s.scaleY),
    width: Math.round(s.rect.w * s.scaleX),
    height: Math.round(s.rect.h * s.scaleY),
  });
}

window.openRegionSelectOverlay = openRegionSelectOverlay;

async function captureTemplateForStep(stepPath) {
  try {
    const templatePath = await openCaptureOverlay();
    if (!templatePath) return;
    window.updateStepField(stepPath, 'template_path', templatePath);
    renderDesignerSteps();
    showToast('模板图已从截屏裁剪保存。', 'success');
  } catch (err) {
    window.alert(`截图裁剪失败：${err}`);
  }
}
window.captureTemplateForStep = captureTemplateForStep;

async function captureTemplateForAsyncMonitor() {
  try {
    const templatePath = await openCaptureOverlay();
    if (!templatePath) return;
    updateAsyncMonitorField('template_path', templatePath);
    const input = document.getElementById('async-monitor-template-path');
    if (input instanceof HTMLInputElement) {
      input.value = templatePath;
    }
    showToast('模板图已从截屏裁剪保存。', 'success');
  } catch (err) {
    window.alert(`截图裁剪失败：${err}`);
  }
}
window.captureTemplateForAsyncMonitor = captureTemplateForAsyncMonitor;
