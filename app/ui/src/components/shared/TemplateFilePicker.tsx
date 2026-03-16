import { useState } from 'react';
import { api } from '../../api/bridge';

interface Props {
  value: string;
  onChange: (path: string) => void;
  label?: string;
}

export default function TemplateFilePicker({ value, onChange, label = '模板路径' }: Props) {
  const [picking, setPicking] = useState(false);

  const handlePick = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const result = await api.pickTemplateImage();
      if (result.template_path) {
        onChange(result.template_path);
      }
    } catch {
      // user cancelled or error — ignore
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="field-cell template-file-picker">
      <label className="field-cell-label">{label}</label>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          className="field-input"
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="模板图片路径"
          style={{ flex: 1 }}
        />
        <button
          className="ghost-button"
          type="button"
          onClick={handlePick}
          disabled={picking}
          style={{ whiteSpace: 'nowrap', fontSize: 12 }}
        >
          {picking ? '选择中…' : '浏览'}
        </button>
      </div>
    </div>
  );
}
