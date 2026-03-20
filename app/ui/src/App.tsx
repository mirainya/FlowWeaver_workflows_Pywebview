import { useEffect, useRef } from 'react';
import { useAppStore, APP_TABS } from './stores/app';
import { useDesignerStore } from './stores/designer';
import { isApiReady } from './api/bridge';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import TabStrip from './components/layout/TabStrip';
import Toast from './components/common/Toast';
import WorkflowGrid from './components/workflow/WorkflowGrid';
import AsyncVisionPanel from './components/async-vision/AsyncVisionPanel';
import SettingsPanel from './components/panels/SettingsPanel';
import AboutPanel from './components/panels/AboutPanel';
import KeyEventPanel from './components/panels/KeyEventPanel';
import LogPanel from './components/panels/LogPanel';
import DesignerPanel from './components/designer/DesignerPanel';

export default function App() {
  const { activeTab, bootstrapDone, loadBootstrap, pollRuntime, pollLogs, pollAsyncVision } = useAppStore();
  const designerOpen = useDesignerStore((s) => s.isOpen);
  const runtimeTimer = useRef<ReturnType<typeof setInterval>>();
  const logTimer = useRef<ReturnType<typeof setInterval>>();
  const asyncVisionTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    // Wait for pywebview API to be ready
    const tryBoot = () => {
      if (isApiReady()) {
        loadBootstrap();
        return true;
      }
      return false;
    };

    if (!tryBoot()) {
      const iv = setInterval(() => {
        if (tryBoot()) clearInterval(iv);
      }, 200);
      return () => clearInterval(iv);
    }
  }, [loadBootstrap]);

  useEffect(() => {
    if (!bootstrapDone) return;
    // Start polling
    runtimeTimer.current = setInterval(pollRuntime, 700);
    logTimer.current = setInterval(pollLogs, 1400);
    asyncVisionTimer.current = setInterval(pollAsyncVision, 900);
    return () => {
      clearInterval(runtimeTimer.current);
      clearInterval(logTimer.current);
      clearInterval(asyncVisionTimer.current);
    };
  }, [bootstrapDone, pollRuntime, pollLogs, pollAsyncVision]);

  // Apply saved theme on mount
  useEffect(() => {
    const theme = useAppStore.getState().theme;
    document.documentElement.dataset.theme = theme;
  }, []);

  const activeTabMeta = APP_TABS.find((t) => t.key === activeTab) ?? APP_TABS[0];

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header title={activeTabMeta.label} subtitle={activeTabMeta.description} />

        <section className="panel glass">
          <div className="panel-head">
            <div><h3>工作区</h3></div>
            <div className="panel-actions">
              <button className="ghost-button" type="button" onClick={loadBootstrap}>
                刷新数据
              </button>
            </div>
          </div>

          <TabStrip />
          <Toast />

          {activeTab === 'flows' && <WorkflowGrid />}
          {activeTab === 'asyncVision' && <AsyncVisionPanel />}
          {activeTab === 'settings' && <SettingsPanel />}
          {activeTab === 'about' && <AboutPanel />}
        </section>

        <KeyEventPanel />
        <LogPanel />

        {designerOpen && <DesignerPanel />}
      </main>
    </div>
  );
}
