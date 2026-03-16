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

