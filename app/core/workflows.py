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
            "steps": sanitize_custom_steps(raw_step.get("steps", [])),
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
