import { useAppStore, isWorkflowVisibleInRuntime, runtimeBadgeTone } from '../../stores/app';

export default function Sidebar() {
  const { summary, runtime, workflows } = useAppStore();

  const activeWorkflows = Object.entries(runtime.workflow_states ?? {}).filter(
    ([, ws]) => isWorkflowVisibleInRuntime(ws),
  );

  return (
    <aside className="sidebar">
      <section className="brand-card glass">
        <h1>织流 FlowWeaver</h1>
        <p>流程编排、异步识图、运行监控。</p>
      </section>

      <section className="summary-bar glass">
        <div className="summary-bar-row">
          <span className="summary-item">
            <span className="summary-label">流程</span>
            <strong>{summary.workflow_count}</strong>
          </span>
          <span className="summary-item">
            <span className="summary-label">热键</span>
            <strong>{summary.enabled_count}</strong>
          </span>
          <span className="summary-item">
            <span className="summary-label">运行中</span>
            <strong>{summary.active_loop_count}</strong>
          </span>
        </div>
        <div className="summary-bar-row">
          <span className="summary-item">
            <span className="summary-label">识图</span>
            <strong>{summary.visual_count}</strong>
          </span>
          <span className="summary-item">
            <span className="summary-label">循环</span>
            <strong>{summary.loop_count}</strong>
          </span>
        </div>
      </section>

      <section className="guide-card glass">
        <div className="panel-head compact">
          <div><h3>运行概览</h3></div>
        </div>
        <div className="runtime-overview">
          {activeWorkflows.length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0' }}>暂无运行中的流程</div>
          ) : (
            activeWorkflows.map(([wfId, ws]) => {
              const wf = workflows.find((w) => w.workflow_id === wfId);
              return (
                <div className="runtime-row" key={wfId}>
                  <span className="label">{wf?.name ?? wfId}</span>
                  <span className={`runtime-badge ${runtimeBadgeTone(ws.status)}`}>
                    {ws.status_label}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </aside>
  );
}
