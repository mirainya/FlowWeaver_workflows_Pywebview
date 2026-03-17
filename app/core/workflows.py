from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from app.models import ActionDefinition, WorkflowBinding, WorkflowDefinition, WorkflowSettingDefinition
from app.core.step_normalizer import (
    _clamp_int,
    _clamp_float,
    sanitize_custom_steps,
    _normalize_custom_step,
)
from app.core.presets import build_preset_custom_flow_records


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
        "async_detect": "后台识图",
    }
    return titles.get(kind, kind)


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
        node_graph=record.get("node_graph"),
    )


def serialize_custom_flow_workflow(
    workflow: WorkflowDefinition,
    binding: WorkflowBinding,
) -> dict[str, Any]:
    return {
        "version": 1,
        "workflow_id": workflow.workflow_id,
        "name": workflow.name,
        "description": workflow.description,
        "category": workflow.category,
        "notes": list(workflow.notes),
        "hotkey": binding.hotkey,
        "enabled": binding.enabled,
        "run_mode": workflow.normalize_run_mode(),
        "steps": [serialize_action_to_step(action) for action in workflow.actions],
        "node_graph": workflow.node_graph,
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
