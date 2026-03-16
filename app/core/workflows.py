from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from app.models import ActionDefinition, WorkflowBinding, WorkflowDefinition, WorkflowSettingDefinition


TAB_DEFINITIONS: list[dict[str, Any]] = [
    {
        "key": "flow_designer",
        "label": "流程编排",
        "description": "统一承载全部同步流程：内置示例、自定义流程、按键、循环、识图与组合动作。",
        "supports_create": True,
    },
    {
        "key": "async_vision",
        "label": "异步识图",
        "description": "在流程外持续识图，后台刷新共享变量，供流程内节点直接读取。",
        "supports_create": True,
    },
]


DEFAULT_CUSTOM_FLOW = {
    "run_mode": {"type": "once"},
    "steps": [
        {
            "kind": "key_tap",
            "keys": "",
            "delay_ms_after": 100,
        }
    ],
}


def get_tab_definitions() -> list[dict[str, Any]]:
    return [dict(item) for item in TAB_DEFINITIONS]


def default_custom_flow_payload() -> dict[str, Any]:
    return deepcopy(DEFAULT_CUSTOM_FLOW)


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


def sanitize_run_mode(raw_run_mode: Any) -> dict[str, Any]:
    raw = raw_run_mode if isinstance(raw_run_mode, dict) else {}
    mode_type = str(raw.get("type", "once")).strip()
    if mode_type not in {"once", "repeat_n", "toggle_loop"}:
        mode_type = "once"

    normalized: dict[str, Any] = {"type": mode_type}
    if mode_type == "repeat_n":
        normalized["count"] = _clamp_int(raw.get("count", 1), 1, 1, 100000)
    return normalized


def _step_title(kind: str) -> str:
    titles = {
        "key_tap": "按键触发",
        "delay": "延时等待",
        "detect_image": "识图存变量",
        "click_point": "点击坐标",
        "if_var_found": "识图分支",
        "set_variable_state": "变量赋值",
        "key_sequence": "按键序列",
        "key_hold": "按住按键",
        "mouse_scroll": "鼠标滚轮",
        "mouse_hold": "鼠标长按",
        "detect_color": "像素取色",
        "check_pixels": "多点像素检测",
        "check_region_color": "区域颜色占比",
        "detect_color_region": "HSV颜色区域",
        "match_fingerprint": "特征指纹匹配",
        "loop": "循环",
        "call_workflow": "调用子流程",
        "if_condition": "条件判断",
        "log": "调试日志",
        "mouse_drag": "鼠标拖拽",
        "type_text": "文本输入",
        "mouse_move": "鼠标移动",
        "set_variable": "变量赋值",
    }
    return titles.get(kind, kind)


def sanitize_custom_steps(raw_steps: Any) -> list[dict[str, Any]]:
    steps = [
        step
        for step in (
            _normalize_custom_step(raw_step)
            for raw_step in list(raw_steps or [])
        )
        if step is not None
    ]
    return steps or deepcopy(DEFAULT_CUSTOM_FLOW["steps"])


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
            "milliseconds": _clamp_int(raw_step.get("milliseconds", raw_step.get("delay_ms", 100)), 100, 0, 600000),
            "random_min": _clamp_int(raw_step.get("random_min", 0), 0, 0, 600000),
            "random_max": _clamp_int(raw_step.get("random_max", 0), 0, 0, 600000),
        }

    if kind == "detect_image":
        return {
            "kind": "detect_image",
            "template_path": str(raw_step.get("template_path", "")).strip(),
            "save_as": str(raw_step.get("save_as", "target")).strip() or "target",
            "confidence": _clamp_float(raw_step.get("confidence", 0.88), 0.88, 0.55, 0.99),
            "timeout_ms": _clamp_int(raw_step.get("timeout_ms", 2500), 2500, 100, 600000),
            "search_step": _clamp_int(raw_step.get("search_step", 4), 4, 1, 64),
        }

    if kind == "click_point":
        source = str(raw_step.get("source", "var")).strip()
        if source not in {"var", "absolute", "shared", "current"}:
            source = "var"
        raw_modifiers = list(raw_step.get("modifiers", []))
        modifiers = list(dict.fromkeys(m for m in raw_modifiers if m in {"ctrl", "shift", "alt"}))
        return {
            "kind": "click_point",
            "source": source,
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "x": _clamp_int(raw_step.get("x", 0), 0, -100000, 100000),
            "y": _clamp_int(raw_step.get("y", 0), 0, -100000, 100000),
            "offset_x": _clamp_int(raw_step.get("offset_x", 0), 0, -100000, 100000),
            "offset_y": _clamp_int(raw_step.get("offset_y", 0), 0, -100000, 100000),
            "button": "right" if str(raw_step.get("button", "left")).strip() == "right" else "left",
            "return_cursor": bool(raw_step.get("return_cursor", True)),
            "settle_ms": _clamp_int(raw_step.get("settle_ms", 60), 60, 0, 600000),
            "modifier_delay_ms": _clamp_int(raw_step.get("modifier_delay_ms", 50), 50, 0, 5000),
            "click_count": _clamp_int(raw_step.get("click_count", 1), 1, 1, 5),
            "modifiers": modifiers,
        }

    if kind == "if_var_found":
        variable_scope = str(raw_step.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        return {
            "kind": "if_var_found",
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "variable_scope": variable_scope,
            "then_steps": sanitize_custom_steps(raw_step.get("then_steps", [])),
            "else_steps": sanitize_custom_steps(raw_step.get("else_steps", [])) if raw_step.get("else_steps") else [],
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
        sequence: list[dict[str, Any]] = []
        for raw_item in list(raw_step.get("sequence", [])):
            if not isinstance(raw_item, dict):
                continue
            keys = str(raw_item.get("keys", "")).strip()
            if not keys:
                continue
            sequence.append(
                {
                    "keys": keys,
                    "delay_ms": _clamp_int(raw_item.get("delay_ms", 100), 100, 0, 600000),
                }
            )
        if not sequence:
            return None
        return {
            "kind": "key_sequence",
            "sequence": sequence,
        }

    if kind == "key_hold":
        key = str(raw_step.get("key", "")).strip()
        if not key:
            return None
        return {
            "kind": "key_hold",
            "key": key,
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
        button = str(raw_step.get("button", "left")).strip()
        if button not in {"left", "right", "middle"}:
            button = "left"
        source = str(raw_step.get("source", "current")).strip()
        if source not in {"current", "var", "shared", "absolute"}:
            source = "current"
        return {
            "kind": "mouse_hold",
            "button": button,
            "duration_ms": _clamp_int(raw_step.get("duration_ms", 500), 500, 0, 600000),
            "source": source,
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "x": _clamp_int(raw_step.get("x", 0), 0, -100000, 100000),
            "y": _clamp_int(raw_step.get("y", 0), 0, -100000, 100000),
            "offset_x": _clamp_int(raw_step.get("offset_x", 0), 0, -100000, 100000),
            "offset_y": _clamp_int(raw_step.get("offset_y", 0), 0, -100000, 100000),
            "settle_ms": _clamp_int(raw_step.get("settle_ms", 60), 60, 0, 600000),
        }

    if kind == "detect_color":
        source = str(raw_step.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "shared"}:
            source = "absolute"
        return {
            "kind": "detect_color",
            "source": source,
            "x": _clamp_int(raw_step.get("x", 0), 0, -100000, 100000),
            "y": _clamp_int(raw_step.get("y", 0), 0, -100000, 100000),
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "offset_x": _clamp_int(raw_step.get("offset_x", 0), 0, -100000, 100000),
            "offset_y": _clamp_int(raw_step.get("offset_y", 0), 0, -100000, 100000),
            "expected_color": str(raw_step.get("expected_color", "")).strip(),
            "tolerance": _clamp_int(raw_step.get("tolerance", 20), 20, 0, 255),
            "save_as": str(raw_step.get("save_as", "color_result")).strip() or "color_result",
        }

    if kind == "loop":
        loop_type = str(raw_step.get("loop_type", "count")).strip()
        if loop_type not in {"count", "while_found", "while_not_found"}:
            loop_type = "count"
        variable_scope = str(raw_step.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        return {
            "kind": "loop",
            "loop_type": loop_type,
            "max_iterations": _clamp_int(raw_step.get("max_iterations", 10), 10, 1, 99999),
            "var_name": str(raw_step.get("var_name", "target")).strip() or "target",
            "variable_scope": variable_scope,
            "steps": sanitize_custom_steps(raw_step.get("steps", [])),
        }

    if kind == "call_workflow":
        return {
            "kind": "call_workflow",
            "target_workflow_id": str(raw_step.get("target_workflow_id", "")).strip(),
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

    if kind == "log":
        level = str(raw_step.get("level", "info")).strip()
        if level not in {"info", "warn", "success"}:
            level = "info"
        return {
            "kind": "log",
            "message": str(raw_step.get("message", "")).strip(),
            "level": level,
        }

    if kind == "mouse_drag":
        source = str(raw_step.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "shared"}:
            source = "absolute"
        button = str(raw_step.get("button", "left")).strip()
        if button not in {"left", "right", "middle"}:
            button = "left"
        result: dict[str, Any] = {
            "kind": "mouse_drag",
            "source": source,
            "button": button,
            "duration_ms": _clamp_int(raw_step.get("duration_ms", 300), 300, 0, 60000),
        }
        if source == "absolute":
            result["start_x"] = _clamp_int(raw_step.get("start_x", 0), 0, -100000, 100000)
            result["start_y"] = _clamp_int(raw_step.get("start_y", 0), 0, -100000, 100000)
            result["end_x"] = _clamp_int(raw_step.get("end_x", 0), 0, -100000, 100000)
            result["end_y"] = _clamp_int(raw_step.get("end_y", 0), 0, -100000, 100000)
        else:
            result["var_name"] = str(raw_step.get("var_name", "target")).strip() or "target"
            result["start_offset_x"] = _clamp_int(raw_step.get("start_offset_x", 0), 0, -100000, 100000)
            result["start_offset_y"] = _clamp_int(raw_step.get("start_offset_y", 0), 0, -100000, 100000)
            result["end_offset_x"] = _clamp_int(raw_step.get("end_offset_x", 0), 0, -100000, 100000)
            result["end_offset_y"] = _clamp_int(raw_step.get("end_offset_y", 0), 0, -100000, 100000)
        return result

    if kind == "type_text":
        return {
            "kind": "type_text",
            "text": str(raw_step.get("text", "")),
            "interval_ms": _clamp_int(raw_step.get("interval_ms", 50), 50, 0, 5000),
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

    return None


def build_action_from_step(step: dict[str, Any]) -> ActionDefinition:
    params = {key: value for key, value in step.items() if key != "kind"}
    return ActionDefinition(
        kind=step["kind"],
        title=_step_title(step["kind"]),
        description="",
        params=params,
    )


def serialize_action_to_step(action: ActionDefinition) -> dict[str, Any]:
    step = {"kind": action.kind, **deepcopy(action.params)}
    if action.kind == "if_var_found":
        step["then_steps"] = [
            serialize_step_payload(item)
            for item in list(action.params.get("then_steps", []))
        ]
        step["else_steps"] = [
            serialize_step_payload(item)
            for item in list(action.params.get("else_steps", []))
        ]
    if action.kind == "key_hold":
        step["steps"] = [
            serialize_step_payload(item)
            for item in list(action.params.get("steps", []))
        ]
    return step


def serialize_step_payload(step: Any) -> dict[str, Any]:
    if isinstance(step, ActionDefinition):
        return serialize_action_to_step(step)
    if isinstance(step, dict):
        return deepcopy(step)
    return {"kind": "delay", "milliseconds": 100}


def iter_action_payloads(actions: list[ActionDefinition] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for action in actions:
        payload = serialize_step_payload(action)
        result.append(payload)
        if payload.get("kind") == "if_var_found":
            result.extend(iter_action_payloads(payload.get("then_steps", [])))
            result.extend(iter_action_payloads(payload.get("else_steps", [])))
        if payload.get("kind") == "key_hold":
            result.extend(iter_action_payloads(payload.get("steps", [])))
    return result


def build_preset_custom_flow_records(project_root: Path) -> list[dict[str, Any]]:
    template_path = (project_root / "assets" / "templates" / "target_demo.png").relative_to(project_root).as_posix()

    return [
        {
            "workflow_id": "preset-f9-f11-loop",
            "name": "F9 / F11 循环宏",
            "description": "按下反引号键后切换循环：F9 → 延时 → F11 → 延时 → 继续循环。",
            "category": "循环宏",
            "notes": [
                "按一次启动循环，再按一次同一热键停止。",
                "这是迁移后的预置流程，可直接在流程编排页编辑。",
            ],
            "hotkey": "`",
            "enabled": True,
            "run_mode": {"type": "toggle_loop"},
            "steps": [
                {"kind": "key_tap", "keys": "f9", "delay_ms_after": 0},
                {"kind": "delay", "milliseconds": 10},
                {"kind": "key_tap", "keys": "f11", "delay_ms_after": 0},
                {"kind": "delay", "milliseconds": 100},
            ],
        },
        {
            "workflow_id": "preset-combo-burst",
            "name": "连招序列",
            "description": "按一次热键，连续触发多组按键，适合作为技能循环或固定操作链。",
            "category": "按键编排",
            "notes": [
                "每一步都可以单独设置延迟。",
                "这是迁移后的预置流程，可直接在流程编排页编辑。",
            ],
            "hotkey": "alt+f7",
            "enabled": True,
            "run_mode": {"type": "once"},
            "steps": [
                {
                    "kind": "key_sequence",
                    "sequence": [
                        {"keys": "1", "delay_ms": 120},
                        {"keys": "2", "delay_ms": 120},
                        {"keys": "space", "delay_ms": 180},
                        {"keys": "ctrl+3", "delay_ms": 220},
                    ],
                }
            ],
        },
        {
            "workflow_id": "preset-vision-then-burst",
            "name": "识图后补按键",
            "description": "先识图保存坐标，再通过 if 分支决定是否点击并继续按键，展示上下文变量的用法。",
            "category": "组合流程",
            "notes": [
                "识图结果会写入变量 target，后续步骤可继续引用坐标。",
                "这是迁移后的预置流程，可直接在流程编排页编辑。",
            ],
            "hotkey": "alt+f8",
            "enabled": True,
            "run_mode": {"type": "once"},
            "steps": [
                {
                    "kind": "detect_image",
                    "template_path": template_path,
                    "save_as": "target",
                    "confidence": 0.88,
                    "timeout_ms": 2500,
                    "search_step": 4,
                },
                {
                    "kind": "if_var_found",
                    "var_name": "target",
                    "variable_scope": "local",
                    "then_steps": [
                        {
                            "kind": "click_point",
                            "source": "var",
                            "var_name": "target",
                            "button": "left",
                            "return_cursor": True,
                            "offset_x": 0,
                            "offset_y": 0,
                            "settle_ms": 50,
                        },
                        {"kind": "delay", "milliseconds": 200},
                        {
                            "kind": "key_sequence",
                            "sequence": [
                                {"keys": "f", "delay_ms": 100},
                                {"keys": "r", "delay_ms": 120},
                            ],
                        },
                    ],
                    "else_steps": [
                        {"kind": "delay", "milliseconds": 120},
                    ],
                },
            ],
        },
        {
            "workflow_id": "preset-vision-click-return",
            "name": "识图点击回位",
            "description": "按下热键后识图保存坐标，命中则点击目标并把鼠标移回原位。",
            "category": "识图动作",
            "notes": [
                "适合确认按钮、交互点、固定 UI 图标。",
                "建议把模板图放到 assets/templates 目录。",
            ],
            "hotkey": "alt+f6",
            "enabled": True,
            "run_mode": {"type": "once"},
            "steps": [
                {
                    "kind": "detect_image",
                    "template_path": template_path,
                    "save_as": "target",
                    "confidence": 0.88,
                    "timeout_ms": 2800,
                    "search_step": 4,
                },
                {
                    "kind": "if_var_found",
                    "var_name": "target",
                    "variable_scope": "local",
                    "then_steps": [
                        {
                            "kind": "click_point",
                            "source": "var",
                            "var_name": "target",
                            "button": "left",
                            "return_cursor": True,
                            "offset_x": 0,
                            "offset_y": 0,
                            "settle_ms": 60,
                        }
                    ],
                    "else_steps": [],
                },
            ],
        },
    ]


def build_custom_flow_workflows(records: list[dict[str, Any]]) -> list[WorkflowDefinition]:
    return [
        build_custom_flow_workflow(record)
        for record in records
        if str(record.get("workflow_id", "")).strip()
    ]


def build_custom_flow_workflow(record: dict[str, Any]) -> WorkflowDefinition:
    workflow_id = str(record.get("workflow_id", "")).strip()
    name = str(record.get("name", workflow_id or "自定义流程")).strip() or "自定义流程"
    description = str(record.get("description", "")).strip() or "用户在流程编排页创建的自定义流程。"
    category = str(record.get("category", "流程编排")).strip() or "流程编排"
    hotkey = str(record.get("hotkey", "")).strip()
    run_mode = sanitize_run_mode(record.get("run_mode", {}))
    steps = sanitize_custom_steps(record.get("steps", []))
    notes = [
        str(item).strip()
        for item in list(record.get("notes", []))
        if str(item).strip()
    ]
    if not notes:
        notes = [
            "这是用户自定义的流程，可在流程编排页继续编辑。",
            "支持一次执行、次数循环和开关循环。",
        ]

    return WorkflowDefinition(
        workflow_id=workflow_id,
        name=name,
        description=description,
        category=category,
        tab_key="flow_designer",
        default_hotkey=hotkey,
        run_mode=run_mode,
        notes=notes,
        actions=[build_action_from_step(step) for step in steps],
        source="custom",
        definition_editable=True,
    )


def serialize_custom_flow_workflow(
    workflow: WorkflowDefinition,
    binding: WorkflowBinding,
) -> dict[str, Any]:
    return {
        "workflow_id": workflow.workflow_id,
        "name": workflow.name,
        "description": workflow.description,
        "category": workflow.category,
        "notes": list(workflow.notes),
        "hotkey": binding.hotkey,
        "enabled": binding.enabled,
        "run_mode": workflow.normalize_run_mode(),
        "steps": [serialize_action_to_step(action) for action in workflow.actions],
    }


def extract_shared_variable_names(actions: list[ActionDefinition] | list[dict[str, Any]]) -> set[str]:
    """遍历所有扁平化步骤，提取引用了共享变量的 var_name。"""
    names: set[str] = set()
    for payload in iter_action_payloads(actions):
        kind = str(payload.get("kind", ""))
        if kind == "click_point" and str(payload.get("source", "")) == "shared":
            var_name = str(payload.get("var_name", "")).strip()
            if var_name:
                names.add(var_name)
        elif kind == "if_var_found" and str(payload.get("variable_scope", "")) == "shared":
            var_name = str(payload.get("var_name", "")).strip()
            if var_name:
                names.add(var_name)
        elif kind == "set_variable_state" and str(payload.get("variable_scope", "")) == "shared":
            var_name = str(payload.get("var_name", "")).strip()
            if var_name:
                names.add(var_name)
    return names
