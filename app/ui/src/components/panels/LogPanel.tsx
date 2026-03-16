import { useState } from 'react';
import { useAppStore } from '../../stores/app';

export default function LogPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const { logs } = useAppStore();

  return (
    <section className={`panel glass collapsible-panel${collapsed ? ' collapsed' : ''}`}>
      <div
        className="panel-head compact clickable-head"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div><h3>运行日志</h3></div>
        <span className="collapse-indicator">▾</span>
      </div>
      <div className="collapsible-body">
        <div className="log-list">
          {logs.length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0' }}>暂无日志</div>
          ) : (
            logs.slice(-30).reverse().map((log, i) => (
              <div className="runtime-row" key={i}>
                <span style={{ fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)', marginRight: 8 }}>{log.timestamp}</span>
                  <span style={{ color: log.level === 'ERROR' ? 'var(--danger)' : 'var(--text)' }}>
                    {log.message}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
