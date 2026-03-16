import { useAppStore, APP_TABS, type TabKey } from '../../stores/app';

export default function TabStrip() {
  const { activeTab, setActiveTab, workflows, asyncMonitors } = useAppStore();

  function getCount(key: TabKey): number | undefined {
    if (key === 'flows') return workflows.length;
    if (key === 'async_vision') return asyncMonitors.length;
    return undefined;
  }

  return (
    <>
      <div className="tab-strip">
        {APP_TABS.map((tab) => {
          const count = getCount(tab.key);
          return (
            <button
              key={tab.key}
              className={`tab-item${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {count !== undefined && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="tab-meta">
        {APP_TABS.find((t) => t.key === activeTab)?.description}
      </div>
    </>
  );
}
