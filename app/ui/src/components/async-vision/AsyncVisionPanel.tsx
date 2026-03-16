import { useState } from 'react';
import { useAppStore } from '../../stores/app';
import { api } from '../../api/bridge';
import type { AsyncMonitor, MatchType } from '../../models/async-vision';
import { createEmptyAsyncMonitor, normalizeAsyncMonitor } from '../../models/async-vision';

/* ── Presets ── */

const PRESETS: { key: string; label: string; desc: string; patch: Partial<AsyncMonitor> }[] = [
  { key: 'fixed_button', label: '固定按钮', desc: '按钮位置固定，用模板匹配', patch: { match_type: 'template', search_scope: 'fixed_region', scan_rate: 500, follow_radius: 0 } },
  { key: 'popup_confirm', label: '弹窗确认', desc: '弹窗可能出现在任意位置', patch: { match_type: 'template', search_scope: 'full_screen', scan_rate: 800, follow_radius: 0 } },
  { key: 'moving_target', label: '移动目标', desc: '目标会移动，需要跟踪', patch: { match_type: 'template', search_scope: 'fixed_region', scan_rate: 300, follow_radius: 80 } },
  { key: 'status_check', label: '状态检测', desc: '检测像素颜色判断状态', patch: { match_type: 'pixel', search_scope: 'fixed_region', scan_rate: 500 } },
  { key: 'custom', label: '自定义', desc: '完全自定义配置', patch: {} },
];

const MATCH_TYPES: [MatchType, string][] = [
  ['template', '模板匹配'],
  ['pixel', '多点像素'],
  ['region_color', '区域颜色占比'],
  ['hsv', 'HSV颜色区域'],
  ['fingerprint', '特征指纹'],
];

export default function AsyncVisionPanel() {
  const { asyncMonitors, showToast, loadBootstrap } = useAppStore();
  const [editor, setEditor] = useState<AsyncMonitor | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  function startNew() {
    setEditor(createEmptyAsyncMonitor());
    setTestResult(null);
  }

  function startEdit(m: AsyncMonitor) {
    setEditor({ ...m });
    setTestResult(null);
  }

  function closeEditor() {
    setEditor(null);
    setTestResult(null);
  }

  function updateField<K extends keyof AsyncMonitor>(field: K, value: AsyncMonitor[K]) {
    setEditor((prev) => prev ? { ...prev, [field]: value } : prev);
  }

  function applyPreset(key: string) {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset || !editor) return;
    setEditor({ ...editor, preset: key, ...preset.patch });
  }

  async function handleSave() {
    if (!editor) return;
    if (!editor.name.trim()) { showToast('请填写名称', 'error'); return; }
    if (!editor.output_variable.trim()) { showToast('请填写输出变量名', 'error'); return; }

    setSaving(true);
    try {
      const result = await api.saveAsyncMonitor(editor as unknown as Record<string, unknown>);
      if (result.ok) {
        showToast('后台识图已保存', 'success');
        await loadBootstrap();
        closeEditor();
      } else {
        showToast(result.error ?? '保存失败', 'error');
      }
    } catch (err) {
      showToast(`保存失败：${err}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(monitorId: string) {
    if (!confirm('确定要删除这个后台识图配置吗？')) return;
    try {
      await api.deleteAsyncMonitor(monitorId);
      showToast('已删除', 'success');
      await loadBootstrap();
      if (editor?.monitor_id === monitorId) closeEditor();
    } catch (err) {
      showToast(`删除失败：${err}`, 'error');
    }
  }

  async function handleTestMatch() {
    if (!editor) return;
    setTestResult('测试中…');
    try {
      const result = await api.testTemplateMatch(editor as unknown as Record<string, unknown>);
      if (result.ok) {
        setTestResult(result.found
          ? `找到！位置 (${result.x}, ${result.y}) 置信度 ${(result.confidence ?? 0).toFixed(3)}`
          : '未找到匹配');
      } else {
        setTestResult(result.error ?? '测试失败');
      }
    } catch (err) {
      setTestResult(`测试失败：${err}`);
    }
  }

  async function handlePickTemplate() {
    try {
      const result = await api.pickTemplateImage();
      if (result.ok && result.template_path) {
        updateField('template_path', result.template_path);
        showToast('模板已选择', 'success');
      }
    } catch (err) {
      showToast(`选择失败：${err}`, 'error');
    }
  }

  return (
    <div>
      {/* Editor */}
      {editor && (
        <div className="async-editor glass" style={{ marginBottom: 16 }}>
          <div className="panel-head compact">
            <h4>{editor.monitor_id ? '编辑识图' : '新建识图'}</h4>
            <div className="panel-actions">
              <button className="primary-button" onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
              <button className="ghost-button" onClick={closeEditor}>取消</button>
            </div>
          </div>

          {/* Preset */}
          <div className="async-editor-section">
            <label className="field-label" style={{ width: 'auto', marginBottom: 6 }}>预设场景</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={editor.preset === p.key ? 'primary-button' : 'ghost-button'}
                  onClick={() => applyPreset(p.key)}
                  title={p.desc}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Basic fields */}
          <div className="async-editor-fields">
            <EditorField label="名称" value={editor.name} onChange={(v) => updateField('name', v)} placeholder="如：确认按钮" />
            <EditorField label="输出变量" value={editor.output_variable} onChange={(v) => updateField('output_variable', v)} placeholder="如：confirm_btn" />
            <div className="field-row">
              <label className="field-label">启用</label>
              <input type="checkbox" checked={editor.enabled} onChange={(e) => updateField('enabled', e.target.checked)} />
            </div>
            <div className="field-row">
              <label className="field-label">匹配类型</label>
              <select className="field-input" value={editor.match_type} onChange={(e) => updateField('match_type', e.target.value as MatchType)}>
                {MATCH_TYPES.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">查找范围</label>
              <select className="field-input" value={editor.search_scope} onChange={(e) => updateField('search_scope', e.target.value as 'full_screen' | 'fixed_region')}>
                <option value="full_screen">全屏</option>
                <option value="fixed_region">固定区域</option>
              </select>
            </div>

            {editor.search_scope === 'fixed_region' && (
              <div className="field-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <label className="field-label">固定区域</label>
                <EditorNumber label="X" value={editor.fixed_region.x} onChange={(v) => updateField('fixed_region', { ...editor.fixed_region, x: v })} />
                <EditorNumber label="Y" value={editor.fixed_region.y} onChange={(v) => updateField('fixed_region', { ...editor.fixed_region, y: v })} />
                <EditorNumber label="W" value={editor.fixed_region.w} onChange={(v) => updateField('fixed_region', { ...editor.fixed_region, w: v })} />
                <EditorNumber label="H" value={editor.fixed_region.h} onChange={(v) => updateField('fixed_region', { ...editor.fixed_region, h: v })} />
              </div>
            )}

            <EditorNumberRow label="扫描间隔(ms)" value={editor.scan_rate} onChange={(v) => updateField('scan_rate', v)} />
            <div className="field-row">
              <label className="field-label">未找到时</label>
              <select className="field-input" value={editor.not_found_action} onChange={(e) => updateField('not_found_action', e.target.value as 'clear' | 'keep_last')}>
                <option value="clear">清除变量</option>
                <option value="keep_last">保留上次</option>
              </select>
            </div>
            <EditorNumberRow label="跟踪半径" value={editor.follow_radius} onChange={(v) => updateField('follow_radius', v)} />
            <EditorNumberRow label="恢复次数" value={editor.recover_after_misses} onChange={(v) => updateField('recover_after_misses', v)} />
            <EditorNumberRow label="过期时间(ms)" value={editor.stale_after_ms} onChange={(v) => updateField('stale_after_ms', v)} />
          </div>

          {/* Template-specific */}
          {editor.match_type === 'template' && (
            <div className="async-editor-section">
              <h5 style={{ margin: '0 0 8px', fontSize: 13 }}>模板匹配配置</h5>
              <EditorField label="模板路径" value={editor.template_path} onChange={(v) => updateField('template_path', v)} placeholder="模板图片路径" />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="ghost-button" onClick={handlePickTemplate}>选择图片</button>
                <button className="ghost-button" onClick={handleTestMatch}>测试匹配</button>
              </div>
              <div className="field-row">
                <label className="field-label">匹配模式</label>
                <select className="field-input" value={editor.match_mode} onChange={(e) => updateField('match_mode', e.target.value as 'default' | 'custom_confidence')}>
                  <option value="default">默认</option>
                  <option value="custom_confidence">自定义置信度</option>
                </select>
              </div>
              {editor.match_mode === 'custom_confidence' && (
                <EditorNumberRow label="置信度" value={editor.custom_confidence} onChange={(v) => updateField('custom_confidence', v)} step={0.01} />
              )}
              {testResult && (
                <div className="toast-banner info" style={{ marginTop: 8 }}>{testResult}</div>
              )}
            </div>
          )}

          {/* Pixel-specific */}
          {editor.match_type === 'pixel' && (
            <div className="async-editor-section">
              <h5 style={{ margin: '0 0 8px', fontSize: 13 }}>多点像素检测配置</h5>
              <div className="field-row">
                <label className="field-label">判断逻辑</label>
                <select className="field-input" value={editor.pixel_logic} onChange={(e) => updateField('pixel_logic', e.target.value as 'all' | 'any')}>
                  <option value="all">全部匹配</option>
                  <option value="any">任一匹配</option>
                </select>
              </div>
              <PixelPointList
                points={editor.pixel_points}
                onChange={(pts) => updateField('pixel_points', pts)}
              />
            </div>
          )}

          {/* Region color */}
          {editor.match_type === 'region_color' && (
            <div className="async-editor-section">
              <h5 style={{ margin: '0 0 8px', fontSize: 13 }}>区域颜色占比配置</h5>
              <EditorField label="期望颜色" value={editor.region_color_config.target_color} onChange={(v) => updateField('region_color_config', { ...editor.region_color_config, target_color: v })} placeholder="#FF0000" />
              <EditorNumberRow label="颜色容差" value={editor.region_color_config.tolerance} onChange={(v) => updateField('region_color_config', { ...editor.region_color_config, tolerance: v })} />
              <EditorNumberRow label="最低占比" value={editor.region_color_config.min_ratio} onChange={(v) => updateField('region_color_config', { ...editor.region_color_config, min_ratio: v })} step={0.01} />
            </div>
          )}

          {/* HSV */}
          {editor.match_type === 'hsv' && (
            <div className="async-editor-section">
              <h5 style={{ margin: '0 0 8px', fontSize: 13 }}>HSV颜色区域配置</h5>
              <EditorNumberRow label="H 最小" value={editor.hsv_config.hsv_lower[0]} onChange={(v) => updateField('hsv_config', { ...editor.hsv_config, hsv_lower: [v, editor.hsv_config.hsv_lower[1], editor.hsv_config.hsv_lower[2]] })} />
              <EditorNumberRow label="H 最大" value={editor.hsv_config.hsv_upper[0]} onChange={(v) => updateField('hsv_config', { ...editor.hsv_config, hsv_upper: [v, editor.hsv_config.hsv_upper[1], editor.hsv_config.hsv_upper[2]] })} />
              <EditorNumberRow label="S 最小" value={editor.hsv_config.hsv_lower[1]} onChange={(v) => updateField('hsv_config', { ...editor.hsv_config, hsv_lower: [editor.hsv_config.hsv_lower[0], v, editor.hsv_config.hsv_lower[2]] })} />
              <EditorNumberRow label="S 最大" value={editor.hsv_config.hsv_upper[1]} onChange={(v) => updateField('hsv_config', { ...editor.hsv_config, hsv_upper: [editor.hsv_config.hsv_upper[0], v, editor.hsv_config.hsv_upper[2]] })} />
              <EditorNumberRow label="V 最小" value={editor.hsv_config.hsv_lower[2]} onChange={(v) => updateField('hsv_config', { ...editor.hsv_config, hsv_lower: [editor.hsv_config.hsv_lower[0], editor.hsv_config.hsv_lower[1], v] })} />
              <EditorNumberRow label="V 最大" value={editor.hsv_config.hsv_upper[2]} onChange={(v) => updateField('hsv_config', { ...editor.hsv_config, hsv_upper: [editor.hsv_config.hsv_upper[0], editor.hsv_config.hsv_upper[1], v] })} />
              <EditorNumberRow label="最小面积" value={editor.hsv_config.min_area} onChange={(v) => updateField('hsv_config', { ...editor.hsv_config, min_area: v })} />
            </div>
          )}

          {/* Fingerprint */}
          {editor.match_type === 'fingerprint' && (
            <div className="async-editor-section">
              <h5 style={{ margin: '0 0 8px', fontSize: 13 }}>特征指纹配置</h5>
              <EditorNumberRow label="锚点 X" value={editor.fingerprint_config.anchor_x} onChange={(v) => updateField('fingerprint_config', { ...editor.fingerprint_config, anchor_x: v })} />
              <EditorNumberRow label="锚点 Y" value={editor.fingerprint_config.anchor_y} onChange={(v) => updateField('fingerprint_config', { ...editor.fingerprint_config, anchor_y: v })} />
              <EditorNumberRow label="颜色容差" value={editor.fingerprint_config.tolerance} onChange={(v) => updateField('fingerprint_config', { ...editor.fingerprint_config, tolerance: v })} />
              <FingerprintPointList
                points={editor.fingerprint_config.sample_points}
                onChange={(pts) => updateField('fingerprint_config', { ...editor.fingerprint_config, sample_points: pts })}
              />
            </div>
          )}
        </div>
      )}

      {/* New button */}
      {!editor && (
        <div style={{ marginBottom: 12 }}>
          <button className="primary-button" onClick={startNew}>+ 新建后台识图</button>
        </div>
      )}

      {/* Monitor list */}
      {asyncMonitors.length === 0 && !editor ? (
        <div className="empty-state">暂无后台识图配置</div>
      ) : (
        <div className="async-monitor-list">
          {asyncMonitors.map((m) => (
            <article className="monitor-card glass" key={m.monitor_id}>
              <div className="monitor-card-head">
                <strong>{m.name}</strong>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`runtime-badge ${m.enabled ? 'running' : 'idle'}`}>
                    {m.enabled ? '启用' : '停用'}
                  </span>
                  <button className="ghost-button icon-button" onClick={() => startEdit(m)}>编辑</button>
                  <button className="ghost-button icon-button danger" onClick={() => handleDelete(m.monitor_id)}>删除</button>
                </div>
              </div>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
                输出: {m.output_variable} · 类型: {MATCH_TYPES.find(([k]) => k === m.match_type)?.[1] ?? m.match_type} · 间隔: {m.scan_rate}ms
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Reusable field components ── */

function EditorField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="field-row">
      <label className="field-label">{label}</label>
      <input className="field-input" type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function EditorNumberRow({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="field-row">
      <label className="field-label">{label}</label>
      <input className="field-input" type="number" value={value ?? 0} step={step} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </div>
  );
}

function EditorNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field-cell" style={{ minWidth: 60 }}>
      <label className="field-cell-label">{label}</label>
      <input className="field-input" type="number" value={value ?? 0} onChange={(e) => onChange(parseInt(e.target.value) || 0)} style={{ width: 70 }} />
    </div>
  );
}

/* ── Pixel point list ── */

interface PixelPoint { x: number; y: number; expected_color: string; tolerance: number }

function PixelPointList({ points, onChange }: { points: PixelPoint[]; onChange: (pts: PixelPoint[]) => void }) {
  function addPoint() {
    onChange([...points, { x: 0, y: 0, expected_color: '', tolerance: 20 }]);
  }
  function removePoint(i: number) {
    onChange(points.filter((_, idx) => idx !== i));
  }
  function updatePoint(i: number, field: keyof PixelPoint, value: unknown) {
    const updated = [...points];
    updated[i] = { ...updated[i], [field]: value };
    onChange(updated);
  }

  return (
    <div>
      {points.map((pt, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 20 }}>#{i + 1}</span>
          <input className="field-input" type="number" value={pt.x} onChange={(e) => updatePoint(i, 'x', parseInt(e.target.value) || 0)} style={{ width: 60 }} placeholder="X" />
          <input className="field-input" type="number" value={pt.y} onChange={(e) => updatePoint(i, 'y', parseInt(e.target.value) || 0)} style={{ width: 60 }} placeholder="Y" />
          <input className="field-input" value={pt.expected_color} onChange={(e) => updatePoint(i, 'expected_color', e.target.value)} style={{ width: 80 }} placeholder="#FF0000" />
          <input className="field-input" type="number" value={pt.tolerance} onChange={(e) => updatePoint(i, 'tolerance', parseInt(e.target.value) || 0)} style={{ width: 50 }} placeholder="容差" />
          <button className="ghost-button icon-button danger" onClick={() => removePoint(i)}>×</button>
        </div>
      ))}
      <button className="ghost-button" onClick={addPoint} style={{ marginTop: 4 }}>+ 添加检测点</button>
    </div>
  );
}

/* ── Fingerprint point list ── */

interface FpPoint { dx: number; dy: number; expected_color: string }

function FingerprintPointList({ points, onChange }: { points: FpPoint[]; onChange: (pts: FpPoint[]) => void }) {
  function addPoint() {
    onChange([...points, { dx: 0, dy: 0, expected_color: '' }]);
  }
  function removePoint(i: number) {
    onChange(points.filter((_, idx) => idx !== i));
  }
  function updatePoint(i: number, field: keyof FpPoint, value: unknown) {
    const updated = [...points];
    updated[i] = { ...updated[i], [field]: value };
    onChange(updated);
  }

  return (
    <div>
      {points.map((pt, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 20 }}>#{i + 1}</span>
          <input className="field-input" type="number" value={pt.dx} onChange={(e) => updatePoint(i, 'dx', parseInt(e.target.value) || 0)} style={{ width: 60 }} placeholder="dx" />
          <input className="field-input" type="number" value={pt.dy} onChange={(e) => updatePoint(i, 'dy', parseInt(e.target.value) || 0)} style={{ width: 60 }} placeholder="dy" />
          <input className="field-input" value={pt.expected_color} onChange={(e) => updatePoint(i, 'expected_color', e.target.value)} style={{ width: 80 }} placeholder="#FF0000" />
          <button className="ghost-button icon-button danger" onClick={() => removePoint(i)}>×</button>
        </div>
      ))}
      <button className="ghost-button" onClick={addPoint} style={{ marginTop: 4 }}>+ 添加采样点</button>
    </div>
  );
}
