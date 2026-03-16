import { create } from 'zustand';
import type { Workflow } from '../models/workflow';
import type { AsyncMonitor } from '../models/async-vision';
import type { SummaryData, AppInfo, ArchitectureItem, LogEntry, RuntimeSnapshot, KeyEvent, WorkflowRuntimeState } from '../api/bridge';
import { normalizeWorkflow } from '../models/workflow';
import { normalizeAsyncMonitor } from '../models/async-vision';
import { api } from '../api/bridge';

/* ── Theme ── */

export type Theme = 'dark' | 'light' | 'graphite';

function normalizeTheme(theme: string): Theme {
  return (['dark', 'light', 'graphite'] as const).includes(theme as Theme)
    ? (theme as Theme)
    : 'graphite';
}

function loadSavedTheme(): Theme {
  try {
    return normalizeTheme(localStorage.getItem('luoqi-theme') ?? 'graphite');
  } catch {
    return 'graphite';
  }
}

/* ── Tab ── */

export type TabKey = 'flows' | 'async_vision' | 'settings' | 'about';

export interface TabDef {
  key: TabKey;
  label: string;
  description: string;
}

export const APP_TABS: TabDef[] = [
  { key: 'flows', label: '流程', description: '查看、搜索、执行和管理全部流程。' },
  { key: 'async_vision', label: '后台识图', description: '后台持续识图，并把结果写入共享数据。' },
  { key: 'settings', label: '设置', description: '切换主题并查看当前界面配置。' },
  { key: 'about', label: '关于', description: '查看产品说明、架构约定和配置位置。' },
];

/* ── Toast ── */

export interface ToastState {
  visible: boolean;
  tone: 'success' | 'error' | 'info';
  message: string;
}

/* ── Store ── */

export interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Tab
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;

  // Data
  workflows: Workflow[];
  asyncMonitors: AsyncMonitor[];
  summary: SummaryData;
  appInfo: AppInfo;
  architecture: ArchitectureItem[];
  sharedVariables: Record<string, unknown>;

  // Runtime
  runtime: RuntimeSnapshot;
  logs: LogEntry[];

  // Toast
  toast: ToastState;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;

  // Flow filter
  flowQuery: string;
  flowFilter: string;
  setFlowQuery: (q: string) => void;
  setFlowFilter: (f: string) => void;

  // Bootstrap
  bootstrapDone: boolean;
  loadBootstrap: () => Promise<void>;

  // Polling
  pollRuntime: () => Promise<void>;
  pollLogs: () => Promise<void>;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  // Theme
  theme: loadSavedTheme(),
  setTheme: (theme) => {
    const t = normalizeTheme(theme);
    set({ theme: t });
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('luoqi-theme', t); } catch { /* noop */ }
  },

  // Tab
  activeTab: 'flows',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Data
  workflows: [],
  asyncMonitors: [],
  summary: { workflow_count: 0, enabled_count: 0, visual_count: 0, loop_count: 0, active_loop_count: 0 },
  appInfo: { version: '--', workflow_source: '--' },
  architecture: [],
  sharedVariables: {},

  // Runtime
  runtime: { workflow_states: {}, key_events: [] },
  logs: [],

  // Toast
  toast: { visible: false, tone: 'success', message: '' },
  showToast: (message, tone = 'success') => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { visible: true, tone, message } });
    toastTimer = setTimeout(() => {
      set({ toast: { visible: false, tone: 'info', message: '' } });
    }, 2400);
  },

  // Flow filter
  flowQuery: '',
  flowFilter: 'all',
  setFlowQuery: (q) => set({ flowQuery: q }),
  setFlowFilter: (f) => set({ flowFilter: f }),

  // Bootstrap
  bootstrapDone: false,
  loadBootstrap: async () => {
    try {
      const data = await api.bootstrap();
      const workflows = (data.workflows ?? []).map((w) => normalizeWorkflow(w));
      const asyncMonitors = (data.async_monitors ?? []).map((m) => normalizeAsyncMonitor(m));
      set({
        workflows,
        asyncMonitors,
        summary: data.summary ?? get().summary,
        appInfo: data.app ?? get().appInfo,
        architecture: data.architecture ?? [],
        sharedVariables: data.shared_variables ?? {},
        bootstrapDone: true,
      });
    } catch (err) {
      console.error('Bootstrap failed:', err);
    }
  },

  // Polling
  pollRuntime: async () => {
    try {
      const snapshot = await api.getRuntimeSnapshot();
      set({ runtime: snapshot });
    } catch { /* noop */ }
  },
  pollLogs: async () => {
    try {
      const logs = await api.listLogs();
      set({ logs });
    } catch { /* noop */ }
  },
}));
