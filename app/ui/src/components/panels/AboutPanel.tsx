import { useAppStore } from '../../stores/app';

export default function AboutPanel() {
  const { appInfo, architecture } = useAppStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h4 style={{ margin: '0 0 4px', fontSize: 14 }}>版本</h4>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{appInfo.version}</p>
      </div>
      <div>
        <h4 style={{ margin: '0 0 4px', fontSize: 14 }}>流程来源</h4>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{appInfo.workflow_source}</p>
      </div>
      {architecture.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>设计说明</h4>
          {architecture.map((item, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{item.title}</strong>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)' }}>{item.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
