/* ── Async vision monitor types ── */

export type MatchType = 'template' | 'pixel' | 'region_color' | 'hsv' | 'fingerprint';
export type SearchScope = 'full_screen' | 'fixed_region';
export type NotFoundAction = 'clear' | 'keep_last';
export type MatchMode = 'default' | 'custom_confidence';
export type PixelLogic = 'all' | 'any';

export interface FixedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
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
  scan_rate: number;
  not_found_action: NotFoundAction;
  match_mode: MatchMode;
  custom_confidence: number;
  follow_radius: number;
  recover_after_misses: number;
  stale_after_ms: number;
  pixel_points: PixelPoint[];
  pixel_logic: PixelLogic;
  region_color_config: RegionColorConfig;
  hsv_config: HsvConfig;
  fingerprint_config: FingerprintConfig;
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
    fixed_region: { x: 0, y: 0, w: 200, h: 200 },
    scan_rate: 500,
    not_found_action: 'clear',
    match_mode: 'default',
    custom_confidence: 0.88,
    follow_radius: 50,
    recover_after_misses: 3,
    stale_after_ms: 5000,
    pixel_points: [],
    pixel_logic: 'all',
    region_color_config: { target_color: '', tolerance: 30, min_ratio: 0.5 },
    hsv_config: { hsv_lower: [0, 0, 0], hsv_upper: [180, 255, 255], min_area: 100 },
    fingerprint_config: { anchor_x: 0, anchor_y: 0, sample_points: [], tolerance: 20 },
  };
}

export function normalizeAsyncMonitor(raw: Record<string, unknown>): AsyncMonitor {
  const defaults = createEmptyAsyncMonitor();
  return {
    ...defaults,
    ...raw,
    monitor_id: String(raw.monitor_id ?? ''),
    name: String(raw.name ?? ''),
    output_variable: String(raw.output_variable ?? ''),
    template_path: String(raw.template_path ?? ''),
    enabled: Boolean(raw.enabled ?? true),
    match_type: (['template', 'pixel', 'region_color', 'hsv', 'fingerprint'].includes(raw.match_type as string)
      ? raw.match_type : 'template') as MatchType,
    search_scope: (['full_screen', 'fixed_region'].includes(raw.search_scope as string)
      ? raw.search_scope : 'fixed_region') as SearchScope,
    scan_rate: typeof raw.scan_rate === 'number' ? raw.scan_rate : 500,
  } as AsyncMonitor;
}
