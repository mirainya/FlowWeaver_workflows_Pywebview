from __future__ import annotations

import time
from copy import deepcopy
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from threading import Event


class VariableHandlersMixin:
    """处理变量动作：if_var_found, if_condition, set_variable_state, set_variable"""

    def _evaluate_if_var_found(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> bool:
        """仅评估 if_var_found 条件并发事件，不执行分支步骤。"""
        var_name = str(params.get("var_name", "target")).strip() or "target"
        variable_scope = str(params.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        branch_value = self._resolve_variable(variable_scope, var_name, context) or {}
        found = bool(branch_value.get("found"))
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "branch",
                "var_name": var_name,
                "found": found,
                "message": f"条件 {var_name}.found = {'true' if found else 'false'}，进入 {'then' if found else 'else'} 分支。",
            },
        )
        return found

    def _handle_if_var_found(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        found = self._evaluate_if_var_found(workflow_id, params, context)
        branch_key = "then_steps" if found else "else_steps"
        branch_steps = [self._coerce_action(item) for item in list(params.get(branch_key, []))]
        self._execute_steps(workflow_id, branch_steps, workflow_settings, context, stop_event)

    def _evaluate_condition(self, variable_scope: str, var_name: str, field: str, operator: str, value: str, context: dict[str, Any]) -> bool:
        var_data = self._resolve_variable(variable_scope, var_name, context) or {}
        actual = var_data.get(field)
        if actual is None:
            return operator == "=="  and value.lower() in ("", "none", "null")
        try:
            actual_num = float(actual)
            value_num = float(value)
            if operator == ">":
                return actual_num > value_num
            if operator == ">=":
                return actual_num >= value_num
            if operator == "<":
                return actual_num < value_num
            if operator == "<=":
                return actual_num <= value_num
            if operator == "==":
                return actual_num == value_num
            if operator == "!=":
                return actual_num != value_num
        except (TypeError, ValueError):
            pass
        actual_str = str(actual).strip().lower()
        value_str = str(value).strip().lower()
        if operator == "==":
            return actual_str == value_str
        if operator == "!=":
            return actual_str != value_str
        return False

    def _evaluate_if_condition_result(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> bool:
        """仅评估 if_condition 条件并发事件，不执行分支步骤。"""
        var_name = str(params.get("var_name", "target")).strip() or "target"
        variable_scope = str(params.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        field = str(params.get("field", "found")).strip() or "found"
        operator = str(params.get("operator", "==")).strip()
        if operator not in {">", ">=", "<", "<=", "==", "!="}:
            operator = "=="
        value = str(params.get("value", "true")).strip()
        result = self._evaluate_condition(variable_scope, var_name, field, operator, value, context)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "branch",
                "var_name": var_name,
                "condition": f"{var_name}.{field} {operator} {value}",
                "result": result,
                "message": f"条件 {var_name}.{field} {operator} {value} = {'true' if result else 'false'}，进入 {'then' if result else 'else'} 分支。",
            },
        )
        return result

    def _handle_if_condition(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        result = self._evaluate_if_condition_result(workflow_id, params, context)
        branch_key = "then_steps" if result else "else_steps"
        branch_steps = [self._coerce_action(item) for item in list(params.get(branch_key, []))]
        self._execute_steps(workflow_id, branch_steps, workflow_settings, context, stop_event)

    def _handle_set_variable_state(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        var_name = str(params.get("var_name", "target")).strip() or "target"
        variable_scope = str(params.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        state = str(params.get("state", "missing")).strip()
        found = state == "found"
        message = f"流程将变量 {var_name} 设为{'命中' if found else '未命中'}。"
        stored_value = self._set_variable_state(variable_scope, var_name, found, context, message)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "variable_set",
                "scope": variable_scope,
                "var_name": var_name,
                "found": bool(stored_value.get("found")),
                "message": f"变量 {variable_scope}.{var_name} 已设为{'命中' if found else '未命中'}。",
            },
        )
        self._logger(
            f"变量 {variable_scope}.{var_name} 已设为{'命中' if found else '未命中'}。",
            "info",
        )

    def _handle_set_variable(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        var_name = str(params.get("var_name", "")).strip()
        if not var_name:
            raise ValueError("set_variable 缺少 var_name")
        variable_scope = str(params.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        value_type = str(params.get("value_type", "object")).strip()

        if value_type == "literal":
            raw_value = params.get("value", "")
            payload: dict[str, Any] = {
                "found": True,
                "value": raw_value,
                "updated_at": time.time(),
            }
        else:
            payload = {}
            for key in ("x", "y", "left", "top", "width", "height", "found", "confidence", "value"):
                if key in params:
                    payload[key] = params[key]
            if "found" not in payload:
                payload["found"] = True
            payload["updated_at"] = time.time()

        if variable_scope == "shared":
            found = bool(payload.get("found", True))
            message = f"流程设置共享变量 {var_name}。"
            self._set_variable_state("shared", var_name, found, context, message)
        else:
            self._set_local_var(context, var_name, payload)

        self._emit_runtime_event(
            workflow_id,
            {
                "type": "variable_set",
                "scope": variable_scope,
                "var_name": var_name,
                "found": bool(payload.get("found")),
                "message": f"变量 {variable_scope}.{var_name} 已设置。",
            },
        )
        self._logger(f"变量 {variable_scope}.{var_name} 已设置。", "info")
