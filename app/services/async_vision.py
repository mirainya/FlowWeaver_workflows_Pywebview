from __future__ import annotations

import time
from copy import deepcopy
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any, Callable

from app.services.vision import SharedScreenCapture, TemplateMatcher
from app.services.pixel_checker import PixelChecker
from app.services.color_detector import ColorRegionDetector
from app.services.feature_matcher import FeatureMatcher


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
        "scan_rate": "normal",
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
}

MATCH_MODE_CONFIDENCE = {
    "loose": 0.82,
    "normal": 0.88,
    "strict": 0.94,
}

ALLOWED_PRESETS = set(PRESET_DEFAULTS)
ALLOWED_SEARCH_SCOPES = {"full_screen", "fixed_region", "follow_last"}
ALLOWED_SCAN_RATES = {"low", "normal", "high", "ultra"}
ALLOWED_NOT_FOUND_ACTIONS = {"keep_last", "mark_missing"}
ALLOWED_MATCH_MODES = {"loose", "normal", "strict", "custom"}
ALLOWED_MATCH_TYPES = {"template", "check_pixels", "check_region_color", "detect_color_region", "match_fingerprint"}


class _MonitorConfigError(Exception):
    """监控配置错误，不计入连续异常但会显示状态。"""


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
    return {
        "left": _clamp_int(raw_region.get("left", 0), 0, 0, 100000),
        "top": _clamp_int(raw_region.get("top", 0), 0, 0, 100000),
        "width": _clamp_int(raw_region.get("width", 0), 0, 0, 100000),
        "height": _clamp_int(raw_region.get("height", 0), 0, 0, 100000),
    }


def _resolve_enum(raw_value: Any, allowed: set[str], default: str) -> str:
    value = str(raw_value or "").strip()
    return value if value in allowed else default


def _effective_confidence(monitor: dict[str, Any]) -> float:
    match_mode = str(monitor.get("match_mode", "normal"))
    if match_mode == "custom":
        return _clamp_float(monitor.get("custom_confidence", 0.88), 0.88, 0.55, 0.99)
    return MATCH_MODE_CONFIDENCE.get(match_mode, 0.88)


def _effective_interval_ms(monitor: dict[str, Any]) -> int:
    return SCAN_RATE_INTERVAL_MS.get(str(monitor.get("scan_rate", "normal")), 350)


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
        "min_area": _clamp_int(raw.get("min_area", 100), 100, 1, 1000000),
    }


def _sanitize_fingerprint_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    sample_points: list[dict[str, Any]] = []
    for item in (raw.get("sample_points") or []):
        if not isinstance(item, dict):
            continue
        sample_points.append({
            "dx": _clamp_int(item.get("dx", 0), 0, -100000, 100000),
            "dy": _clamp_int(item.get("dy", 0), 0, -100000, 100000),
            "expected_color": str(item.get("expected_color", "")).strip(),
        })
    return {
        "anchor_x": _clamp_int(raw.get("anchor_x", 0), 0, 0, 100000),
        "anchor_y": _clamp_int(raw.get("anchor_y", 0), 0, 0, 100000),
        "tolerance": _clamp_int(raw.get("tolerance", 20), 20, 0, 255),
        "sample_points": sample_points,
    }


def sanitize_async_monitor_record(raw_record: Any) -> dict[str, Any] | None:
    if not isinstance(raw_record, dict):
        return None

    monitor_id = str(raw_record.get("monitor_id", "")).strip()
    if not monitor_id:
        return None

    preset = _resolve_enum(raw_record.get("preset", "fixed_button"), ALLOWED_PRESETS, "fixed_button")
    defaults = PRESET_DEFAULTS[preset]
    name = str(raw_record.get("name", monitor_id)).strip() or monitor_id
    output_variable = str(raw_record.get("output_variable", raw_record.get("variable_name", ""))).strip() or "target"
    template_path = str(raw_record.get("template_path", "")).strip()

    search_scope = _resolve_enum(raw_record.get("search_scope", defaults["search_scope"]), ALLOWED_SEARCH_SCOPES, defaults["search_scope"])
    scan_rate = _resolve_enum(raw_record.get("scan_rate", defaults["scan_rate"]), ALLOWED_SCAN_RATES, defaults["scan_rate"])
    not_found_action = _resolve_enum(raw_record.get("not_found_action", raw_record.get("miss_policy", defaults["not_found_action"])), ALLOWED_NOT_FOUND_ACTIONS, defaults["not_found_action"])
    match_mode = _resolve_enum(raw_record.get("match_mode", defaults["match_mode"]), ALLOWED_MATCH_MODES, defaults["match_mode"])

    fixed_region = _sanitize_region(raw_record.get("fixed_region"))
    custom_confidence = _clamp_float(raw_record.get("custom_confidence", raw_record.get("confidence", defaults["custom_confidence"])), defaults["custom_confidence"], 0.55, 0.99)
    follow_radius = _clamp_int(raw_record.get("follow_radius", defaults["follow_radius"]), defaults["follow_radius"], 60, 4000)
    recover_after_misses = _clamp_int(raw_record.get("recover_after_misses", defaults["recover_after_misses"]), defaults["recover_after_misses"], 1, 30)
    stale_after_ms = _clamp_int(raw_record.get("stale_after_ms", defaults["stale_after_ms"]), defaults["stale_after_ms"], 100, 600000)

    match_type = _resolve_enum(raw_record.get("match_type", "template"), ALLOWED_MATCH_TYPES, "template")

    # ── match-type-specific config ──
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
        "effective_interval_ms": _effective_interval_ms({"scan_rate": scan_rate}),
    }


class SharedVariableStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._variables: dict[str, dict[str, Any]] = {}

    def ensure_variable(self, monitor: dict[str, Any]) -> None:
        variable_name = str(monitor.get("output_variable", "target")).strip() or "target"
        with self._lock:
            current = deepcopy(self._variables.get(variable_name, {}))
            if not current:
                current = self._build_default_value(monitor)
            current["template_path"] = str(monitor.get("template_path", ""))
            current["_shared"] = self._build_meta(monitor, current.get("_shared", {}), status="idle")
            self._variables[variable_name] = current

    def apply_result(
        self,
        monitor: dict[str, Any],
        result: dict[str, Any] | None,
        *,
        status: str,
        message: str,
        runtime_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        variable_name = str(monitor.get("output_variable", "target")).strip() or "target"
        with self._lock:
            current = deepcopy(self._variables.get(variable_name, {}))
            if not current:
                current = self._build_default_value(monitor)

            current_meta = dict(current.get("_shared", {}))
            merged_meta = self._build_meta(
                monitor,
                current_meta,
                status=status,
                message=message,
                runtime_meta=runtime_meta,
            )
            now = float(merged_meta.get("updated_at", time.time()))
            last_hit_at = float(merged_meta.get("last_hit_at") or 0)

            if result and result.get("found"):
                current.update(result)
                current["score"] = float(result.get("confidence", 0.0))
                current["updated_at"] = now
                current["stale"] = False
            elif status == "miss":
                current["updated_at"] = now
                current["template_path"] = str(monitor.get("template_path", ""))
                if str(monitor.get("not_found_action", "keep_last")) == "mark_missing":
                    current.update(
                        {
                            "found": False,
                            "x": None,
                            "y": None,
                            "left": None,
                            "top": None,
                            "width": None,
                            "height": None,
                            "confidence": None,
                            "score": None,
                        }
                    )
                    current["stale"] = True

                if str(monitor.get("not_found_action", "keep_last")) == "mark_missing":
                    current["stale"] = True
                elif last_hit_at <= 0:
                    current["stale"] = True
                else:
                    age_ms = max(0, int((now - last_hit_at) * 1000))
                    current["stale"] = age_ms >= int(monitor.get("stale_after_ms", 1200))
            else:
                current["updated_at"] = now
                if last_hit_at <= 0:
                    current["stale"] = True

            current["_shared"] = merged_meta
            self._variables[variable_name] = current
            return deepcopy(current)

    def mark_status(
        self,
        monitor: dict[str, Any],
        *,
        status: str,
        message: str,
        runtime_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.apply_result(monitor, None, status=status, message=message, runtime_meta=runtime_meta)

    def get_variable(self, variable_name: str) -> dict[str, Any] | None:
        with self._lock:
            value = self._variables.get(variable_name)
            return deepcopy(value) if isinstance(value, dict) else None

    def set_manual_state(
        self,
        variable_name: str,
        *,
        found: bool,
        monitor: dict[str, Any] | None = None,
        message: str = "",
    ) -> dict[str, Any]:
        normalized_name = str(variable_name).strip() or "target"
        with self._lock:
            current = deepcopy(self._variables.get(normalized_name, {}))
            current_meta = dict(current.get("_shared", {}))
            monitor_payload = {
                "monitor_id": str(current_meta.get("monitor_id", "")),
                "name": str(current_meta.get("monitor_name", "")),
                "output_variable": normalized_name,
                "template_path": str(current.get("template_path", "")),
                "enabled": bool(current_meta.get("enabled", True)),
            }
            if isinstance(monitor, dict):
                monitor_payload.update(monitor)
            if not current:
                current = self._build_default_value(monitor_payload)

            now = time.time()
            current["updated_at"] = now
            current["template_path"] = str(monitor_payload.get("template_path", current.get("template_path", "")))
            if found:
                current["found"] = True
                current["stale"] = False
            else:
                current.update(
                    {
                        "found": False,
                        "x": None,
                        "y": None,
                        "left": None,
                        "top": None,
                        "width": None,
                        "height": None,
                        "confidence": None,
                        "score": None,
                    }
                )
                current["stale"] = True

            current["_shared"] = self._build_meta(
                monitor_payload,
                current.get("_shared", {}),
                status="hit" if found else "miss",
                message=message or ("流程已设为命中。" if found else "流程已设为未命中。"),
            )
            self._variables[normalized_name] = current
            return deepcopy(current)

    def get_all(self) -> list[dict[str, Any]]:
        with self._lock:
            items = [
                {
                    "output_variable": name,
                    "variable_name": name,
                    **deepcopy(value),
                }
                for name, value in self._variables.items()
            ]
        return sorted(items, key=lambda item: str(item.get("output_variable", "")).lower())

    def remove_variable(self, variable_name: str) -> None:
        with self._lock:
            self._variables.pop(variable_name, None)

    def _build_default_value(self, monitor: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        return {
            "found": False,
            "x": None,
            "y": None,
            "left": None,
            "top": None,
            "width": None,
            "height": None,
            "confidence": None,
            "score": None,
            "template_path": str(monitor.get("template_path", "")),
            "updated_at": now,
            "stale": True,
            "_shared": self._build_meta(monitor, {}, status="idle"),
        }

    def _build_meta(
        self,
        monitor: dict[str, Any],
        current: dict[str, Any] | None,
        *,
        status: str,
        message: str = "",
        runtime_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = dict(current or {})
        meta = dict(runtime_meta or {})
        payload.update(
            {
                "monitor_id": str(monitor.get("monitor_id", "")),
                "monitor_name": str(monitor.get("name", "")),
                "output_variable": str(monitor.get("output_variable", "")),
                "enabled": bool(monitor.get("enabled", True)),
                "status": status,
                "message": message,
                "updated_at": float(meta.get("updated_at", time.time())),
                "last_hit_at": meta.get("last_hit_at", payload.get("last_hit_at")),
                "miss_count": int(meta.get("miss_count", payload.get("miss_count", 0))),
                "active_scope": str(meta.get("active_scope", payload.get("active_scope", monitor.get("search_scope", "full_screen")))),
                "search_region": deepcopy(meta.get("search_region", payload.get("search_region"))),
            }
        )
        return payload


class AsyncVisionManager:
    def __init__(
        self,
        project_root: Path,
        logger: Callable[[str, str], None],
        shared_capture: SharedScreenCapture | None = None,
        max_threads: int = 8,
        pixel_checker: PixelChecker | None = None,
        color_detector: ColorRegionDetector | None = None,
        feature_matcher: FeatureMatcher | None = None,
    ) -> None:
        self._project_root = project_root
        self._logger = logger
        self._max_threads = max(1, max_threads)
        self._lock = Lock()
        self._stop_all = Event()
        self._store = SharedVariableStore()
        self._monitors: dict[str, dict[str, Any]] = {}
        self._threads: dict[str, Thread] = {}
        self._stops: dict[str, Event] = {}
        self._statuses: dict[str, dict[str, Any]] = {}
        if shared_capture is not None:
            self._shared_capture = shared_capture
            self._owns_capture = False
        else:
            self._shared_capture = SharedScreenCapture()
            self._owns_capture = True
        self._pixel_checker = pixel_checker
        self._color_detector = color_detector
        self._feature_matcher = feature_matcher

    def shutdown(self) -> None:
        self._stop_all.set()
        with self._lock:
            stop_events = list(self._stops.values())
            threads = list(self._threads.values())
        for stop_event in stop_events:
            stop_event.set()
        for thread in threads:
            thread.join(timeout=1.2)
        if self._owns_capture:
            self._shared_capture.close()

    def replace_monitors(self, records: list[dict[str, Any]], *, needed_variables: set[str] | None = None) -> None:
        normalized_records = [
            record
            for record in (sanitize_async_monitor_record(item) for item in records)
            if record is not None
        ]
        next_map = {str(record["monitor_id"]): record for record in normalized_records}

        with self._lock:
            previous_map = deepcopy(self._monitors)
            previous_ids = set(self._monitors.keys())
            next_ids = set(next_map.keys())
            removed_ids = previous_ids - next_ids
            self._monitors = next_map

        for monitor_id in removed_ids:
            self._stop_monitor(monitor_id)
            previous = previous_map.get(monitor_id)
            if previous is not None:
                self._store.remove_variable(str(previous.get("output_variable", "")))

        for record in normalized_records:
            self._store.ensure_variable(record)
            if not record.get("enabled"):
                self._stop_monitor(record["monitor_id"])
                self._set_status(record, "disabled", "监控已停用。")
            elif needed_variables is not None and str(record.get("output_variable", "")).strip() not in needed_variables:
                self._stop_monitor(record["monitor_id"])
                self._set_status(record, "paused", "没有已启用的流程引用此变量，监控暂停。")
            else:
                self._start_monitor(record)

    def get_records(self) -> list[dict[str, Any]]:
        with self._lock:
            return [self._serialize_monitor_record(item) for item in self._monitors.values()]

    def get_monitor_payloads(self) -> list[dict[str, Any]]:
        with self._lock:
            monitors = [deepcopy(item) for item in self._monitors.values()]
            statuses = deepcopy(self._statuses)
        payloads: list[dict[str, Any]] = []
        for monitor in monitors:
            status = statuses.get(monitor["monitor_id"], {})
            payloads.append(
                {
                    **monitor,
                    "runtime": status
                    or {
                        "status": "disabled" if not monitor.get("enabled") else "idle",
                        "message": "尚未开始识别。",
                        "updated_at": None,
                        "miss_count": 0,
                        "active_scope": monitor.get("search_scope", "full_screen"),
                    },
                }
            )
        return sorted(payloads, key=lambda item: (not bool(item.get("enabled")), str(item.get("name", "")).lower()))

    def get_shared_variables_payload(self) -> list[dict[str, Any]]:
        return self._store.get_all()

    def get_variable(self, variable_name: str) -> dict[str, Any] | None:
        return self._store.get_variable(variable_name)

    def set_variable_state(self, variable_name: str, *, found: bool, message: str = "") -> dict[str, Any]:
        normalized_name = str(variable_name).strip() or "target"
        with self._lock:
            monitor = next(
                (
                    deepcopy(item)
                    for item in self._monitors.values()
                    if str(item.get("output_variable", "")).strip() == normalized_name
                ),
                None,
            )

        payload = self._store.set_manual_state(
            normalized_name,
            found=found,
            monitor=monitor,
            message=message,
        )

        if monitor is not None:
            self._set_status(
                monitor,
                "hit" if found else "miss",
                message or ("流程已设为命中。" if found else "流程已设为未命中。"),
            )
        return payload

    def _serialize_monitor_record(self, monitor: dict[str, Any]) -> dict[str, Any]:
        return {
            "monitor_id": str(monitor.get("monitor_id", "")),
            "name": str(monitor.get("name", "")),
            "output_variable": str(monitor.get("output_variable", "")),
            "template_path": str(monitor.get("template_path", "")),
            "enabled": bool(monitor.get("enabled", True)),
            "preset": str(monitor.get("preset", "fixed_button")),
            "match_type": str(monitor.get("match_type", "template")),
            "search_scope": str(monitor.get("search_scope", "full_screen")),
            "fixed_region": deepcopy(monitor.get("fixed_region", {})),
            "scan_rate": str(monitor.get("scan_rate", "normal")),
            "not_found_action": str(monitor.get("not_found_action", "keep_last")),
            "match_mode": str(monitor.get("match_mode", "normal")),
            "custom_confidence": float(monitor.get("custom_confidence", 0.88)),
            "follow_radius": int(monitor.get("follow_radius", 220)),
            "recover_after_misses": int(monitor.get("recover_after_misses", 2)),
            "stale_after_ms": int(monitor.get("stale_after_ms", 1200)),
            "pixel_points": deepcopy(monitor.get("pixel_points", [])),
            "pixel_logic": str(monitor.get("pixel_logic", "all")),
            "region_color_config": deepcopy(monitor.get("region_color_config", {})),
            "hsv_config": deepcopy(monitor.get("hsv_config", {})),
            "fingerprint_config": deepcopy(monitor.get("fingerprint_config", {})),
        }

    def _resolve_template_path(self, raw_path: str) -> Path:
        path = Path(str(raw_path))
        return path if path.is_absolute() else self._project_root / path

    def _start_monitor(self, monitor: dict[str, Any]) -> None:
        monitor_id = str(monitor["monitor_id"])
        self._stop_monitor(monitor_id)
        with self._lock:
            active_count = sum(1 for t in self._threads.values() if t.is_alive())
        if active_count >= self._max_threads:
            name = monitor.get("name", monitor_id)
            self._logger(f"监控线程已达上限({self._max_threads})，无法启动 {name}。", "warning")
            self._set_status(monitor, "error", f"线程数已达上限({self._max_threads})")
            return
        stop_event = Event()
        worker = Thread(target=self._monitor_loop, args=(monitor_id, stop_event), daemon=True)
        with self._lock:
            self._stops[monitor_id] = stop_event
            self._threads[monitor_id] = worker
        worker.start()
        self._set_status(monitor, "running", "监控已启动。")
        self._update_capture_fps()

    def _stop_monitor(self, monitor_id: str) -> None:
        with self._lock:
            stop_event = self._stops.pop(monitor_id, None)
            worker = self._threads.pop(monitor_id, None)
        if stop_event is not None:
            stop_event.set()
        if worker is not None and worker.is_alive():
            worker.join(timeout=1.5)
        self._update_capture_fps()

    def _update_capture_fps(self) -> None:
        if self._shared_capture is None:
            return
        with self._lock:
            active_monitors = [
                m for mid, m in self._monitors.items()
                if m.get("enabled") and mid in self._stops
            ]
        if not active_monitors:
            self._shared_capture.set_target_fps(SharedScreenCapture._MIN_FPS)
            return
        min_interval = min(_effective_interval_ms(m) for m in active_monitors)
        needed_fps = 1000.0 / max(min_interval, 30)
        self._shared_capture.set_target_fps(needed_fps)

    def _set_status(
        self,
        monitor: dict[str, Any],
        status: str,
        message: str,
        *,
        miss_count: int | None = None,
        active_scope: str | None = None,
        search_region: dict[str, int] | None = None,
        last_hit_at: float | None = None,
    ) -> None:
        monitor_id = str(monitor.get("monitor_id", ""))
        with self._lock:
            current = dict(self._statuses.get(monitor_id, {}))
            payload = {
                "status": status,
                "message": message,
                "updated_at": time.time(),
                "miss_count": int(current.get("miss_count", 0) if miss_count is None else miss_count),
                "active_scope": str(current.get("active_scope", monitor.get("search_scope", "full_screen")) if active_scope is None else active_scope),
                "search_region": deepcopy(current.get("search_region") if search_region is None else search_region),
                "last_hit_at": current.get("last_hit_at") if last_hit_at is None else last_hit_at,
            }
            self._statuses[monitor_id] = payload
        self._store.mark_status(monitor, status=status, message=message, runtime_meta=payload)

    def _resolve_search_plan(self, monitor: dict[str, Any], runtime: dict[str, Any]) -> tuple[dict[str, int] | None, str]:
        scope = str(monitor.get("search_scope", "full_screen"))
        if scope == "fixed_region":
            region = deepcopy(monitor.get("fixed_region", {}))
            if int(region.get("width", 0)) > 0 and int(region.get("height", 0)) > 0:
                return region, "fixed_region"
            return None, "full_screen"

        if scope == "follow_last":
            miss_count = int(runtime.get("miss_count", 0))
            max_misses = int(monitor.get("recover_after_misses", 2))
            shared_value = self._store.get_variable(str(monitor.get("output_variable", "target"))) or {}
            if shared_value.get("found") and not shared_value.get("stale") and miss_count < max_misses:
                center_x = _clamp_int(shared_value.get("x", 0), 0, -100000, 100000)
                center_y = _clamp_int(shared_value.get("y", 0), 0, -100000, 100000)
                radius = int(monitor.get("follow_radius", 220))
                return {
                    "left": center_x - radius,
                    "top": center_y - radius,
                    "width": radius * 2,
                    "height": radius * 2,
                }, "follow_last"
            return None, "full_screen"

        return None, "full_screen"

    def _monitor_loop(self, monitor_id: str, stop_event: Event) -> None:
        matcher = TemplateMatcher(shared_capture=self._shared_capture)
        consecutive_errors = 0
        max_consecutive_errors = 10
        try:
            while not self._stop_all.is_set() and not stop_event.is_set():
                with self._lock:
                    monitor = self._monitors.get(monitor_id)
                    if not monitor or not monitor.get("enabled"):
                        break
                    monitor = dict(monitor)
                    fr = monitor.get("fixed_region")
                    if isinstance(fr, dict):
                        monitor["fixed_region"] = dict(fr)
                    runtime = dict(self._statuses.get(monitor_id, {}))
                    sr = runtime.get("search_region")
                    if isinstance(sr, dict):
                        runtime["search_region"] = dict(sr)
                if not monitor or not monitor.get("enabled"):
                    break

                cycle_started = time.monotonic()
                search_region, active_scope = self._resolve_search_plan(monitor, runtime)
                miss_count = int(runtime.get("miss_count", 0))
                last_hit_at = runtime.get("last_hit_at")
                match_type = str(monitor.get("match_type", "template"))

                try:
                    result = self._dispatch_match(match_type, monitor, matcher, search_region, stop_event)
                    consecutive_errors = 0
                except _MonitorConfigError as exc:
                    consecutive_errors += 1
                    self._set_status(monitor, "error", str(exc), active_scope=active_scope, search_region=search_region, miss_count=miss_count, last_hit_at=last_hit_at)
                except Exception as exc:
                    consecutive_errors += 1
                    message = f"异步识图失败：{monitor.get('name')} · {exc}"
                    self._logger(message, "error")
                    self._set_status(monitor, "error", message, active_scope=active_scope, search_region=search_region, miss_count=miss_count, last_hit_at=last_hit_at)
                else:
                    if result is not None and result.get("found"):
                        now = time.time()
                        payload = self._store.apply_result(
                            monitor,
                            result,
                            status="hit",
                            message=self._hit_message(match_type, monitor, result),
                            runtime_meta={
                                "updated_at": now,
                                "miss_count": 0,
                                "active_scope": active_scope,
                                "search_region": search_region,
                                "last_hit_at": now,
                            },
                        )
                        self._set_status(
                            monitor,
                            "hit",
                            f"已找到：({payload.get('x', '?')}, {payload.get('y', '?')})",
                            miss_count=0,
                            active_scope=active_scope,
                            search_region=search_region,
                            last_hit_at=now,
                        )
                    else:
                        miss_count += 1
                        now = time.time()
                        not_found_action = str(monitor.get("not_found_action", "keep_last"))
                        miss_message = "本轮未找到，保留上次结果。" if not_found_action == "keep_last" else "本轮未找到，已标记为未找到。"
                        self._store.apply_result(
                            monitor,
                            None,
                            status="miss",
                            message=miss_message,
                            runtime_meta={
                                "updated_at": now,
                                "miss_count": miss_count,
                                "active_scope": active_scope,
                                "search_region": search_region,
                                "last_hit_at": last_hit_at,
                            },
                        )
                        self._set_status(
                            monitor,
                            "miss",
                            miss_message,
                            miss_count=miss_count,
                            active_scope=active_scope,
                            search_region=search_region,
                            last_hit_at=last_hit_at,
                        )

                elapsed_ms = int((time.monotonic() - cycle_started) * 1000)
                interval_ms = _effective_interval_ms(monitor)
                wait_ms = max(0, interval_ms - elapsed_ms)
                if consecutive_errors >= max_consecutive_errors:
                    self._logger(
                        f"监控 {monitor.get('name')} 连续 {consecutive_errors} 次错误，已自动暂停。",
                        "error",
                    )
                    self._set_status(monitor, "error", f"连续 {consecutive_errors} 次错误，已自动暂停。")
                    break
                if stop_event.wait(wait_ms / 1000):
                    break
        finally:
            matcher.close()

    def _dispatch_match(
        self,
        match_type: str,
        monitor: dict[str, Any],
        matcher: TemplateMatcher,
        search_region: dict[str, int] | None,
        stop_event: Event,
    ) -> dict[str, Any] | None:
        if match_type == "check_pixels":
            return self._match_check_pixels(monitor)
        if match_type == "check_region_color":
            return self._match_check_region_color(monitor)
        if match_type == "detect_color_region":
            return self._match_detect_color_region(monitor, search_region)
        if match_type == "match_fingerprint":
            return self._match_fingerprint(monitor)
        return self._match_template(monitor, matcher, search_region, stop_event)

    def _match_template(
        self,
        monitor: dict[str, Any],
        matcher: TemplateMatcher,
        search_region: dict[str, int] | None,
        stop_event: Event,
    ) -> dict[str, Any] | None:
        template_path_str = str(monitor.get("template_path", "")).strip()
        if not template_path_str:
            raise _MonitorConfigError("缺少模板图片。")
        template_path = self._resolve_template_path(template_path_str)
        if not template_path.exists():
            raise _MonitorConfigError(f"模板图片不存在：{template_path.name}")
        return matcher.locate_on_screen_details(
            template_path=template_path,
            confidence=_effective_confidence(monitor),
            timeout_ms=100,
            search_step=4,
            search_region=search_region,
            capture_once=True,
            stop_event=stop_event,
        )

    def _match_check_pixels(self, monitor: dict[str, Any]) -> dict[str, Any]:
        if self._pixel_checker is None:
            raise _MonitorConfigError("像素检测服务未初始化。")
        points = monitor.get("pixel_points", [])
        if not points:
            raise _MonitorConfigError("缺少像素检测点配置。")
        logic = str(monitor.get("pixel_logic", "all"))
        return self._pixel_checker.check_pixels(points, logic=logic)

    def _match_check_region_color(self, monitor: dict[str, Any]) -> dict[str, Any]:
        if self._pixel_checker is None:
            raise _MonitorConfigError("像素检测服务未初始化。")
        cfg = monitor.get("region_color_config", {})
        return self._pixel_checker.check_region_color(
            left=int(cfg.get("left", 0)),
            top=int(cfg.get("top", 0)),
            width=int(cfg.get("width", 100)),
            height=int(cfg.get("height", 100)),
            expected_color=str(cfg.get("expected_color", "#FF0000")),
            tolerance=int(cfg.get("tolerance", 20)),
            min_ratio=float(cfg.get("min_ratio", 0.5)),
        )

    def _match_detect_color_region(self, monitor: dict[str, Any], search_region: dict[str, int] | None) -> dict[str, Any]:
        if self._color_detector is None:
            raise _MonitorConfigError("颜色区域检测服务未初始化。")
        cfg = monitor.get("hsv_config", {})
        return self._color_detector.detect(
            h_min=int(cfg.get("h_min", 0)),
            h_max=int(cfg.get("h_max", 179)),
            s_min=int(cfg.get("s_min", 50)),
            s_max=int(cfg.get("s_max", 255)),
            v_min=int(cfg.get("v_min", 50)),
            v_max=int(cfg.get("v_max", 255)),
            region=search_region,
            min_area=int(cfg.get("min_area", 100)),
        )

    def _match_fingerprint(self, monitor: dict[str, Any]) -> dict[str, Any]:
        if self._feature_matcher is None:
            raise _MonitorConfigError("特征指纹匹配服务未初始化。")
        cfg = monitor.get("fingerprint_config", {})
        sample_points = cfg.get("sample_points", [])
        if not sample_points:
            raise _MonitorConfigError("缺少特征指纹采样点配置。")
        return self._feature_matcher.match(
            anchor_x=int(cfg.get("anchor_x", 0)),
            anchor_y=int(cfg.get("anchor_y", 0)),
            sample_points=sample_points,
            tolerance=int(cfg.get("tolerance", 20)),
        )

    @staticmethod
    def _hit_message(match_type: str, monitor: dict[str, Any], result: dict[str, Any]) -> str:
        if match_type == "template":
            tpl = str(monitor.get("template_path", ""))
            name = Path(tpl).name if tpl else "模板"
            return f"命中 {name}"
        if match_type == "check_pixels":
            return f"像素匹配 {result.get('match_count', 0)}/{result.get('total', 0)}"
        if match_type == "check_region_color":
            return f"区域颜色占比 {result.get('ratio', 0):.1%}"
        if match_type == "detect_color_region":
            return f"HSV区域 {result.get('count', 0)} 个"
        if match_type == "match_fingerprint":
            return f"指纹匹配 {result.get('match_count', 0)}/{result.get('total', 0)}"
        return "命中"
