from __future__ import annotations

from copy import deepcopy
from typing import Any


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


DEFAULT_STEPS: list[dict[str, Any]] = [
    {
        "kind": "key_tap",
        "keys": "",
        "delay_ms_after": 100,
    }
]


def sanitize_custom_steps(raw_steps: Any) -> list[dict[str, Any]]:
    steps = [
        step
        for step in (
            _normalize_custom_step(raw_step)
            for raw_step in list(raw_steps or [])
        )
        if step is not None
    ]
    return steps or deepcopy(DEFAULT_STEPS)


def _normalize_custom_step(raw_step: Any) -> dict[str, Any] | None:
    if not isinstance(raw_step, dict):
        return None

    kind = str(raw_step.get("kind", raw_step.get("type", "key_tap"))).strip()
    if kind == "key_tap":
        return {
            "kind": "key_tap",
            "keys": str(raw_step.get("keys", "")).strip(),
            "delay_ms_after": _clamp_int(raw_step.get("delay_ms_after", raw_step.get("delay_ms", 100)), 100, 0, 600000),
        }

    if kind == "delay":
        return {
            "kind": "delay",
            "milliseconds": _clamp_int(raw_step.get("milliseconds", 100), 100, 0, 600000),
            "random_min": _clamp_int(raw_step.get("random_min", 0), 0, 0, 600000),
            "random_max": _clamp_int(raw_step.get("random_max", 0), 0, 0, 600000),
            "setting_key": str(raw_step.get("setting_key", "")).strip() if raw_step.get("setting_key") else "",
        }

    if kind == "detect_image":
        result: dict[str, Any] = {
            "kind": "detect_image",
            "template_path": str(raw_step.get("template_path", "")).strip(),
            "save_as": str(raw_step.get("save_as", "target")).strip() or "target",
            "confidence": _clamp_float(raw_step.get("confidence", 0.88), 0.88, 0.1, 1.0),
            "timeout_ms": _clamp_int(raw_step.get("timeout_ms", 2500), 2500, 100, 60000),
            "search_step": _clamp_int(raw_step.get("search_step", 4), 4, 1, 32),
        }
        raw_region = raw_step.get("search_region")
        if isinstance(raw_region, dict):
            result["search_region"] = {
                "left": _clamp_int(raw_region.get("left", 0), 0, 0, 100000),
                "top": _clamp_int(raw_region.get("top", 0), 0, 0, 100000),
                "width": _clamp_int(raw_region.get("width", 0), 0, 0, 100000),
                "height": _clamp_int(raw_region.get("height", 0), 0, 0, 100000),
            }
        return result

    if kind == "detect_click_return":
        result_dcr: dict[str, Any] = {
            "kind": "detect_click_return",
            "template_path": str(raw_step.get("template_path", "")).strip(),
            "save_as": str(raw_step.get("save_as", "target")).strip() or "target",
            "confidence": _clamp_float(raw_step.get("confidence", 0.88), 0.88, 0.1, 1.0),
            "timeout_ms": _clamp_int(raw_step.get("timeout_ms", 2500), 2500, 100, 60000),
            "search_step": _clamp_int(raw_step.get("search_step", 4), 4, 1, 32),
            "button": "right" if str(raw_step.get("button", "left")).strip() == "right" else "left",
            "settle_ms": _clamp_int(raw_step.get("settle_ms", 60), 60, 0, 10000),
        }
        raw_region_dcr = raw_step.get("search_region")
        if isinstance(raw_region_dcr, dict):
            result_dcr["search_region"] = {
                "left": _clamp_int(raw_region_dcr.get("left", 0), 0, 0, 100000),
                "top": _clamp_int(raw_region_dcr.get("top", 0), 0, 0, 100000),
                "width": _clamp_int(raw_region_dcr.get("width", 0), 0, 0, 100000),
                "height": _clamp_int(raw_region_dcr.get("height", 0), 0, 0, 100000),
            }
        return result_dcr

    if kind == "click_point":
        source = str(raw_step.get("source", "var")).strip()
        if source not in {"var", "absolute", "shared", "current"}:
            source = "var"
        result_cp: dict[str, Any] = {
            "kind": "click_point",
            "source": source,
            "button": "right" if str(raw_step.get("button", "left")).strip() == "right" else "left",
            "return_cursor": bool(raw_step.get("return_cursor", True)),
            "offset_x": _clamp_int(raw_step.get("offset_x", 0), 0, -100000, 100000),
            "offset_y": _clamp_int(raw_step.get("offset_y", 0), 0, -100000, 100000),
            "settle_ms": _clamp_int(raw_step.get("settle_ms", 60), 60, 0, 10000),
            "click_count": _clamp_int(raw_step.get("click_count", 1), 1, 1, 5),
        }
        if source in {"var", "shared"}:
            result_cp["var_name"] = str(raw_step.get("var_name", "target")).strip() or "target"
        elif source == "absolute":
            result_cp["x"] = _clamp_int(raw_step.get("x", 0), 0, -100000, 100000)
            result_cp["y"] = _clamp_int(raw_step.get("y", 0), 0, -100000, 100000)
        raw_modifiers = raw_step.get("modifiers")
        if isinstance(raw_modifiers, list):
            result_cp["modifiers"] = [m for m in raw_modifiers if m in {"ctrl", "shift", "alt"}]
            result_cp["modifier_delay_ms"] = _clamp_int(raw_step.get("modifier_delay_ms", 50), 50, 0, 5000)
        return result_cp

    if kind == "if_var_found":
        variable_scope = str(raw_step.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        return {
            "kind": "if_var_found",
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "variable_scope": variable_scope,
            "then_steps": sanitize_custom_steps(raw_step.get("then_steps", [])),
            "else_steps": sanitize_custom_steps(raw_step.get("else_steps", [])),
        }

    if kind == "if_condition":
        variable_scope = str(raw_step.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        operator = str(raw_step.get("operator", "==")).strip()
        if operator not in {">", ">=", "<", "<=", "==", "!="}:
            operator = "=="
        return {
            "kind": "if_condition",
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "variable_scope": variable_scope,
            "field": str(raw_step.get("field", "found")).strip() or "found",
            "operator": operator,
            "value": str(raw_step.get("value", "true")).strip(),
            "then_steps": sanitize_custom_steps(raw_step.get("then_steps", [])),
            "else_steps": sanitize_custom_steps(raw_step.get("else_steps", [])),
        }

    if kind == "set_variable_state":
        variable_scope = str(raw_step.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        state = str(raw_step.get("state", "missing")).strip()
        if state not in {"found", "missing"}:
            state = "missing"
        return {
            "kind": "set_variable_state",
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "variable_scope": variable_scope,
            "state": state,
        }

    if kind == "key_sequence":
        raw_sequence = list(raw_step.get("sequence", []))
        sequence = []
        for item in raw_sequence:
            if not isinstance(item, dict):
                continue
            keys = str(item.get("keys", "")).strip()
            if not keys:
                continue
            sequence.append({
                "keys": keys,
                "delay_ms": _clamp_int(item.get("delay_ms", 100), 100, 0, 600000),
            })
        return {"kind": "key_sequence", "sequence": sequence}

    if kind == "key_hold":
        return {
            "kind": "key_hold",
            "key": str(raw_step.get("key", "")).strip(),
            "duration_ms": _clamp_int(raw_step.get("duration_ms", 0), 0, 0, 600000),
            "steps": sanitize_custom_steps(raw_step.get("steps", [])),
        }

    if kind == "mouse_scroll":
        direction = str(raw_step.get("direction", "down")).strip()
        if direction not in {"up", "down", "left", "right"}:
            direction = "down"
        return {
            "kind": "mouse_scroll",
            "direction": direction,
            "clicks": _clamp_int(raw_step.get("clicks", 3), 3, 1, 100),
        }

    if kind == "mouse_hold":
        source = str(raw_step.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "shared", "current"}:
            source = "absolute"
        result_mh: dict[str, Any] = {
            "kind": "mouse_hold",
            "source": source,
            "button": "right" if str(raw_step.get("button", "left")).strip() == "right" else "left",
            "duration_ms": _clamp_int(raw_step.get("duration_ms", 500), 500, 0, 600000),
        }
        if source == "absolute":
            result_mh["x"] = _clamp_int(raw_step.get("x", 0), 0, -100000, 100000)
            result_mh["y"] = _clamp_int(raw_step.get("y", 0), 0, -100000, 100000)
        elif source in {"var", "shared"}:
            result_mh["var_name"] = str(raw_step.get("var_name", "target")).strip() or "target"
        result_mh["offset_x"] = _clamp_int(raw_step.get("offset_x", 0), 0, -100000, 100000)
        result_mh["offset_y"] = _clamp_int(raw_step.get("offset_y", 0), 0, -100000, 100000)
        return result_mh

    if kind == "detect_color":
        source = str(raw_step.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "current"}:
            source = "absolute"
        result_dc: dict[str, Any] = {
            "kind": "detect_color",
            "source": source,
            "expected_color": str(raw_step.get("expected_color", "")).strip(),
            "tolerance": _clamp_int(raw_step.get("tolerance", 20), 20, 0, 255),
            "save_as": str(raw_step.get("save_as", "color_result")).strip() or "color_result",
        }
        if source == "absolute":
            result_dc["x"] = _clamp_int(raw_step.get("x", 0), 0, -100000, 100000)
            result_dc["y"] = _clamp_int(raw_step.get("y", 0), 0, -100000, 100000)
        elif source == "var":
            result_dc["var_name"] = str(raw_step.get("var_name", "target")).strip() or "target"
            result_dc["variable_scope"] = str(raw_step.get("variable_scope", "local")).strip()
        result_dc["offset_x"] = _clamp_int(raw_step.get("offset_x", 0), 0, -100000, 100000)
        result_dc["offset_y"] = _clamp_int(raw_step.get("offset_y", 0), 0, -100000, 100000)
        return result_dc

    if kind == "loop":
        loop_type = str(raw_step.get("loop_type", "count")).strip()
        if loop_type not in {"count", "while_found", "while_not_found"}:
            loop_type = "count"
        result_loop: dict[str, Any] = {
            "kind": "loop",
            "loop_type": loop_type,
            "max_iterations": _clamp_int(raw_step.get("max_iterations", 10), 10, 1, 100000),
            "steps": sanitize_custom_steps(raw_step.get("steps", [])),
        }
        if loop_type != "count":
            variable_scope = str(raw_step.get("variable_scope", "local")).strip()
            if variable_scope not in {"local", "shared"}:
                variable_scope = "local"
            result_loop["var_name"] = str(raw_step.get("var_name", "target")).strip() or "target"
            result_loop["variable_scope"] = variable_scope
        return result_loop

    if kind == "call_workflow":
        return {
            "kind": "call_workflow",
            "target_workflow_id": str(raw_step.get("target_workflow_id", "")).strip(),
        }

    if kind == "log":
        level = str(raw_step.get("level", "info")).strip()
        if level not in {"info", "warn", "success"}:
            level = "info"
        return {
            "kind": "log",
            "message": str(raw_step.get("message", "")),
            "level": level,
        }

    if kind == "mouse_drag":
        source = str(raw_step.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "shared"}:
            source = "absolute"
        result_md: dict[str, Any] = {
            "kind": "mouse_drag",
            "source": source,
            "button": "right" if str(raw_step.get("button", "left")).strip() == "right" else "left",
            "duration_ms": _clamp_int(raw_step.get("duration_ms", 300), 300, 0, 600000),
            "steps": _clamp_int(raw_step.get("steps", 20), 20, 1, 1000),
        }
        if source == "absolute":
            result_md["start_x"] = _clamp_int(raw_step.get("start_x", 0), 0, -100000, 100000)
            result_md["start_y"] = _clamp_int(raw_step.get("start_y", 0), 0, -100000, 100000)
        else:
            result_md["var_name"] = str(raw_step.get("var_name", "target")).strip() or "target"
            result_md["start_offset_x"] = _clamp_int(raw_step.get("start_offset_x", 0), 0, -100000, 100000)
            result_md["start_offset_y"] = _clamp_int(raw_step.get("start_offset_y", 0), 0, -100000, 100000)
            result_md["end_offset_x"] = _clamp_int(raw_step.get("end_offset_x", 0), 0, -100000, 100000)
            result_md["end_offset_y"] = _clamp_int(raw_step.get("end_offset_y", 0), 0, -100000, 100000)
        result_md["end_x"] = _clamp_int(raw_step.get("end_x", 0), 0, -100000, 100000)
        result_md["end_y"] = _clamp_int(raw_step.get("end_y", 0), 0, -100000, 100000)
        return result_md

    if kind == "type_text":
        return {
            "kind": "type_text",
            "text": str(raw_step.get("text", "")),
        }

    if kind == "mouse_move":
        source = str(raw_step.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "shared"}:
            source = "absolute"
        result_mv: dict[str, Any] = {"kind": "mouse_move", "source": source}
        if source == "absolute":
            result_mv["x"] = _clamp_int(raw_step.get("x", 0), 0, -100000, 100000)
            result_mv["y"] = _clamp_int(raw_step.get("y", 0), 0, -100000, 100000)
        else:
            result_mv["var_name"] = str(raw_step.get("var_name", "target")).strip() or "target"
            result_mv["offset_x"] = _clamp_int(raw_step.get("offset_x", 0), 0, -100000, 100000)
            result_mv["offset_y"] = _clamp_int(raw_step.get("offset_y", 0), 0, -100000, 100000)
        return result_mv

    if kind == "set_variable":
        return {
            "kind": "set_variable",
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "field": str(raw_step.get("field", "found")).strip() or "found",
            "value": str(raw_step.get("value", "")),
        }

    if kind == "check_pixels":
        logic = str(raw_step.get("logic", "all")).strip()
        if logic not in {"all", "any"}:
            logic = "all"
        raw_points = list(raw_step.get("points", []))
        points = []
        for pt in raw_points:
            if not isinstance(pt, dict):
                continue
            points.append({
                "x": _clamp_int(pt.get("x", 0), 0, -100000, 100000),
                "y": _clamp_int(pt.get("y", 0), 0, -100000, 100000),
                "expected_color": str(pt.get("expected_color", "")).strip(),
                "tolerance": _clamp_int(pt.get("tolerance", 20), 20, 0, 255),
            })
        return {
            "kind": "check_pixels",
            "points": points,
            "logic": logic,
            "save_as": str(raw_step.get("save_as", "pixel_result")).strip() or "pixel_result",
        }

    if kind == "check_region_color":
        return {
            "kind": "check_region_color",
            "left": _clamp_int(raw_step.get("left", 0), 0, -100000, 100000),
            "top": _clamp_int(raw_step.get("top", 0), 0, -100000, 100000),
            "width": _clamp_int(raw_step.get("width", 100), 100, 1, 100000),
            "height": _clamp_int(raw_step.get("height", 100), 100, 1, 100000),
            "expected_color": str(raw_step.get("expected_color", "")).strip(),
            "tolerance": _clamp_int(raw_step.get("tolerance", 20), 20, 0, 255),
            "min_ratio": _clamp_float(raw_step.get("min_ratio", 0.5), 0.5, 0.01, 1.0),
            "save_as": str(raw_step.get("save_as", "region_color_result")).strip() or "region_color_result",
        }

    if kind == "detect_color_region":
        return {
            "kind": "detect_color_region",
            "h_min": _clamp_int(raw_step.get("h_min", 0), 0, 0, 179),
            "h_max": _clamp_int(raw_step.get("h_max", 179), 179, 0, 179),
            "s_min": _clamp_int(raw_step.get("s_min", 50), 50, 0, 255),
            "s_max": _clamp_int(raw_step.get("s_max", 255), 255, 0, 255),
            "v_min": _clamp_int(raw_step.get("v_min", 50), 50, 0, 255),
            "v_max": _clamp_int(raw_step.get("v_max", 255), 255, 0, 255),
            "region_left": _clamp_int(raw_step.get("region_left", 0), 0, 0, 100000),
            "region_top": _clamp_int(raw_step.get("region_top", 0), 0, 0, 100000),
            "region_width": _clamp_int(raw_step.get("region_width", 0), 0, 0, 100000),
            "region_height": _clamp_int(raw_step.get("region_height", 0), 0, 0, 100000),
            "min_area": _clamp_int(raw_step.get("min_area", 100), 100, 1, 1000000),
            "save_as": str(raw_step.get("save_as", "color_region_result")).strip() or "color_region_result",
        }

    if kind == "match_fingerprint":
        raw_sample_points = list(raw_step.get("sample_points", []))
        sample_points = []
        for sp in raw_sample_points:
            if not isinstance(sp, dict):
                continue
            sample_points.append({
                "dx": _clamp_int(sp.get("dx", 0), 0, -1000, 1000),
                "dy": _clamp_int(sp.get("dy", 0), 0, -1000, 1000),
                "expected_color": str(sp.get("expected_color", "")).strip(),
            })
        return {
            "kind": "match_fingerprint",
            "anchor_x": _clamp_int(raw_step.get("anchor_x", 0), 0, -100000, 100000),
            "anchor_y": _clamp_int(raw_step.get("anchor_y", 0), 0, -100000, 100000),
            "sample_points": sample_points,
            "tolerance": _clamp_int(raw_step.get("tolerance", 20), 20, 0, 255),
            "save_as": str(raw_step.get("save_as", "fingerprint_result")).strip() or "fingerprint_result",
        }

    if kind == "async_detect":
        scan_rate = str(raw_step.get("scan_rate", "normal")).strip()
        if scan_rate not in {"low", "normal", "high", "ultra", "custom"}:
            scan_rate = "normal"
        match_mode = str(raw_step.get("match_mode", "normal")).strip()
        if match_mode not in {"loose", "normal", "strict", "custom"}:
            match_mode = "normal"
        search_scope = str(raw_step.get("search_scope", "full_screen")).strip()
        if search_scope not in {"full_screen", "fixed_region"}:
            search_scope = "full_screen"
        not_found_action = str(raw_step.get("not_found_action", "mark_missing")).strip()
        if not_found_action not in {"mark_missing", "keep_last"}:
            not_found_action = "mark_missing"
        result_ad: dict[str, Any] = {
            "kind": "async_detect",
            "template_path": str(raw_step.get("template_path", "")).strip(),
            "save_as": str(raw_step.get("save_as", "async_target")).strip() or "async_target",
            "confidence": _clamp_float(raw_step.get("confidence", 0.88), 0.88, 0.1, 1.0),
            "timeout_ms": _clamp_int(raw_step.get("timeout_ms", 5000), 5000, 100, 120000),
            "scan_rate": scan_rate,
            "custom_interval_ms": _clamp_int(raw_step.get("custom_interval_ms", 350), 350, 10, 60000),
            "match_mode": match_mode,
            "search_scope": search_scope,
            "not_found_action": not_found_action,
        }
        raw_region = raw_step.get("search_region")
        if isinstance(raw_region, dict):
            result_ad["search_region"] = {
                "left": _clamp_int(raw_region.get("left", 0), 0, 0, 100000),
                "top": _clamp_int(raw_region.get("top", 0), 0, 0, 100000),
                "width": _clamp_int(raw_region.get("width", 0), 0, 0, 100000),
                "height": _clamp_int(raw_region.get("height", 0), 0, 0, 100000),
            }
        return result_ad

    return None
