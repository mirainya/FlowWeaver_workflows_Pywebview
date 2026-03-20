/* ── Async vision monitor types ── */

export type MatchType = 'template' | 'check_pixels' | 'check_region_color' | 'detect_color_region' | 'match_fingerprint';
export type SearchScope = 'full_screen' | 'fixed_region' | 'follow_last';
export type NotFoundAction = 'keep_last' | 'mark_missing';
export type MatchMode = 'loose' | 'normal' | 'strict' | 'custom';
export type ScanRate = 'low' | 'normal' | 'high' | 'ultra' | 'custom';
export type PixelLogic = 'all' | 'any';

export interface FixedRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PixelPoint {
  x: number;
  y: number;
  expected_color: string;
  tolerance: number;
}

export interface RegionColorConfig {
  target_color: string;
  tolerance: number;
  min_ratio: number;
}

export interface HsvConfig {
  hsv_lower: [number, number, number];
  hsv_upper: [number, number, number];
  min_area: number;
}

export interface FingerprintConfig {
  anchor_x: number;
  anchor_y: number;
  sample_points: Array<{ dx: number; dy: number; expected_color: string }>;
  tolerance: number;
}

export interface AsyncMonitorRuntime {
  status?: string;
  message?: string;
  updated_at?: number;
  miss_count?: number;
  active_scope?: string;
  search_region?: Record<string, unknown> | null;
  last_hit_at?: number | null;
  [key: string]: unknown;
}

export interface AsyncMonitor {
  monitor_id: string;
  name: string;
  output_variable: string;
  template_path: string;
  enabled: boolean;
  preset: string;
  match_type: MatchType;
  search_scope: SearchScope;
  fixed_region: FixedRegion;
  scan_rate: ScanRate;
  not_found_action: NotFoundAction;
  match_mode: MatchMode;
  custom_confidence: number;
  custom_interval_ms: number;
  follow_radius: number;
  recover_after_misses: number;
  stale_after_ms: number;
  pixel_points: PixelPoint[];
  pixel_logic: PixelLogic;
  region_color_config: RegionColorConfig & { left?: number; top?: number; width?: number; height?: number; expected_color?: string };
  hsv_config: HsvConfig & { h_min?: number; h_max?: number; s_min?: number; s_max?: number; v_min?: number; v_max?: number; region_left?: number; region_top?: number; region_width?: number; region_height?: number };
  fingerprint_config: FingerprintConfig;
  effective_confidence?: number;
  effective_interval_ms?: number;
  runtime?: AsyncMonitorRuntime;
}

export interface SharedVariableMeta {
  monitor_id: string;
  monitor_name: string;
  output_variable: string;
  enabled: boolean;
  status: string;
  message: string;
  updated_at?: number;
  last_hit_at?: number | null;
  miss_count?: number;
  active_scope?: string;
  search_region?: Record<string, unknown> | null;
}

export interface SharedVariableSnapshot {
  name: string;
  found: boolean;
  stale: boolean;
  x?: number | null;
  y?: number | null;
  left?: number | null;
  top?: number | null;
  width?: number | null;
  height?: number | null;
  confidence?: number | null;
  score?: number | null;
  template_path?: string;
  updated_at?: number;
  _shared?: SharedVariableMeta;
  [key: string]: unknown;
}

export function createEmptyAsyncMonitor(): AsyncMonitor {
  return {
    monitor_id: '',
    name: '',
    output_variable: '',
    template_path: '',
    enabled: true,
    preset: 'fixed_button',
    match_type: 'template',
    search_scope: 'fixed_region',
    fixed_region: { left: 0, top: 0, width: 200, height: 200 },
    scan_rate: 'normal',
    not_found_action: 'keep_last',
    match_mode: 'normal',
    custom_confidence: 0.88,
    custom_interval_ms: 350,
    follow_radius: 220,
    recover_after_misses: 2,
    stale_after_ms: 1200,
    pixel_points: [],
    pixel_logic: 'all',
    region_color_config: { left: 0, top: 0, width: 100, height: 100, target_color: '#FF0000', expected_color: '#FF0000', tolerance: 20, min_ratio: 0.5 },
    hsv_config: { hsv_lower: [0, 50, 50], hsv_upper: [179, 255, 255], h_min: 0, h_max: 179, s_min: 50, s_max: 255, v_min: 50, v_max: 255, region_left: 0, region_top: 0, region_width: 0, region_height: 0, min_area: 100 },
    fingerprint_config: { anchor_x: 0, anchor_y: 0, sample_points: [], tolerance: 20 },
    effective_confidence: 0.88,
    effective_interval_ms: 350,
  };
}

function normalizeMatchType(value: unknown): MatchType {
  const raw = String(value ?? '').trim();
  const mapped = ({
    pixel: 'check_pixels',
    region_color: 'check_region_color',
    hsv: 'detect_color_region',
    fingerprint: 'match_fingerprint',
  } as Record<string, MatchType | undefined>)[raw] ?? raw;
  return (['template', 'check_pixels', 'check_region_color', 'detect_color_region', 'match_fingerprint'].includes(mapped)
    ? mapped
    : 'template') as MatchType;
}

function normalizeSearchScope(value: unknown): SearchScope {
  const raw = String(value ?? '').trim();
  return (['full_screen', 'fixed_region', 'follow_last'].includes(raw) ? raw : 'fixed_region') as SearchScope;
}

function normalizeMatchMode(value: unknown): MatchMode {
  const raw = String(value ?? '').trim();
  const mapped = ({ default: 'normal', custom_confidence: 'custom' } as Record<string, MatchMode | undefined>)[raw] ?? raw;
  return (['loose', 'normal', 'strict', 'custom'].includes(mapped) ? mapped : 'normal') as MatchMode;
}

function normalizeNotFoundAction(value: unknown): NotFoundAction {
  const raw = String(value ?? '').trim();
  const mapped = raw === 'clear' ? 'mark_missing' : raw;
  return (['keep_last', 'mark_missing'].includes(mapped) ? mapped : 'keep_last') as NotFoundAction;
}

function normalizeScanRate(value: unknown): ScanRate {
  if (typeof value === 'number') {
    if (value <= 100) return 'ultra';
    if (value <= 220) return 'high';
    if (value <= 600) return 'normal';
    return 'custom';
  }
  const raw = String(value ?? '').trim();
  return (['low', 'normal', 'high', 'ultra', 'custom'].includes(raw) ? raw : 'normal') as ScanRate;
}

function normalizeFixedRegion(value: unknown): FixedRegion {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    left: Number(raw.left ?? raw.x ?? 0) || 0,
    top: Number(raw.top ?? raw.y ?? 0) || 0,
    width: Number(raw.width ?? raw.w ?? 0) || 0,
    height: Number(raw.height ?? raw.h ?? 0) || 0,
  };
}

export function normalizeAsyncMonitor(raw: Record<string, unknown>): AsyncMonitor {
  const defaults = createEmptyAsyncMonitor();
  const regionColorRaw = (raw.region_color_config && typeof raw.region_color_config === 'object'
    ? raw.region_color_config
    : {}) as Record<string, unknown>;
  const hsvRaw = (raw.hsv_config && typeof raw.hsv_config === 'object'
    ? raw.hsv_config
    : {}) as Record<string, unknown>;
  const fingerprintRaw = (raw.fingerprint_config && typeof raw.fingerprint_config === 'object'
    ? raw.fingerprint_config
    : {}) as Record<string, unknown>;
  const hsvLowerRaw = Array.isArray(hsvRaw.hsv_lower) ? hsvRaw.hsv_lower as unknown[] : [];
  const hsvUpperRaw = Array.isArray(hsvRaw.hsv_upper) ? hsvRaw.hsv_upper as unknown[] : [];

  return {
    ...defaults,
    ...raw,
    monitor_id: String(raw.monitor_id ?? ''),
    name: String(raw.name ?? ''),
    output_variable: String(raw.output_variable ?? raw.variable_name ?? ''),
    template_path: String(raw.template_path ?? ''),
    enabled: Boolean(raw.enabled ?? true),
    preset: String(raw.preset ?? defaults.preset),
    match_type: normalizeMatchType(raw.match_type),
    search_scope: normalizeSearchScope(raw.search_scope),
    fixed_region: normalizeFixedRegion(raw.fixed_region),
    scan_rate: normalizeScanRate(raw.scan_rate),
    not_found_action: normalizeNotFoundAction(raw.not_found_action),
    match_mode: normalizeMatchMode(raw.match_mode),
    custom_confidence: Number(raw.custom_confidence ?? defaults.custom_confidence) || defaults.custom_confidence,
    custom_interval_ms: Number(raw.custom_interval_ms ?? raw.effective_interval_ms ?? defaults.custom_interval_ms) || defaults.custom_interval_ms,
    follow_radius: Number(raw.follow_radius ?? defaults.follow_radius) || defaults.follow_radius,
    recover_after_misses: Number(raw.recover_after_misses ?? defaults.recover_after_misses) || defaults.recover_after_misses,
    stale_after_ms: Number(raw.stale_after_ms ?? defaults.stale_after_ms) || defaults.stale_after_ms,
    pixel_points: Array.isArray(raw.pixel_points) ? (raw.pixel_points as PixelPoint[]) : [],
    pixel_logic: raw.pixel_logic === 'any' ? 'any' : 'all',
    region_color_config: {
      ...defaults.region_color_config,
      ...regionColorRaw,
      target_color: String(regionColorRaw.target_color ?? regionColorRaw.expected_color ?? defaults.region_color_config.target_color),
      expected_color: String(regionColorRaw.expected_color ?? regionColorRaw.target_color ?? defaults.region_color_config.target_color),
      tolerance: Number(regionColorRaw.tolerance ?? defaults.region_color_config.tolerance) || defaults.region_color_config.tolerance,
      min_ratio: Number(regionColorRaw.min_ratio ?? defaults.region_color_config.min_ratio) || defaults.region_color_config.min_ratio,
    },
    hsv_config: {
      ...defaults.hsv_config,
      ...hsvRaw,
      hsv_lower: [
        Number(hsvLowerRaw[0] ?? hsvRaw.h_min ?? defaults.hsv_config.hsv_lower[0]) || defaults.hsv_config.hsv_lower[0],
        Number(hsvLowerRaw[1] ?? hsvRaw.s_min ?? defaults.hsv_config.hsv_lower[1]) || defaults.hsv_config.hsv_lower[1],
        Number(hsvLowerRaw[2] ?? hsvRaw.v_min ?? defaults.hsv_config.hsv_lower[2]) || defaults.hsv_config.hsv_lower[2],
      ],
      hsv_upper: [
        Number(hsvUpperRaw[0] ?? hsvRaw.h_max ?? defaults.hsv_config.hsv_upper[0]) || defaults.hsv_config.hsv_upper[0],
        Number(hsvUpperRaw[1] ?? hsvRaw.s_max ?? defaults.hsv_config.hsv_upper[1]) || defaults.hsv_config.hsv_upper[1],
        Number(hsvUpperRaw[2] ?? hsvRaw.v_max ?? defaults.hsv_config.hsv_upper[2]) || defaults.hsv_config.hsv_upper[2],
      ],
      min_area: Number(hsvRaw.min_area ?? defaults.hsv_config.min_area) || defaults.hsv_config.min_area,
    },
    fingerprint_config: {
      ...defaults.fingerprint_config,
      ...fingerprintRaw,
      anchor_x: Number(fingerprintRaw.anchor_x ?? defaults.fingerprint_config.anchor_x) || defaults.fingerprint_config.anchor_x,
      anchor_y: Number(fingerprintRaw.anchor_y ?? defaults.fingerprint_config.anchor_y) || defaults.fingerprint_config.anchor_y,
      sample_points: Array.isArray(fingerprintRaw.sample_points) ? fingerprintRaw.sample_points as FingerprintConfig['sample_points'] : [],
      tolerance: Number(fingerprintRaw.tolerance ?? defaults.fingerprint_config.tolerance) || defaults.fingerprint_config.tolerance,
    },
    effective_confidence: Number(raw.effective_confidence ?? defaults.effective_confidence) || defaults.effective_confidence,
    effective_interval_ms: Number(raw.effective_interval_ms ?? defaults.effective_interval_ms) || defaults.effective_interval_ms,
    runtime: (raw.runtime && typeof raw.runtime === 'object') ? raw.runtime as AsyncMonitorRuntime : undefined,
  };
}

export function normalizeSharedVariableSnapshots(raw: unknown): SharedVariableSnapshot[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Record<string, unknown>)
    .map(([name, value]) => {
      const snapshot = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      const sharedRaw = (snapshot._shared && typeof snapshot._shared === 'object'
        ? snapshot._shared
        : {}) as Record<string, unknown>;
      return {
        ...snapshot,
        name,
        found: Boolean(snapshot.found),
        stale: Boolean(snapshot.stale),
        x: typeof snapshot.x === 'number' ? snapshot.x : null,
        y: typeof snapshot.y === 'number' ? snapshot.y : null,
        left: typeof snapshot.left === 'number' ? snapshot.left : null,
        top: typeof snapshot.top === 'number' ? snapshot.top : null,
        width: typeof snapshot.width === 'number' ? snapshot.width : null,
        height: typeof snapshot.height === 'number' ? snapshot.height : null,
        confidence: typeof snapshot.confidence === 'number' ? snapshot.confidence : null,
        score: typeof snapshot.score === 'number' ? snapshot.score : null,
        updated_at: typeof snapshot.updated_at === 'number' ? snapshot.updated_at : undefined,
        _shared: {
          monitor_id: String(sharedRaw.monitor_id ?? ''),
          monitor_name: String(sharedRaw.monitor_name ?? ''),
          output_variable: String(sharedRaw.output_variable ?? name),
          enabled: Boolean(sharedRaw.enabled ?? true),
          status: String(sharedRaw.status ?? 'idle'),
          message: String(sharedRaw.message ?? ''),
          updated_at: typeof sharedRaw.updated_at === 'number' ? sharedRaw.updated_at : undefined,
          last_hit_at: typeof sharedRaw.last_hit_at === 'number' ? sharedRaw.last_hit_at : null,
          miss_count: typeof sharedRaw.miss_count === 'number' ? sharedRaw.miss_count : undefined,
          active_scope: typeof sharedRaw.active_scope === 'string' ? sharedRaw.active_scope : undefined,
          search_region: (sharedRaw.search_region && typeof sharedRaw.search_region === 'object')
            ? sharedRaw.search_region as Record<string, unknown>
            : null,
        },
      } as SharedVariableSnapshot;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
