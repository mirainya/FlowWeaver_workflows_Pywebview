from __future__ import annotations

import logging
from typing import Any, TYPE_CHECKING

from app.models import ActionDefinition

if TYPE_CHECKING:
    from threading import Event

logger = logging.getLogger(__name__)

# 条件节点：走 then/else 分支后续接 bottom
CONDITION_KINDS = {"if_var_found", "if_condition"}

# 视觉检测节点：可能有 then/else 分支边
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

# 循环节点：有 loop 边
LOOP_KINDS = {"loop", "key_hold"}


class GraphRunner:
    """基于 node_graph 的图遍历执行引擎。"""

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
        nodes_map = {n["id"]: n for n in node_graph["nodes"]}
        adjacency: dict[str, str] = {}
        for e in node_graph.get("edges", []):
            source_handle = e.get("sourceHandle", "bottom")
            key = f"{e['source']}::{source_handle}"
            adjacency[key] = e["target"]

        start_id = self._find_start(nodes_map, adjacency)
        visited: set[str] = set()
        self._walk(workflow_id, start_id, nodes_map, adjacency,
                   visited, workflow_settings, context, stop_event)

    def _find_start(self, nodes_map: dict[str, dict], adjacency: dict[str, str]) -> str:
        """找到 __start__ 节点，如果没有则找入度为 0 的节点。"""
        for node_id, node in nodes_map.items():
            if node.get("kind") == "__start__":
                return node_id

        targets = set(adjacency.values())
        for node_id in nodes_map:
            if node_id not in targets:
                return node_id
        return next(iter(nodes_map))

    def _walk(
        self,
        workflow_id: str,
        start_id: str | None,
        nodes_map: dict[str, dict],
        adjacency: dict[str, str],
        visited: set[str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        """沿 bottom 边迭代前进，条件/视觉检测节点递归处理分支。"""
        current_id = start_id
        while current_id is not None:
            if stop_event is not None and stop_event.is_set():
                return
            if current_id in visited:
                return
            visited.add(current_id)
            node = nodes_map.get(current_id)
            if not node:
                return

            kind = node.get("kind", "")

            # ── 开始节点：直接跳过 ──
            if kind == "__start__":
                current_id = adjacency.get(f"{current_id}::bottom")
                continue
            # ── 结束节点：停止 ──
            if kind == "__end__":
                return

            # ── 条件节点 ──
            if kind in CONDITION_KINDS:
                self._handle_condition_node(
                    workflow_id, current_id, node, nodes_map, adjacency,
                    visited, settings, context, stop_event,
                )
                current_id = adjacency.get(f"{current_id}::bottom")
                continue

            # ── 视觉检测（可选分支）──
            if kind in VISUAL_DETECT_KINDS:
                then_t = adjacency.get(f"{current_id}::then")
                else_t = adjacency.get(f"{current_id}::else")
                if then_t or else_t:
                    # 有分支边 → 检测后按图的 then/else 边走
                    self._handle_visual_branch_node(
                        workflow_id, current_id, node, nodes_map, adjacency,
                        visited, settings, context, stop_event,
                    )
                    current_id = adjacency.get(f"{current_id}::bottom")
                    continue
                # 无分支边 → 仅检测，不走 params 里的 then_steps/else_steps
                self._execute_node_strip_branches(
                    workflow_id, node, settings, context, stop_event,
                )
                current_id = adjacency.get(f"{current_id}::bottom")
                continue

            # ── 循环节点 ──
            if kind in LOOP_KINDS:
                loop_target = adjacency.get(f"{current_id}::loop")
                self._handle_loop_node(
                    workflow_id, current_id, node, loop_target, nodes_map,
                    adjacency, settings, context, stop_event,
                )
                current_id = adjacency.get(f"{current_id}::bottom")
                continue

            # ── 普通节点：执行后走 bottom ──
            self._execute_node(workflow_id, node, settings, context, stop_event)
            current_id = adjacency.get(f"{current_id}::bottom")

    def _handle_condition_node(
        self,
        workflow_id: str,
        node_id: str,
        node: dict[str, Any],
        nodes_map: dict[str, dict],
        adjacency: dict[str, str],
        visited: set[str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        """评估条件节点，递归 walk 选中的分支。"""
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
        branch_target = adjacency.get(f"{node_id}::{handle}")
        if branch_target:
            self._walk(workflow_id, branch_target, nodes_map, adjacency,
                       visited, settings, context, stop_event)

    def _handle_visual_branch_node(
        self,
        workflow_id: str,
        node_id: str,
        node: dict[str, Any],
        nodes_map: dict[str, dict],
        adjacency: dict[str, str],
        visited: set[str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        """执行视觉检测，递归 walk 选中的分支。"""
        found = self._do_visual_detect(workflow_id, node, settings, context, stop_event)

        handle = "then" if found else "else"
        target = adjacency.get(f"{node_id}::{handle}")
        if target:
            self._walk(workflow_id, target, nodes_map, adjacency,
                       visited, settings, context, stop_event)

    def _handle_loop_node(
        self,
        workflow_id: str,
        node_id: str,
        node: dict[str, Any],
        loop_target: str | None,
        nodes_map: dict[str, dict],
        adjacency: dict[str, str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        """执行循环节点，循环体每次迭代用全新 visited。"""
        kind = node.get("kind", "")
        params = node.get("params", {})

        if kind == "key_hold":
            self._execute_key_hold_loop(
                workflow_id, node, loop_target, nodes_map, adjacency,
                settings, context, stop_event,
            )
            return

        config = self._executor._get_loop_config(params)
        for i in range(config["max_iterations"]):
            if stop_event is not None and stop_event.is_set():
                return
            if not self._executor._check_loop_continue(config, context, i):
                break
            self._executor._emit_runtime_event(workflow_id, {
                "type": "loop",
                "iteration": i + 1,
                "max": config["max_iterations"],
            })
            if loop_target:
                loop_visited: set[str] = set()
                self._walk(workflow_id, loop_target, nodes_map, adjacency,
                           loop_visited, settings, context, stop_event)

    def _execute_key_hold_loop(
        self,
        workflow_id: str,
        node: dict[str, Any],
        loop_target: str | None,
        nodes_map: dict[str, dict],
        adjacency: dict[str, str],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        """key_hold 节点：按下按键 → 执行循环体 → 释放按键。"""
        params = node.get("params", {})
        key = str(params.get("key", "")).strip()
        if not key:
            raise ValueError("按住按键动作缺少 key 参数")
        duration_ms = int(params.get("duration_ms", 0))

        self._executor._input.press_key(key)
        try:
            self._executor._emit_runtime_event(workflow_id, {"type": "key_hold", "key": key, "action": "press"})
            if loop_target:
                loop_visited: set[str] = set()
                self._walk(workflow_id, loop_target, nodes_map, adjacency,
                           loop_visited, settings, context, stop_event)
            elif duration_ms > 0:
                self._executor._wait_delay(duration_ms, stop_event)
        finally:
            self._executor._input.release_key(key)
            self._executor._emit_runtime_event(workflow_id, {"type": "key_hold", "key": key, "action": "release"})

    def _execute_node(
        self,
        workflow_id: str,
        node: dict[str, Any],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        """构建 ActionDefinition 并调用 executor._execute_action。"""
        kind = node.get("kind", "")
        params = dict(node.get("params", {}))
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

    def _execute_node_strip_branches(
        self,
        workflow_id: str,
        node: dict[str, Any],
        settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        """执行视觉检测节点但移除 params 中的 then_steps/else_steps，
        防止图模式下意外走 params 里的嵌套分支。"""
        kind = node.get("kind", "")
        params = dict(node.get("params", {}))
        params.pop("then_steps", None)
        params.pop("else_steps", None)
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
        """分发到对应的 _do_xxx 检测方法，返回 found。"""
        kind = node.get("kind", "")
        params = dict(node.get("params", {}))

        self._emit_step_enter(workflow_id, node)
        try:
            if kind == "detect_click_return":
                return self._do_detect_click_return(
                    workflow_id, params, settings, context, stop_event,
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
        """识图后若命中则点击，返回 found。"""
        save_as = str(params.get("save_as", "target")).strip() or "target"
        detect_params = dict(params)
        detect_params["save_as"] = save_as

        found = self._executor._do_detect_image(
            workflow_id, detect_params, settings, context, stop_event,
        )
        if not found:
            return False
        if stop_event is not None and stop_event.is_set():
            return True

        # 识图命中 → 执行点击
        match = self._executor._snapshot_local_var(context, save_as)
        if match and match.get("found"):
            self._executor._handle_click_point(
                workflow_id,
                {
                    "source": "var",
                    "var_name": save_as,
                    "button": params.get("button", "left"),
                    "return_cursor": True,
                    "offset_x": 0,
                    "offset_y": 0,
                    "settle_ms": params.get("settle_ms", 60),
                },
                context,
                stop_event,
            )
        return True

    def _emit_step_enter(self, workflow_id: str, node: dict[str, Any]) -> None:
        self._executor._emit_runtime_event(workflow_id, {
            "type": "step_enter",
            "node_id": node.get("id", ""),
            "step_kind": node.get("kind", ""),
            "step_title": node.get("title", node.get("kind", "")),
        })

    def _emit_step_exit(self, workflow_id: str, node: dict[str, Any]) -> None:
        self._executor._emit_runtime_event(workflow_id, {
            "type": "step_exit",
            "node_id": node.get("id", ""),
            "step_kind": node.get("kind", ""),
        })
