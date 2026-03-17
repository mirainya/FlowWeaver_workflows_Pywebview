from __future__ import annotations

from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from threading import Event


class FlowHandlersMixin:
    """处理流程控制动作：loop, call_workflow, key_hold"""

    def _get_loop_config(self, params: dict[str, Any]) -> dict[str, Any]:
        """解析循环参数，返回 loop_type / max_iterations / var_name / variable_scope / expect_found。"""
        loop_type = str(params.get("loop_type", "count")).strip()
        max_iterations = max(1, int(params.get("max_iterations", 10)))
        config: dict[str, Any] = {
            "loop_type": loop_type,
            "max_iterations": max_iterations,
        }
        if loop_type != "count":
            var_name = str(params.get("var_name", "target")).strip() or "target"
            variable_scope = str(params.get("variable_scope", "local")).strip()
            if variable_scope not in {"local", "shared"}:
                variable_scope = "local"
            config["var_name"] = var_name
            config["variable_scope"] = variable_scope
            config["expect_found"] = loop_type == "while_found"
        return config

    def _check_loop_continue(self, config: dict[str, Any], context: dict[str, Any], iteration: int) -> bool:
        """判断是否继续循环。"""
        if iteration >= config["max_iterations"]:
            return False
        if config["loop_type"] == "count":
            return True
        var_name = config["var_name"]
        variable_scope = config["variable_scope"]
        val = self._resolve_variable(variable_scope, var_name, context) or {}
        return bool(val.get("found")) == config["expect_found"]

    def _handle_loop(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        loop_type = str(params.get("loop_type", "count")).strip()
        max_iterations = max(1, int(params.get("max_iterations", 10)))
        child_steps = [self._coerce_action(item) for item in list(params.get("steps", []))]

        if loop_type == "count":
            for i in range(max_iterations):
                if stop_event is not None and stop_event.is_set():
                    return
                self._emit_runtime_event(workflow_id, {"type": "loop", "iteration": i + 1, "max": max_iterations})
                self._execute_steps(workflow_id, child_steps, workflow_settings, context, stop_event)
        else:
            var_name = str(params.get("var_name", "target")).strip() or "target"
            variable_scope = str(params.get("variable_scope", "local")).strip()
            if variable_scope not in {"local", "shared"}:
                variable_scope = "local"
            expect_found = loop_type == "while_found"
            for i in range(max_iterations):
                if stop_event is not None and stop_event.is_set():
                    return
                val = self._resolve_variable(variable_scope, var_name, context) or {}
                if bool(val.get("found")) != expect_found:
                    break
                self._emit_runtime_event(workflow_id, {"type": "loop", "iteration": i + 1, "var_name": var_name, "found": val.get("found")})
                self._execute_steps(workflow_id, child_steps, workflow_settings, context, stop_event)

    def _handle_call_workflow(
        self,
        workflow_id: str,
        params: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        target_id = str(params.get("target_workflow_id", "")).strip()
        if not target_id:
            raise ValueError("子流程调用缺少 target_workflow_id")
        if self._call_workflow_handler is None:
            raise RuntimeError("当前版本不支持子流程调用")
        self._emit_runtime_event(workflow_id, {"type": "call_workflow", "target": target_id})
        self._call_workflow_handler(target_id, stop_event)

    def _handle_key_hold(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        key = str(params.get("key", "")).strip()
        if not key:
            raise ValueError("按住按键动作缺少 key 参数")
        duration_ms = int(params.get("duration_ms", 0))
        child_steps = [self._coerce_action(item) for item in list(params.get("steps", []))]
        self._input.press_key(key)
        try:
            self._emit_runtime_event(workflow_id, {"type": "key_hold", "key": key, "action": "press"})
            if duration_ms > 0 and not child_steps:
                self._wait_delay(duration_ms, stop_event)
            else:
                self._execute_steps(workflow_id, child_steps, workflow_settings, context, stop_event)
        finally:
            self._input.release_key(key)
            self._emit_runtime_event(workflow_id, {"type": "key_hold", "key": key, "action": "release"})
