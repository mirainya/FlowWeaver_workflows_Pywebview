from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from app.models import WorkflowBinding, WorkflowDefinition
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
    "node_graph": {
        "nodes": [
            {"id": "__start__", "kind": "__start__", "position": {"x": 80, "y": 60}, "params": {}},
            {"id": "__end__default", "kind": "__end__", "position": {"x": 80, "y": 220}, "params": {}},
        ],
        "edges": [
            {
                "id": "edge-__start__-__end__default",
                "source": "__start__",
                "sourceHandle": "bottom",
                "target": "__end__default",
                "targetHandle": "top",
            }
        ],
    },
}


VISUAL_NODE_KINDS = {
    "detect_image",
    "detect_click_return",
    "detect_color",
    "detect_color_region",
    "check_pixels",
    "check_region_color",
    "match_fingerprint",
    "async_detect",
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


def sanitize_node_graph(raw_node_graph: Any) -> dict[str, Any]:
    if not isinstance(raw_node_graph, dict):
        raise ValueError("流程缺少合法 node_graph。")

    raw_nodes = raw_node_graph.get("nodes")
    raw_edges = raw_node_graph.get("edges")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise ValueError("node_graph 结构非法：缺少 nodes/edges。")

    nodes: list[dict[str, Any]] = []
    seen_node_ids: set[str] = set()
    has_start = False
    has_end = False
    for raw_node in raw_nodes:
        if not isinstance(raw_node, dict):
            continue
        node_id = str(raw_node.get("id", "")).strip()
        kind = str(raw_node.get("kind", "")).strip()
        position = raw_node.get("position") if isinstance(raw_node.get("position"), dict) else {}
        if not node_id or not kind:
            continue
        if node_id in seen_node_ids:
            raise ValueError(f"node_graph 存在重复节点 id：{node_id}")
        seen_node_ids.add(node_id)
        has_start = has_start or kind == "__start__"
        has_end = has_end or kind == "__end__"
        nodes.append(
            {
                "id": node_id,
                "kind": kind,
                "position": {
                    "x": int(position.get("x", 0)),
                    "y": int(position.get("y", 0)),
                },
                "params": deepcopy(raw_node.get("params", {})) if isinstance(raw_node.get("params"), dict) else {},
            }
        )

    if not nodes or not has_start or not has_end:
        raise ValueError("node_graph 必须至少包含开始节点和结束节点。")

    edges: list[dict[str, Any]] = []
    seen_edge_ids: set[str] = set()
    source_handles: set[tuple[str, str]] = set()
    for raw_edge in raw_edges:
        if not isinstance(raw_edge, dict):
            continue
        edge_id = str(raw_edge.get("id", "")).strip()
        source = str(raw_edge.get("source", "")).strip()
        target = str(raw_edge.get("target", "")).strip()
        source_handle = str(raw_edge.get("sourceHandle", "bottom") or "bottom").strip() or "bottom"
        target_handle = str(raw_edge.get("targetHandle", "top") or "top").strip() or "top"
        if not edge_id or not source or not target:
            continue
        if source not in seen_node_ids or target not in seen_node_ids:
            raise ValueError(f"node_graph 边引用了不存在的节点：{edge_id}")
        if edge_id in seen_edge_ids:
            raise ValueError(f"node_graph 存在重复边 id：{edge_id}")
        unique_handle = (source, source_handle)
        if unique_handle in source_handles:
            raise ValueError(f"节点 {source} 的 handle {source_handle} 只能连接一条出边。")
        seen_edge_ids.add(edge_id)
        source_handles.add(unique_handle)
        edges.append(
            {
                "id": edge_id,
                "source": source,
                "sourceHandle": source_handle,
                "target": target,
                "targetHandle": target_handle,
            }
        )

    return {"nodes": nodes, "edges": edges}


def iter_node_payloads(node_graph: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(node_graph, dict):
        return []
    nodes = node_graph.get("nodes")
    if not isinstance(nodes, list):
        return []
    payloads: list[dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        kind = str(node.get("kind", "")).strip()
        if kind in {"", "__start__", "__end__"}:
            continue
        params = deepcopy(node.get("params", {})) if isinstance(node.get("params"), dict) else {}
        payloads.append({"kind": kind, **params})
    return payloads


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
    node_graph = sanitize_node_graph(record.get("node_graph"))
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
        hotkey=hotkey,
        run_mode=run_mode,
        notes=notes,
        source="custom",
        definition_editable=True,
        node_graph=node_graph,
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
        "node_graph": deepcopy(workflow.node_graph),
    }


def extract_shared_variable_names(node_graph: dict[str, Any] | None) -> set[str]:
    names: set[str] = set()
    source_scoped_kinds = {"click_point", "mouse_hold", "mouse_drag", "mouse_move"}
    variable_scoped_kinds = {"if_var_found", "if_condition", "detect_color", "loop", "set_variable_state", "set_variable"}

    for payload in iter_node_payloads(node_graph):
        kind = str(payload.get("kind", ""))
        uses_shared_source = kind in source_scoped_kinds and str(payload.get("source", "")) == "shared"
        uses_shared_scope = kind in variable_scoped_kinds and str(payload.get("variable_scope", "")) == "shared"
        if not uses_shared_source and not uses_shared_scope:
            continue

        var_name = str(payload.get("var_name", "")).strip()
        if var_name:
            names.add(var_name)
    return names


def workflow_has_visual_nodes(node_graph: dict[str, Any] | None) -> bool:
    return any(payload.get("kind") in VISUAL_NODE_KINDS for payload in iter_node_payloads(node_graph))
