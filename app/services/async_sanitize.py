from __future__ import annotations

from typing import Any


class _MonitorConfigError(Exception):
    """异步监控配置校验失败。"""


PRESET_DEFAULTS: dict[str, dict[str, Any]] = {
    "fixed_button": {
        "search_scope": "fixed_region",
        "scan_rate": "normal",
        "not_found_action": "keep_last",
        "match_mode": "normal",
        "custom_confidence": 0.88,
        "follow_radius": 220,
        "recover_after_misses": 2,
        "stale_after_ms": 1200,
    },
    "dialog_confirm": {
        "search_scope": "full_screen",
        "scan_rate": "high",
        "not_found_action": "mark_missing",
        "match_mode": "normal",
        "custom_confidence": 0.88,
        "follow_radius": 220,
        "recover_after_misses": 1,
        "stale_after_ms": 700,
    },
    "moving_target": {
        "search_scope": "follow_last",
        "scan_rate": "high",
        "not_found_action": "mark_missing",
        "match_mode": "loose",
        "custom_confidence": 0.82,
        "follow_radius": 260,
        "recover_after_misses": 2,
        "stale_after_ms": 500,
    },
    "status_check": {
        "search_scope": "fixed_region",
        "scan_rate": "low",
        "not_found_action": "keep_last",
        "match_mode": "strict",
        "custom_confidence": 0.95,
        "follow_radius": 200,
        "recover_after_misses": 3,
        "stale_after_ms": 2000,
    },
    "custom": {
        "search_scope": "full_screen",
        "scan_rate": "custom",
        "custom_interval_ms": 350,
        "not_found_action": "keep_last",
        "match_mode": "custom",
        "custom_confidence": 0.88,
        "follow_radius": 220,
        "recover_after_misses": 2,
        "stale_after_ms": 1200,
    },
}

SCAN_RATE_INTERVAL_MS = {
    "low": 900,
    "normal": 350,
    "high": 150,
    "ultra": 30,
    "custom": 350,
}

MATCH_MODE_CONFIDENCE = {
    "loose": 0.82,
    "normal": 0.88,
    "strict": 0.94,
}

MATCH_TYPE_ALIASES = {
    "pixel": "check_pixels",
    "region_color": "check_region_color",
    "hsv": "detect_color_region",
    "fingerprint": "match_fingerprint",
}

SEARCH_SCOPE_ALIASES = {
    "region": "fixed_region",
}

NOT_FOUND_ACTION_ALIASES = {
    "clear": "mark_missing",
}

MATCH_MODE_ALIASES = {
    "default": "normal",
    "custom_confidence": "custom",
}

SCAN_RATE_ALIASES = {
    900: "low",
    350: "normal",
    300: "normal",
    150: "high",
    30: "ultra",
    800: "low",
    500: "normal",
}


def _clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        normalized = default
    return max(minimum, min(maximum, normalized))


def _clamp_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        normalized = float(value)
    except (TypeError, ValueError):
        normalized = default
    return max(minimum, min(maximum, normalized))


def _sanitize_region(raw_region: Any) -> dict[str, int]:
    if not isinstance(raw_region, dict):
        raw_region = {}
    left = raw_region.get("left", raw_region.get("x", 0))
    top = raw_region.get("top", raw_region.get("y", 0))
    width = raw_region.get("width", raw_region.get("w", 0))
    height = raw_region.get("height", raw_region.get("h", 0))
    return {
        "left": _clamp_int(left, 0, 0, 100000),
        "top": _clamp_int(top, 0, 0, 100000),
        "width": _clamp_int(width, 0, 0, 100000),
        "height": _clamp_int(height, 0, 0, 100000),
    }


def _resolve_enum(raw_value: Any, allowed: set[str], default: str, aliases: dict[Any, str] | None = None) -> str:
    value = str(raw_value or "").strip()
    if aliases is not None:
        value = aliases.get(value, aliases.get(raw_value, value))
    return value if value in allowed else default


def _normalize_scan_rate(raw_value: Any, default: str) -> str:
    if isinstance(raw_value, (int, float)):
        if int(raw_value) in SCAN_RATE_ALIASES:
            return SCAN_RATE_ALIASES[int(raw_value)]
        return "custom"
    return _resolve_enum(raw_value, set(SCAN_RATE_INTERVAL_MS.keys()), default)


def _effective_confidence(monitor: dict[str, Any]) -> float:
    match_mode = str(monitor.get("match_mode", "normal"))
    if match_mode == "custom":
        return _clamp_float(monitor.get("custom_confidence", 0.88), 0.88, 0.55, 0.99)
    return MATCH_MODE_CONFIDENCE.get(match_mode, 0.88)


def _effective_interval_ms(monitor: dict[str, Any]) -> int:
    scan_rate = str(monitor.get("scan_rate", "normal"))
    if scan_rate == "custom":
        return _clamp_int(monitor.get("custom_interval_ms", 350), 350, 16, 60000)
    return SCAN_RATE_INTERVAL_MS.get(scan_rate, 350)


def _sanitize_pixel_points(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    points: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        points.append({
            "x": _clamp_int(item.get("x", 0), 0, 0, 100000),
            "y": _clamp_int(item.get("y", 0), 0, 0, 100000),
            "expected_color": str(item.get("expected_color", "")).strip(),
            "tolerance": _clamp_int(item.get("tolerance", 20), 20, 0, 255),
        })
    return points


def _sanitize_region_color_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    return {
        "left": _clamp_int(raw.get("left", 0), 0, 0, 100000),
        "top": _clamp_int(raw.get("top", 0), 0, 0, 100000),
        "width": _clamp_int(raw.get("width", 100), 100, 1, 100000),
        "height": _clamp_int(raw.get("height", 100), 100, 1, 100000),
        "expected_color": str(raw.get("expected_color", "#FF0000")).strip(),
        "tolerance": _clamp_int(raw.get("tolerance", 20), 20, 0, 255),
        "min_ratio": _clamp_float(raw.get("min_ratio", 0.5), 0.5, 0.01, 1.0),
    }


def _sanitize_hsv_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    return {
        "h_min": _clamp_int(raw.get("h_min", 0), 0, 0, 179),
        "h_max": _clamp_int(raw.get("h_max", 179), 179, 0, 179),
        "s_min": _clamp_int(raw.get("s_min", 50), 50, 0, 255),
        "s_max": _clamp_int(raw.get("s_max", 255), 255, 0, 255),
        "v_min": _clamp_int(raw.get("v_min", 50), 50, 0, 255),
        "v_max": _clamp_int(raw.get("v_max", 255), 255, 0, 255),
        "region_left": _clamp_int(raw.get("region_left", 0), 0, 0, 100000),
        "region_top": _clamp_int(raw.get("region_top", 0), 0, 0, 100000),
        "region_width": _clamp_int(raw.get("region_width", 0), 0, 0, 100000),
        "region_height": _clamp_int(raw.get("region_height", 0), 0, 0, 100000),
        "min_area": _clamp_int(raw.get("min_area", 100), 100, 1, 1000000),
    }


def _sanitize_fingerprint_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    raw_points = raw.get("sample_points", [])
    sample_points: list[dict[str, Any]] = []
    if isinstance(raw_points, list):
        for sp in raw_points:
            if not isinstance(sp, dict):
                continue
            sample_points.append({
                "dx": _clamp_int(sp.get("dx", 0), 0, -1000, 1000),
                "dy": _clamp_int(sp.get("dy", 0), 0, -1000, 1000),
                "expected_color": str(sp.get("expected_color", "")).strip(),
            })
    return {
        "anchor_x": _clamp_int(raw.get("anchor_x", 0), 0, -100000, 100000),
        "anchor_y": _clamp_int(raw.get("anchor_y", 0), 0, -100000, 100000),
        "sample_points": sample_points,
        "tolerance": _clamp_int(raw.get("tolerance", 20), 20, 0, 255),
    }


def sanitize_async_monitor_record(raw_record: Any) -> dict[str, Any] | None:
    if not isinstance(raw_record, dict):
        return None

    monitor_id = str(raw_record.get("monitor_id", "")).strip()
    name = str(raw_record.get("name", "")).strip()
    output_variable = str(raw_record.get("output_variable", raw_record.get("variable_name", ""))).strip()
    template_path = str(raw_record.get("template_path", "")).strip()

    preset = _resolve_enum(raw_record.get("preset"), set(PRESET_DEFAULTS.keys()), "custom")
    defaults = PRESET_DEFAULTS.get(preset, PRESET_DEFAULTS["custom"])

    match_type = _resolve_enum(
        raw_record.get("match_type", "template"),
        {"template", "check_pixels", "check_region_color", "detect_color_region", "match_fingerprint"},
        "template",
        aliases=MATCH_TYPE_ALIASES,
    )
    search_scope = _resolve_enum(
        raw_record.get("search_scope", defaults.get("search_scope")),
        {"full_screen", "fixed_region", "follow_last"},
        str(defaults.get("search_scope", "full_screen")),
        aliases=SEARCH_SCOPE_ALIASES,
    )
    fixed_region = _sanitize_region(raw_record.get("fixed_region"))
    scan_rate = _normalize_scan_rate(
        raw_record.get("scan_rate", defaults.get("scan_rate")),
        str(defaults.get("scan_rate", "normal")),
    )
    not_found_action = _resolve_enum(
        raw_record.get("not_found_action", defaults.get("not_found_action")),
        {"keep_last", "mark_missing"},
        str(defaults.get("not_found_action", "keep_last")),
        aliases=NOT_FOUND_ACTION_ALIASES,
    )
    match_mode = _resolve_enum(
        raw_record.get("match_mode", defaults.get("match_mode")),
        {"loose", "normal", "strict", "custom"},
        str(defaults.get("match_mode", "normal")),
        aliases=MATCH_MODE_ALIASES,
    )
    custom_confidence = _clamp_float(
        raw_record.get("custom_confidence", defaults.get("custom_confidence", 0.88)),
        float(defaults.get("custom_confidence", 0.88)),
        0.55,
        0.99,
    )
    custom_interval_ms = _clamp_int(
        raw_record.get("custom_interval_ms", defaults.get("custom_interval_ms", SCAN_RATE_INTERVAL_MS.get("normal", 350))),
        int(defaults.get("custom_interval_ms", SCAN_RATE_INTERVAL_MS.get("normal", 350))),
        16,
        60000,
    )
    follow_radius = _clamp_int(
        raw_record.get("follow_radius", defaults.get("follow_radius", 220)),
        int(defaults.get("follow_radius", 220)),
        50,
        2000,
    )
    recover_after_misses = _clamp_int(
        raw_record.get("recover_after_misses", defaults.get("recover_after_misses", 2)),
        int(defaults.get("recover_after_misses", 2)),
        1,
        20,
    )
    stale_after_ms = _clamp_int(
        raw_record.get("stale_after_ms", defaults.get("stale_after_ms", 1200)),
        int(defaults.get("stale_after_ms", 1200)),
        100,
        30000,
    )

    pixel_points = _sanitize_pixel_points(raw_record.get("pixel_points"))
    pixel_logic = _resolve_enum(raw_record.get("pixel_logic", "all"), {"all", "any"}, "all")
    region_color_config = _sanitize_region_color_config(raw_record.get("region_color_config"))
    hsv_config = _sanitize_hsv_config(raw_record.get("hsv_config"))
    fingerprint_config = _sanitize_fingerprint_config(raw_record.get("fingerprint_config"))

    return {
        "monitor_id": monitor_id,
        "name": name,
        "output_variable": output_variable,
        "template_path": template_path,
        "enabled": bool(raw_record.get("enabled", True)),
        "preset": preset,
        "match_type": match_type,
        "search_scope": search_scope,
        "fixed_region": fixed_region,
        "scan_rate": scan_rate,
        "not_found_action": not_found_action,
        "match_mode": match_mode,
        "custom_confidence": custom_confidence,
        "custom_interval_ms": custom_interval_ms,
        "follow_radius": follow_radius,
        "recover_after_misses": recover_after_misses,
        "stale_after_ms": stale_after_ms,
        "pixel_points": pixel_points,
        "pixel_logic": pixel_logic,
        "region_color_config": region_color_config,
        "hsv_config": hsv_config,
        "fingerprint_config": fingerprint_config,
        "effective_confidence": _effective_confidence(
            {
                "match_mode": match_mode,
                "custom_confidence": custom_confidence,
            }
        ),
        "effective_interval_ms": _effective_interval_ms({
            "scan_rate": scan_rate,
            "custom_interval_ms": custom_interval_ms,
        }),
    }
