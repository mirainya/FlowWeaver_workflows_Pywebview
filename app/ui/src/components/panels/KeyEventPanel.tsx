import { useState } from 'react';
import { useAppStore } from '../../stores/app';

export default function KeyEventPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const { runtime } = useAppStore();
  const events = runtime.key_events ?? [];

  return (
    <section className={`panel glass collapsible-panel${collapsed ? ' collapsed' : ''}`}>
      <div
        className="panel-head compact clickable-head"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div><h3>按键记录</h3></div>
        <span className="collapse-indicator">▾</span>
      </div>
      <div className="collapsible-body">
        <div className="activity-list">
          {events.length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0' }}>暂无按键记录</div>
          ) : (
            events.slice(-20).reverse().map((ev, i) => (
              <div className="runtime-row" key={i}>
                <code style={{ fontSize: 12 }}>{ev.key}</code>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{ev.time}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
