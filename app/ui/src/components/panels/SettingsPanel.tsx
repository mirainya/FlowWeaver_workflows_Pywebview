import { useAppStore, type Theme } from '../../stores/app';

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'dark', label: '深蓝' },
  { value: 'graphite', label: '石墨' },
  { value: 'light', label: '浅色' },
];

export default function SettingsPanel() {
  const { theme, setTheme } = useAppStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>主题</h4>
        <div style={{ display: 'flex', gap: 8 }}>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={theme === opt.value ? 'primary-button' : 'ghost-button'}
              onClick={() => setTheme(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
