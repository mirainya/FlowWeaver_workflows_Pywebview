import { useDesignerStore, type SaveStatus } from '../../stores/designer';
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { api } from '../../api/bridge';
import { InspectorKeyInput } from '../node-editor/inspector-fields/InspectorWidgets';

const NodeEditorPanel = lazy(() => import('../node-editor/NodeEditorPanel'));

const SAVE_STATUS_MAP: Record<SaveStatus, { label: string; text: string }> = {
  idle: { label: '未修改', text: '当前内容与已保存版本一致' },
  dirty: { label: '待保存', text: '流程已有修改，请记得保存' },
  saving: { label: '保存中', text: '正在保存流程配置…' },
  saved: { label: '已保存', text: '保存成功' },
  error: { label: '保存失败', text: '保存未成功，请重试' },
};

export default function DesignerPanel() {
  const {
    designer, saveState, isOpen,
    closeDesigner, updateField, updateRunMode, updateRunCount,
    saveFlow, resetDesigner, undo, redo, canUndo, canRedo,
  } = useDesignerStore();
  const hotkeyCaptureActiveRef = useRef(false);

  const endHotkeyCapture = useCallback(async () => {
    if (!hotkeyCaptureActiveRef.current) return;
    hotkeyCaptureActiveRef.current = false;
    try {
      await api.endKeyCapture();
    } catch {
      // noop
    }
  }, []);

  const beginHotkeyCapture = useCallback(async () => {
    if (hotkeyCaptureActiveRef.current) return;
    hotkeyCaptureActiveRef.current = true;
    try {
      await api.beginKeyCapture();
    } catch {
      hotkeyCaptureActiveRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      void endHotkeyCapture();
    }
  }, [endHotkeyCapture, isOpen]);

  useEffect(() => {
    return () => {
      void endHotkeyCapture();
    };
  }, [endHotkeyCapture]);

  if (!isOpen) return null;

  const statusInfo = SAVE_STATUS_MAP[saveState.status] ?? SAVE_STATUS_MAP.idle;
  const isNew = !designer.workflow_id;

  return (
    <section className="designer-panel glass">
      <div className="designer-head">
        <div className="designer-title-group">
          <h4>{isNew ? '新建流程' : '编辑流程'}</h4>
          <p className="subtle">配置热键、运行模式和节点图。</p>
        </div>
        <div className="designer-head-side">
          <div className="designer-status">
            <span className={`status-badge ${saveState.status}`}>{statusInfo.label}</span>
            <span className="status-text">{saveState.message || statusInfo.text}</span>
          </div>
          <div className="designer-head-actions">
            <button className="ghost-button" type="button" onClick={undo} disabled={!canUndo()}>撤销</button>
            <button className="ghost-button" type="button" onClick={redo} disabled={!canRedo()}>前进</button>
            <button className="ghost-button" type="button" onClick={resetDesigner}>重置</button>
            <button className="primary-button" type="button" onClick={saveFlow}>保存</button>
            <button className="ghost-button" type="button" onClick={closeDesigner}>关闭</button>
          </div>
        </div>
      </div>

      <div className="designer-body">
        {/* Basic fields - inline row */}
        <div className="designer-fields-inline">
          <div className="field-inline">
            <label className="field-inline-label">名称</label>
            <input
              className="field-input"
              type="text"
              value={designer.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="流程名称"
            />
          </div>
          <InspectorKeyInput
            label="热键"
            wrapperClassName="field-inline"
            className="field-input field-input-short"
            value={designer.hotkey}
            onChange={(value) => updateField('hotkey', value)}
            onFocus={() => {
              void beginHotkeyCapture();
            }}
            onBlur={() => {
              void endHotkeyCapture();
            }}
          />
          <div className="field-inline">
            <label className="field-inline-label">说明</label>
            <input
              className="field-input"
              type="text"
              value={designer.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="流程说明"
            />
          </div>
          <div className="field-inline field-inline-check">
            <label className="field-inline-label">启用</label>
            <input
              type="checkbox"
              checked={designer.enabled}
              onChange={(e) => updateField('enabled', e.target.checked)}
            />
          </div>
          <div className="field-inline">
            <label className="field-inline-label">运行</label>
            <select
              className="field-input field-input-short"
              value={designer.run_mode.type}
              onChange={(e) => updateRunMode(e.target.value)}
            >
              <option value="once">执行一次</option>
              <option value="repeat_n">重复N次</option>
              <option value="toggle_loop">切换循环</option>
            </select>
          </div>
          {designer.run_mode.type === 'repeat_n' && (
            <div className="field-inline">
              <label className="field-inline-label">次数</label>
              <input
                className="field-input field-input-short"
                type="number"
                min={1}
                value={designer.run_mode.count ?? 1}
                onChange={(e) => updateRunCount(parseInt(e.target.value) || 1)}
              />
            </div>
          )}
        </div>

        <Suspense fallback={<div className="empty-state">加载节点编辑器…</div>}>
          <NodeEditorPanel />
        </Suspense>
      </div>
    </section>
  );
}
