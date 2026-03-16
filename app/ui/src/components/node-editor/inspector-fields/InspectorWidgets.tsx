import { useState, useCallback } from 'react';

export function InspectorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inspector-field">
      <label className="inspector-label">{label}</label>
      <input className="field-input" type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * Key capture input — listens for actual keydown events and records the key name
 * (e.g. "a", "enter", "ctrl+shift+a") instead of text input.
 */
export function InspectorKeyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const key = e.key;
    // Ignore standalone modifier keys
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    parts.push(key.toLowerCase());

    onChange(parts.join('+'));
  }, [onChange]);

  return (
    <div className="inspector-field">
      <label className="inspector-label">{label}</label>
      <input
        className="field-input"
        type="text"
        value={listening ? '按下按键...' : value}
        readOnly
        onFocus={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={handleKeyDown}
        style={listening ? { borderColor: 'var(--accent)', background: 'rgba(96,165,250,0.08)' } : undefined}
        placeholder="点击后按下按键"
      />
    </div>
  );
}

export function InspectorNumber({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="inspector-field">
      <label className="inspector-label">{label}</label>
      <input className="field-input" type="number" value={value} step={step} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </div>
  );
}

export function InspectorSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inspector-field">
      <label className="inspector-label">{label}</label>
      <select className="field-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </div>
  );
}

/* ── Array editor for points / sample_points ── */

interface ArrayField {
  key: string;
  label: string;
  type: 'text' | 'number';
}

interface ArrayItem { [key: string]: unknown }

interface InspectorArrayEditorProps {
  label: string;
  items: ArrayItem[];
  fields: ArrayField[];
  defaultItem: ArrayItem;
  onChange: (items: ArrayItem[]) => void;
}

export function InspectorArrayEditor({ label, items, fields, defaultItem, onChange }: InspectorArrayEditorProps) {
  const safeItems = Array.isArray(items) ? items : [];

  const updateItem = (index: number, key: string, value: unknown) => {
    const next = safeItems.map((item, i) => i === index ? { ...item, [key]: value } : item);
    onChange(next);
  };

  const addItem = () => onChange([...safeItems, { ...defaultItem }]);

  const removeItem = (index: number) => onChange(safeItems.filter((_, i) => i !== index));

  return (
    <div className="inspector-field inspector-array">
      <div className="inspector-array-header">
        <label className="inspector-label">{label} ({safeItems.length})</label>
        <button type="button" className="inspector-array-btn" onClick={addItem}>+ 添加</button>
      </div>
      {safeItems.map((item, i) => (
        <div key={i} className="inspector-array-row">
          <span className="inspector-array-index">#{i + 1}</span>
          {fields.map((f) => (
            <input
              key={f.key}
              className="field-input inspector-array-input"
              type={f.type}
              placeholder={f.label}
              title={f.label}
              value={f.type === 'number' ? Number(item[f.key] ?? 0) : String(item[f.key] ?? '')}
              onChange={(e) => updateItem(i, f.key, f.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
            />
          ))}
          <button type="button" className="inspector-array-btn inspector-array-btn-del" onClick={() => removeItem(i)}>×</button>
        </div>
      ))}
    </div>
  );
}
