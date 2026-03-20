from __future__ import annotations

import logging
from typing import Any, TYPE_CHECKING

from app.models import ActionDefinition

if TYPE_CHECKING:
    from threading import Event

logger = logging.getLogger(__name__)

CONDITION_KINDS = {"if_var_found", "if_condition"}
VISUAL_DETECT_KINDS = {
    "detect_image",
    "detect_click_return",
    "detect_color",
    "detect_color_region",
    "check_pixels",
    "check_region_color",
    "match_fingerprint",
    "async_detect",
}
LOOP_KINDS = {"loop", "key_hold"}
ALLOWED_HANDLES = {"top", "bottom", "then", "else", "loop"}


class GraphRunner:
    """基于 node_graph 的纯图遍历执行引擎。"""

    def __init__(self, executor: Any) -> None:
        self._executor = executor

    def execute(
        self,
        workflow_id: str,
        node_graph: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        nodes_map = self._build_nodes_map(node_graph)
        adjacency = self._build_adjacency(node_graph, nodes_map)
        start_id = self._find_start(nodes_map)
        self._validate_graph(nodes_map, adjacency, start_id)
        self._executor._logger(
            f"图执行准备完成：workflow={workflow_id}，start_node={start_id}，nodes={len(nodes_map)}，edges={len(node_graph.get('edges', []))}",
            "info",
        )
        self._walk(
            workflow_id,
            start_id,
            nodes_map,
            adjacency,
            path_guard=[],
            settings=workflow_settings,
            context=context,
            stop_event=stop_event,
        )

    def _build_nodes_map(self, node_graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
        nodes_map: dict[str, dict[str, Any]] = {}
        for raw_node in node_graph.get("nodes", []):
            if not isinstance(raw_node, dict):
                continue
            node_id = str(raw_node.get("id", "")).strip()
            if not node_id:
                continue
            nodes_map[node_id] = raw_node
        return nodes_map

    def _build_adjacency(self, node_graph: dict[str, Any], nodes_map: dict[str, dict[str, Any]]) -> dict[str, str]:
        adjacency: dict[str, str] = {}
        for edge in node_graph.get("edges", []):
            if not isinstance(edge, dict):
                continue
            source = str(edge.get("source", "")).strip()
            target = str(edge.get("target", "")).strip()
            source_handle = str(edge.get("sourceHandle", "bottom") or "bottom").strip() or "bottom"
            if source not in nodes_map or target not in nodes_map:
                raise RuntimeError(f"图中存在引用缺失节点的边：{edge.get('id', '')}")
            if source_handle not in ALLOWED_HANDLES:
                raise RuntimeError(f"图中存在非法 sourceHandle：{source_handle}")
            key = f"{source}::{source_handle}"
            if key in adjacency:
                raise RuntimeError(f"节点 {source} 的 handle {source_handle} 存在多条出边")
            adjacency[key] = target
        return adjacency

    def _find_start(self, nodes_map: dict[str, dict[str, Any]]) -> str:
        start_candidates = [node_id for node_id, node in nodes_map.items() if node.get("kind") == "__start__"]
        if len(start_candidates) != 1:
            raise RuntimeError("node_graph 必须且只能包含一个开始节点。")
        return start_candidates[0]

    def _validate_graph(self, nodes_map: dict[str, dict[str, Any]], adjacency: dict[str, str], start_id: str) -> None:
        end_candidates = [node_id for node_id, node in nodes_map.items() if node.get("kind") == "__end__"]
        if not end_candidates:
            raise RuntimeError("node_graph 至少需要一个结束节点。")

        reachable = set()
        stack = [start_id]
        while stack:
            current = stack.pop()
            if current in reachable:
                continue
            reachable.add(current)
            for handle in ("bottom", "then", "else", "loop"):
                target = adjacency.get(f"{current}::{handle}")
                if target and target not in reachable:
                    stack.append(target)

        orphans = [node_id for node_id, node in nodes_map.items() if node.get("kind") != "__end__" and node_id not in reachable]
        if orphans:
            raise RuntimeError(f"图中存在孤儿节点：{', '.join(sorted(orphans))}")

        for node_id, node in nodes_map.items():
            kind = str(node.get("kind", ""))
            if kind == "__start__" and f"{node_id}::bottom" not in adjacency:
                raise RuntimeError("开始节点必须连接到底部后继。")
            if kind in CONDITION_KINDS:
                then_target = adjacency.get(f"{node_id}::then")
                else_target = adjacency.get(f"{node_id}::else")
                if then_target is None or else_target is None:
                    raise RuntimeError(f"条件节点 {node_id} 缺少 then/else 分支。")
            if kind in LOOP_KINDS and adjacency.get(f"{node_id}::loop") is None:
                raise RuntimeError(f"循环节点 {node_id} 缺少 loop 分支。")

    def _walk(
        self,
        workflow_id: str,
        start_id: str | None,
        nodes_map: dict[str, dict],
        adjacency: dict[str, str],
        path_guard: list[str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        current_id = start_id
        current_path = list(path_guard)

        while current_id is not None:
            if stop_event is not None and stop_event.is_set():
                return
            if current_id in current_path:
                cycle_path = " -> ".join([*current_path, current_id])
                logger.error("检测到未受控环：%s", cycle_path)
                raise RuntimeError(f"图中存在未受控环：{cycle_path}")

            node = nodes_map.get(current_id)
            if not node:
                self._executor._logger(f"图执行提前结束：未找到节点 {current_id}", "warn")
                return

            current_path.append(current_id)
            kind = node.get("kind", "")

            if kind == "__start__":
                current_id = self._next_target(adjacency, current_id, "bottom")
                continue
            if kind == "__end__":
                self._executor._logger(f"图执行到达结束节点：{current_id}", "info")
                return

            if kind in CONDITION_KINDS:
                current_id = self._handle_condition_node(
                    workflow_id,
                    current_id,
                    node,
                    adjacency,
                    context,
                )
                continue

            if kind in VISUAL_DETECT_KINDS:
                if self._has_branch_edges(adjacency, current_id):
                    current_id = self._handle_visual_branch_node(
                        workflow_id,
                        current_id,
                        node,
                        adjacency,
                        settings,
                        context,
                        stop_event,
                    )
                else:
                    self._execute_node(workflow_id, node, settings, context, stop_event)
                    current_id = self._next_target(adjacency, current_id, "bottom")
                continue

            if kind in LOOP_KINDS:
                self._handle_loop_node(
                    workflow_id,
                    current_id,
                    node,
                    nodes_map,
                    adjacency,
                    current_path,
                    settings,
                    context,
                    stop_event,
                )
                current_id = self._next_target(adjacency, current_id, "bottom")
                continue

            self._execute_node(workflow_id, node, settings, context, stop_event)
            current_id = self._next_target(adjacency, current_id, "bottom")

    def _handle_condition_node(
        self,
        workflow_id: str,
        node_id: str,
        node: dict[str, Any],
        adjacency: dict[str, str],
        context: dict[str, Any],
    ) -> str | None:
        kind = node.get("kind", "")
        params = node.get("params", {})

        self._emit_step_enter(workflow_id, node)
        try:
            if kind == "if_var_found":
                found = self._executor._evaluate_if_var_found(workflow_id, params, context)
            else:
                found = self._executor._evaluate_if_condition_result(workflow_id, params, context)
        finally:
            self._emit_step_exit(workflow_id, node)

        handle = "then" if found else "else"
        return self._next_target(adjacency, node_id, handle)

    def _handle_visual_branch_node(
        self,
        workflow_id: str,
        node_id: str,
        node: dict[str, Any],
        adjacency: dict[str, str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> str | None:
        found = self._do_visual_detect(workflow_id, node, settings, context, stop_event)
        handle = "then" if found else "else"
        return self._next_target(adjacency, node_id, handle)

    def _handle_loop_node(
        self,
        workflow_id: str,
        node_id: str,
        node: dict[str, Any],
        nodes_map: dict[str, dict],
        adjacency: dict[str, str],
        path_guard: list[str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        loop_target = self._next_target(adjacency, node_id, "loop")
        kind = node.get("kind", "")
        params = node.get("params", {})

        if kind == "key_hold":
            self._execute_key_hold_loop(
                workflow_id,
                node,
                loop_target,
                nodes_map,
                adjacency,
                path_guard,
                settings,
                context,
                stop_event,
            )
            return

        config = self._executor._get_loop_config(params)
        self._emit_step_enter(workflow_id, node)
        try:
            for index in range(config["max_iterations"]):
                if stop_event is not None and stop_event.is_set():
                    return
                if not self._executor._check_loop_continue(config, context, index):
                    break
                self._executor._emit_runtime_event(
                    workflow_id,
                    {
                        "type": "loop",
                        "iteration": index + 1,
                        "max": config["max_iterations"],
                        "node_id": node_id,
                    },
                )
                if loop_target:
                    self._walk(
                        workflow_id,
                        loop_target,
                        nodes_map,
                        adjacency,
                        path_guard=path_guard,
                        settings=settings,
                        context=context,
                        stop_event=stop_event,
                    )
        finally:
            self._emit_step_exit(workflow_id, node)

    def _execute_key_hold_loop(
        self,
        workflow_id: str,
        node: dict[str, Any],
        loop_target: str | None,
        nodes_map: dict[str, dict],
        adjacency: dict[str, str],
        path_guard: list[str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        params = node.get("params", {})
        key = str(params.get("key", "")).strip()
        if not key:
            raise ValueError("按住按键动作缺少 key 参数")
        duration_ms = int(params.get("duration_ms", 0))

        self._emit_step_enter(workflow_id, node)
        self._executor._input.press_key(key)
        try:
            self._executor._emit_runtime_event(
                workflow_id,
                {"type": "key_hold", "key": key, "action": "press", "node_id": node.get("id", "")},
            )
            if loop_target:
                self._walk(
                    workflow_id,
                    loop_target,
                    nodes_map,
                    adjacency,
                    path_guard=path_guard,
                    settings=settings,
                    context=context,
                    stop_event=stop_event,
                )
            elif duration_ms > 0:
                self._executor._wait_delay(duration_ms, stop_event)
        finally:
            self._executor._input.release_key(key)
            self._executor._emit_runtime_event(
                workflow_id,
                {"type": "key_hold", "key": key, "action": "release", "node_id": node.get("id", "")},
            )
            self._emit_step_exit(workflow_id, node)

    def _execute_node(
        self,
        workflow_id: str,
        node: dict[str, Any],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        kind = node.get("kind", "")
        params = {
            key: value
            for key, value in node.get("params", {}).items()
            if key not in ("kind", "type", "title", "description")
        }
        action = ActionDefinition(
            kind=kind,
            title=node.get("title", kind),
            description=node.get("description", ""),
            params=params,
        )
        self._emit_step_enter(workflow_id, node)
        try:
            self._executor._execute_action(workflow_id, action, settings, context, stop_event)
        finally:
            self._emit_step_exit(workflow_id, node)

    def _do_visual_detect(
        self,
        workflow_id: str,
        node: dict[str, Any],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> bool:
        kind = node.get("kind", "")
        params = {
            key: value
            for key, value in node.get("params", {}).items()
            if key not in ("kind", "type", "title", "description")
        }

        self._emit_step_enter(workflow_id, node)
        try:
            if kind == "detect_click_return":
                return self._do_detect_click_return(
                    workflow_id,
                    params,
                    settings,
                    context,
                    stop_event,
                )
            dispatch = {
                "detect_image": self._executor._do_detect_image,
                "detect_color": self._executor._do_detect_color,
                "detect_color_region": self._executor._do_detect_color_region,
                "check_pixels": self._executor._do_check_pixels,
                "check_region_color": self._executor._do_check_region_color,
                "match_fingerprint": self._executor._do_match_fingerprint,
                "async_detect": self._executor._do_async_detect,
            }
            handler = dispatch.get(kind)
            if handler is None:
                logger.warning("未知的视觉检测类型: %s，按 not found 处理", kind)
                return False
            return handler(workflow_id, params, settings, context, stop_event)
        finally:
            self._emit_step_exit(workflow_id, node)

    def _do_detect_click_return(
        self,
        workflow_id: str,
        params: dict[str, Any],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> bool:
        save_as = str(params.get("save_as", "target")).strip() or "target"
        detect_params = dict(params)
        detect_params["save_as"] = save_as

        found = self._executor._do_detect_image(
            workflow_id,
            detect_params,
            settings,
            context,
            stop_event,
        )
        if not found:
            return False
        if stop_event is not None and stop_event.is_set():
            return True

        match = self._executor._snapshot_local_var(context, save_as)
        if match and match.get("found"):
            self._executor._handle_click_point(
                workflow_id,
                {
                    "source": "var",
                    "var_name": save_as,
                    "button": params.get("button", "left"),
                    "return_cursor": True,
                    "offset_x": params.get("offset_x", 0),
                    "offset_y": params.get("offset_y", 0),
                    "settle_ms": params.get("settle_ms", 60),
                    "click_count": params.get("click_count", 1),
                    "modifiers": params.get("modifiers", []),
                    "modifier_delay_ms": params.get("modifier_delay_ms", 50),
                },
                context,
                stop_event,
            )
        return True

    def _has_branch_edges(self, adjacency: dict[str, str], node_id: str) -> bool:
        return (
            self._next_target(adjacency, node_id, "then") is not None
            or self._next_target(adjacency, node_id, "else") is not None
        )

    def _next_target(self, adjacency: dict[str, str], node_id: str, handle: str) -> str | None:
        return adjacency.get(f"{node_id}::{handle}")

    def _emit_step_enter(self, workflow_id: str, node: dict[str, Any]) -> None:
        self._executor._emit_runtime_event(
            workflow_id,
            {
                "type": "step_enter",
                "node_id": node.get("id", ""),
                "step_kind": node.get("kind", ""),
                "step_title": node.get("title", node.get("kind", "")),
            },
        )

    def _emit_step_exit(self, workflow_id: str, node: dict[str, Any]) -> None:
        self._executor._emit_runtime_event(
            workflow_id,
            {
                "type": "step_exit",
                "node_id": node.get("id", ""),
                "step_kind": node.get("kind", ""),
            },
        )
