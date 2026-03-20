import { useAppStore, runtimeBadgeTone } from '../../stores/app';
import { useDesignerStore } from '../../stores/designer';

export default function WorkflowGrid() {
  const { workflows, flowQuery, flowFilter, setFlowQuery, setFlowFilter, runtime } = useAppStore();
  const { openDesigner, openNewDesigner } = useDesignerStore();

  const filtered = workflows.filter((wf) => {
    if (flowFilter === 'editable' && !wf.definition_editable) return false;
    if (flowFilter === 'loop' && !wf.is_loop) return false;
    if (flowFilter === 'vision' && !wf.node_graph?.nodes.some((node) => ['detect_image', 'detect_color', 'check_pixels', 'check_region_color', 'detect_color_region', 'match_fingerprint', 'async_detect'].includes(node.kind))) return false;
    const kw = flowQuery.trim().toLowerCase();
    if (!kw) return true;
    return [wf.name, wf.description, wf.category, wf.binding?.hotkey]
      .filter(Boolean)
      .some((s) => (s as string).toLowerCase().includes(kw));
  });

  return (
    <div className="workflow-workspace">
      <section className="workspace-section">
        <div className="workspace-section-head">
          <div>
            <h4>流程列表</h4>
            <p>在这里查看、筛选并打开流程编辑器，主操作聚焦流程编排。</p>
          </div>
        </div>

        <div className="workflow-filter-bar">
          <input
            className="workflow-search"
            type="text"
            placeholder="搜索流程…"
            value={flowQuery}
            onChange={(e) => setFlowQuery(e.target.value)}
          />
          <select
            className="workflow-filter-select"
            value={flowFilter}
            onChange={(e) => setFlowFilter(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="editable">可编辑</option>
            <option value="loop">循环</option>
            <option value="vision">含识图</option>
          </select>
          <button className="primary-button" type="button" onClick={openNewDesigner}>
            + 新建流程
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">暂无匹配的流程</div>
        ) : (
          <div className="workflow-grid">
            {filtered.map((wf) => {
              const ws = runtime.workflow_states?.[wf.workflow_id];
              return (
                <article
                  className={`workflow-card glass${wf.binding?.enabled === false ? ' disabled' : ''}`}
                  key={wf.workflow_id}
                  onClick={() => wf.definition_editable ? openDesigner(wf.workflow_id) : undefined}
                  style={{ cursor: wf.definition_editable ? 'pointer' : 'default' }}
                >
                  <div className="workflow-card-head">
                    <strong>{wf.name}</strong>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {ws && ws.status !== 'idle' && (
                        <span className={`runtime-badge ${runtimeBadgeTone(ws.status)}`}>{ws.status_label}</span>
                      )}
                      {wf.binding?.hotkey && <code className="hotkey-badge">{wf.binding.hotkey}</code>}
                    </div>
                  </div>
                  <p className="workflow-card-desc">{wf.description || '暂无描述'}</p>
                  <div className="workflow-card-foot">
                    <span className="workflow-card-tag">{wf.source === 'custom' ? '自定义' : '内置'}</span>
                    <span className="workflow-card-tag">{wf.run_mode.type === 'once' ? '单次' : wf.run_mode.type === 'repeat_n' ? `重复${wf.run_mode.count ?? ''}次` : '循环'}</span>
                    {Array.isArray(wf.node_graph?.nodes) && <span className="workflow-card-tag">{wf.node_graph.nodes.filter((node) => node.kind !== '__start__' && node.kind !== '__end__').length}节点</span>}
                    {!wf.definition_editable && <span className="workflow-card-tag">只读</span>}
                    {wf.binding?.enabled === false && <span className="workflow-card-tag" style={{ color: 'var(--danger, #e74c3c)' }}>已禁用</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
