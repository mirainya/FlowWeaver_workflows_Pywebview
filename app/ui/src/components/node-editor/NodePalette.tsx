import { useState } from 'react';
import { STEP_TYPE_GROUPS } from '../../models/step';
import { getKindColor } from './graph-utils';

export default function NodePalette() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (group: string) =>
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));

  const onDragStart = (e: React.DragEvent, kind: string) => {
    e.dataTransfer.setData('stepKind', kind);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="node-palette">
      <div className="node-palette-title">节点面板</div>

      {/* End node drag item */}
      <div className="node-palette-group" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="node-palette-items" style={{ padding: '8px' }}>
          <div
            className="node-palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, '__end__')}
          >
            <span className="node-palette-dot" style={{ background: '#ef4444' }} />
            <span>结束节点</span>
          </div>
        </div>
      </div>

      {STEP_TYPE_GROUPS.map((g) => (
        <div key={g.group} className="node-palette-group">
          <button
            className="node-palette-group-header"
            onClick={() => toggle(g.group)}
          >
            <span className={`node-palette-arrow ${collapsed[g.group] ? '' : 'open'}`}>▶</span>
            <span>{g.group}</span>
            <span className="node-palette-count">{g.items.length}</span>
          </button>
          {!collapsed[g.group] && (
            <div className="node-palette-items">
              {g.items.map((item) => {
                const color = getKindColor(item.key);
                return (
                  <div
                    key={item.key}
                    className="node-palette-item"
                    draggable
                    onDragStart={(e) => onDragStart(e, item.key)}
                  >
                    <span
                      className="node-palette-dot"
                      style={{ background: color }}
                    />
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
