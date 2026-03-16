/* ── Pywebview API bridge ── */

interface PywebviewApi {
  bootstrap(): Promise<BootstrapData>;
  list_logs(): Promise<LogEntry[]>;
  get_runtime_snapshot(): Promise<RuntimeSnapshot>;
  save_binding(workflow_id: string, hotkey: string, enabled: boolean, settings?: Record<string, unknown>): Promise<SaveResult>;
  save_custom_flow(payload: Record<string, unknown>): Promise<SaveResult>;
  upload_template_image(payload: { filename: string; data_url: string }): Promise<UploadResult>;
  pick_template_image(): Promise<PickResult>;
  save_async_monitor(payload: Record<string, unknown>): Promise<SaveMonitorResult>;
  delete_async_monitor(monitor_id: string): Promise<void>;
  test_template_match(payload: Record<string, unknown>): Promise<MatchTestResult>;
  get_template_thumbnail(payload: { template_path: string; max_size?: number }): Promise<ThumbnailResult>;
  pick_color(payload: { x: number; y: number }): Promise<PickColorResult>;
  capture_fingerprint(payload: { anchor_x: number; anchor_y: number; offsets: Array<{ dx: number; dy: number }> }): Promise<CaptureResult>;
}

/* ── Response types ── */

export interface BootstrapData {
  workflows: Record<string, unknown>[];
  async_monitors: Record<string, unknown>[];
  summary: SummaryData;
  app: AppInfo;
  architecture: ArchitectureItem[];
  shared_variables: Record<string, unknown>;
}

export interface SummaryData {
  workflow_count: number;
  enabled_count: number;
  visual_count: number;
  loop_count: number;
  active_loop_count: number;
}

export interface AppInfo {
  version: string;
  workflow_source: string;
}

export interface ArchitectureItem {
  title: string;
  description: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface RuntimeSnapshot {
  workflow_states: Record<string, WorkflowRuntimeState>;
  key_events: KeyEvent[];
}

export interface WorkflowRuntimeState {
  status: string;
  status_label: string;
  active: boolean;
  last_message: string;
  last_key: string;
  last_key_time: string;
  key_event_count: number;
  iteration_count: number;
  last_trigger_time: string;
  last_finish_time: string;
}

export interface KeyEvent {
  key: string;
  time: string;
  type: string;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  workflow?: Record<string, unknown>;
  binding?: Record<string, unknown>;
  summary?: SummaryData;
}

export interface UploadResult {
  ok: boolean;
  error?: string;
  template_path?: string;
}

export interface PickResult {
  ok: boolean;
  error?: string;
  template_path?: string;
}

export interface SaveMonitorResult {
  ok: boolean;
  error?: string;
  monitor?: Record<string, unknown>;
}

export interface MatchTestResult {
  ok: boolean;
  error?: string;
  found?: boolean;
  x?: number;
  y?: number;
  confidence?: number;
  preview_data_url?: string;
}

export interface ThumbnailResult {
  ok: boolean;
  error?: string;
  data_url?: string;
}

export interface PickColorResult {
  ok: boolean;
  error?: string;
  hex?: string;
  r?: number;
  g?: number;
  b?: number;
}

export interface CaptureResult {
  ok: boolean;
  error?: string;
  sample_points?: Array<{ dx: number; dy: number; expected_color: string }>;
}

/* ── API accessor ── */

function getApi(): PywebviewApi | undefined {
  return (window as any).pywebview?.api;
}

function ensureApi(): PywebviewApi {
  const a = getApi();
  if (!a) throw new Error('pywebview API 尚未就绪');
  return a;
}

/* ── Typed API methods ── */

export const api = {
  bootstrap: () => ensureApi().bootstrap(),
  listLogs: () => ensureApi().list_logs(),
  getRuntimeSnapshot: () => ensureApi().get_runtime_snapshot(),
  saveBinding: (workflowId: string, hotkey: string, enabled: boolean, settings?: Record<string, unknown>) =>
    ensureApi().save_binding(workflowId, hotkey, enabled, settings),
  saveCustomFlow: (payload: Record<string, unknown>) =>
    ensureApi().save_custom_flow(payload),
  uploadTemplateImage: (payload: { filename: string; data_url: string }) =>
    ensureApi().upload_template_image(payload),
  pickTemplateImage: () =>
    ensureApi().pick_template_image(),
  saveAsyncMonitor: (payload: Record<string, unknown>) =>
    ensureApi().save_async_monitor(payload),
  deleteAsyncMonitor: (monitorId: string) =>
    ensureApi().delete_async_monitor(monitorId),
  testTemplateMatch: (payload: Record<string, unknown>) =>
    ensureApi().test_template_match(payload),
  getTemplateThumbnail: (templatePath: string, maxSize = 120) =>
    ensureApi().get_template_thumbnail({ template_path: templatePath, max_size: maxSize }),
  pickColor: (x: number, y: number) =>
    ensureApi().pick_color({ x, y }),
  captureFingerprint: (anchorX: number, anchorY: number, offsets: Array<{ dx: number; dy: number }>) =>
    ensureApi().capture_fingerprint({ anchor_x: anchorX, anchor_y: anchorY, offsets }),
};

export function isApiReady(): boolean {
  return !!getApi();
}
