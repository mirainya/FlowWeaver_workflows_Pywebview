import { useEffect, useRef, useState } from 'react';
import { STEP_TYPE_GROUPS } from '../../models/step';
import { getKindColor } from './graph-utils';

interface ContextMenuProps {
  x: number;
  y: number;
  type: 'node' | 'pane';
  nodeId?: string;
  isProtected?: boolean;
  onClose: () => void;
  onDelete?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onSelect?: (nodeId: string) => void;
  onAddNode?: (kind: string, position: { x: number; y: number }) => void;
  onPaste?: (position: { x: number; y: number }) => void;
  onFitView?: () => void;
  hasClipboard?: boolean;
}

export default function ContextMenu({
  x, y, type, nodeId, isProtected,
  onClose, onDelete, onDuplicate, onSelect,
  onAddNode, onPaste, onFitView, hasClipboard,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [subOpen, setSubOpen] = useState(false);
  const [pos, setPos] = useState({ x, y });

  /* 边界修正 */
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x, ny = y;
    if (rect.right > window.innerWidth) nx = window.innerWidth - rect.width - 4;
    if (rect.bottom > window.innerHeight) ny = window.innerHeight - rect.height - 4;
    if (nx < 0) nx = 4;
    if (ny < 0) ny = 4;
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  /* 点击外部关闭 */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const flowPos = { x, y };

  if (type === 'node' && nodeId) {
    return (
      <div className="context-menu" ref={menuRef} style={{ left: pos.x, top: pos.y }}>
        {!isProtected && (
          <button
            className="context-menu-item"
            onClick={() => { onSelect?.(nodeId); onClose(); }}
          >
            编辑属性
          </button>
        )}
        {!isProtected && (
          <button
            className="context-menu-item"
            onClick={() => { onDuplicate?.(nodeId); onClose(); }}
          >
            复制节点
          </button>
        )}
        {!isProtected && <div className="context-menu-separator" />}
        {!isProtected && (
          <button
            className="context-menu-item danger"
            onClick={() => { onDelete?.(nodeId); onClose(); }}
          >
            删除节点
          </button>
        )}
        {isProtected && (
          <button className="context-menu-item" disabled>
            开始节点不可操作
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="context-menu" ref={menuRef} style={{ left: pos.x, top: pos.y }}>
      <button
        className="context-menu-item"
        disabled={!hasClipboard}
        onClick={() => { onPaste?.(flowPos); onClose(); }}
      >
        粘贴节点
      </button>
      <div className="context-menu-separator" />
      <div
        className="context-menu-sub-wrap"
        onMouseEnter={() => setSubOpen(true)}
        onMouseLeave={() => setSubOpen(false)}
      >
        <button className="context-menu-item context-menu-has-sub">
          快速添加节点 ▸
        </button>
        {subOpen && (
          <div className="context-menu-sub">
            {STEP_TYPE_GROUPS.map((g) => (
              <div key={g.group} className="context-menu-sub-group">
                <div className="context-menu-sub-label">{g.group}</div>
                {g.items.map((item) => (
                  <button
                    key={item.key}
                    className="context-menu-item"
                    onClick={() => { onAddNode?.(item.key, flowPos); onClose(); }}
                  >
                    <span
                      className="context-menu-dot"
                      style={{ background: getKindColor(item.key) }}
                    />
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="context-menu-separator" />
      <button
        className="context-menu-item"
        onClick={() => { onFitView?.(); onClose(); }}
      >
        适应视图
      </button>
    </div>
  );
}
