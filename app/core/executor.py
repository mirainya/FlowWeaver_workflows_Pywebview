from __future__ import annotations

import time
from copy import deepcopy
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any, Callable

from app.models import ActionDefinition, WorkflowDefinition
from app.services.input_controller import WindowsInputController
from app.services.vision import TemplateMatcher


class WorkflowExecutor:
    def __init__(
        self,
        input_controller: WindowsInputController,
        vision: TemplateMatcher,
        logger: Callable[[str, str], None],
        project_root: Path,
        runtime_event_callback: Callable[[str, dict[str, Any]], None] | None = None,
        shared_variable_resolver: Callable[[str], dict[str, Any] | None] | None = None,
        shared_variable_state_setter: Callable[[str, bool, str], dict[str, Any] | None] | None = None,
    ) -> None:
        self._input = input_controller
        self._vision = vision
        self._logger = logger
        self._project_root = project_root
        self._runtime_event_callback = runtime_event_callback
        self._shared_variable_resolver = shared_variable_resolver
        self._shared_variable_state_setter = shared_variable_state_setter
        self._loop_lock = Lock()
        self._active_workflows: dict[str, Event] = {}
        self._loop_stops: dict[str, Event] = {}
        self._toggle_cooldown: dict[str, float] = {}
        self._toggle_cooldown_seconds = 0.5

    def _emit_runtime_event(self, workflow_id: str, event: dict[str, Any]) -> None:
        if self._runtime_event_callback is not None:
            self._runtime_event_callback(workflow_id, event)

    def run_workflow(
        self,
        workflow: WorkflowDefinition,
        workflow_settings: dict[str, Any] | None = None,
    ) -> None:
        settings = workflow.normalize_settings(workflow_settings)
        run_mode = workflow.normalize_run_mode()

        if run_mode["type"] == "toggle_loop":
            self._toggle_loop_workflow(workflow, settings, run_mode)
            return

        if workflow.workflow_id in self._active_workflows:
            self._logger(f"流程已在运行中，忽略本次触发：{workflow.name}", "warn")
            return

        stop_event = Event()
        self._active_workflows[workflow.workflow_id] = stop_event

        Thread(
            target=self._execute_thread,
            args=(workflow, settings, stop_event, run_mode),
            daemon=True,
        ).start()

    def stop_workflow(self, workflow_id: str) -> bool:
        stop_event = self._active_workflows.get(workflow_id)
        if stop_event is None:
            return False
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "status",
                "status": "stopping",
                "active": True,
                "message": "已收到停止请求，等待当前轮次结束。",
            },
        )
        stop_event.set()
        return True

    def shutdown(self) -> None:
        for workflow_id in list(self._active_workflows.keys()):
            self.stop_workflow(workflow_id)

    def _toggle_loop_workflow(
        self,
        workflow: WorkflowDefinition,
        workflow_settings: dict[str, Any],
        run_mode: dict[str, Any],
    ) -> None:
        now = time.monotonic()

        if self.stop_workflow(workflow.workflow_id):
            self._toggle_cooldown[workflow.workflow_id] = now
            self._logger(f"已请求停止循环：{workflow.name}", "warn")
            return

        last_stop = self._toggle_cooldown.get(workflow.workflow_id, 0.0)
        if now - last_stop < self._toggle_cooldown_seconds:
            self._logger(f"循环刚刚停止，忽略本次触发：{workflow.name}", "warn")
            return

        if not self._loop_lock.acquire(blocking=False):
            self._logger("已有循环流程在运行，无法同时启动第二个循环。", "warn")
            return

        stop_event = Event()
        self._active_workflows[workflow.workflow_id] = stop_event
        self._loop_stops[workflow.workflow_id] = stop_event
        try:
            Thread(
                target=self._execute_thread,
                args=(workflow, workflow_settings, stop_event, run_mode),
                daemon=True,
            ).start()
        except Exception as exc:
            self._active_workflows.pop(workflow.workflow_id, None)
            self._loop_stops.pop(workflow.workflow_id, None)
            self._loop_lock.release()
            self._logger(f"循环线程启动失败：{workflow.name}，{exc}", "error")

    def _execute_thread(
        self,
        workflow: WorkflowDefinition,
        workflow_settings: dict[str, Any],
        stop_event: Event | None,
        run_mode: dict[str, Any],
    ) -> None:
        is_loop = run_mode["type"] == "toggle_loop"
        try:
            self._emit_runtime_event(
                workflow.workflow_id,
                {
                    "type": "status",
                    "status": "looping" if is_loop else "running",
                    "active": True,
                    "message": self._run_mode_message(run_mode),
                },
            )
            self._logger(f"开始执行流程：{workflow.name}", "info")

            context: dict[str, Any] = {
                "vars": {},
                "vars_lock": Lock(),
                "last_match": None,
            }

            if run_mode["type"] == "toggle_loop":
                iteration = 0
                while stop_event is not None and not stop_event.is_set():
                    self._execute_steps(workflow.workflow_id, workflow.actions, workflow_settings, context, stop_event)
                    iteration += 1
                    self._emit_runtime_event(
                        workflow.workflow_id,
                        {
                            "type": "iteration",
                            "count": iteration,
                        },
                    )
            else:
                total_iterations = run_mode.get("count", 1) if run_mode["type"] == "repeat_n" else 1
                for iteration in range(total_iterations):
                    if stop_event is not None and stop_event.is_set():
                        break
                    self._emit_runtime_event(
                        workflow.workflow_id,
                        {
                            "type": "status",
                            "status": "running",
                            "active": True,
                            "message": f"执行第 {iteration + 1} / {total_iterations} 轮。" if total_iterations > 1 else "流程执行中。",
                        },
                    )
                    self._execute_steps(workflow.workflow_id, workflow.actions, workflow_settings, context, stop_event)
                    self._emit_runtime_event(
                        workflow.workflow_id,
                        {
                            "type": "iteration",
                            "count": iteration + 1,
                        },
                    )
        except Exception as exc:
            self._emit_runtime_event(
                workflow.workflow_id,
                {
                    "type": "status",
                    "status": "error",
                    "active": False,
                    "message": f"执行失败：{exc}",
                },
            )
            self._logger(f"流程执行失败：{workflow.name}，{exc}", "error")
        else:
            end_message = "循环已停止。" if is_loop else "流程执行完成。"
            end_status = "idle" if is_loop else "success"
            self._emit_runtime_event(
                workflow.workflow_id,
                {
                    "type": "status",
                    "status": end_status,
                    "active": False,
                    "message": end_message,
                },
            )
            self._logger(
                f"{'循环已停止' if is_loop else '流程执行完成'}：{workflow.name}",
                "warn" if is_loop else "success",
            )
        finally:
            self._active_workflows.pop(workflow.workflow_id, None)
            if is_loop:
                self._loop_lock.release()
                self._toggle_cooldown[workflow.workflow_id] = time.monotonic()
                self._loop_stops.pop(workflow.workflow_id, None)

    def _run_mode_message(self, run_mode: dict[str, Any]) -> str:
        mode_type = run_mode.get("type")
        if mode_type == "toggle_loop":
            return "循环已启动，再按一次同热键停止。"
        if mode_type == "repeat_n":
            return f"将按设定执行 {run_mode.get('count', 1)} 轮。"
        return "流程执行中。"

    def _execute_steps(
        self,
        workflow_id: str,
        actions: list[ActionDefinition],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        for action in actions:
            if stop_event is not None and stop_event.is_set():
                return
            self._execute_action(workflow_id, action, workflow_settings, context, stop_event)

    def _execute_action(
        self,
        workflow_id: str,
        action: ActionDefinition,
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        self._logger(f"执行动作：{action.title}", "info")
        handlers: dict[str, Callable[[dict[str, Any]], None]] = {
            "delay": lambda params: self._handle_delay(params, workflow_settings, stop_event),
            "key_tap": lambda params: self._handle_key_tap(workflow_id, params, workflow_settings, stop_event),
            "key_sequence": lambda params: self._handle_key_sequence(workflow_id, params, workflow_settings, stop_event),
            "detect_image": lambda params: self._handle_detect_image(workflow_id, params, workflow_settings, context, stop_event),
            "click_point": lambda params: self._handle_click_point(workflow_id, params, context),
            "if_var_found": lambda params: self._handle_if_var_found(workflow_id, params, workflow_settings, context, stop_event),
            "set_variable_state": lambda params: self._handle_set_variable_state(workflow_id, params, context),
            "key_hold": lambda params: self._handle_key_hold(workflow_id, params, workflow_settings, context, stop_event),
            "detect_click_return": lambda params: self._handle_detect_click_return(workflow_id, params, workflow_settings, context, stop_event),
        }
        handler = handlers.get(action.kind)
        if handler is None:
            raise ValueError(f"不支持的动作类型：{action.kind}")
        handler(action.params)

    def _resolve_delay_ms(self, params: dict[str, Any], workflow_settings: dict[str, Any], field: str = "milliseconds") -> int:
        if "setting_key" in params:
            raw_value = workflow_settings.get(str(params["setting_key"]), params.get(field, 0))
        else:
            raw_value = params.get(field, 0)
        try:
            delay_ms = int(raw_value)
        except (TypeError, ValueError):
            delay_ms = 0
        return max(0, delay_ms)

    def _wait_delay(self, delay_ms: int, stop_event: Event | None) -> None:
        if delay_ms <= 0:
            return
        if stop_event is not None:
            stop_event.wait(delay_ms / 1000)
            return
        time.sleep(delay_ms / 1000)

    def _press_combo(self, workflow_id: str, keys: str, source: str) -> None:
        self._input.press_combo(keys)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "key",
                "key": keys,
                "source": source,
            },
        )

    def _handle_delay(
        self,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        self._wait_delay(self._resolve_delay_ms(params, workflow_settings), stop_event)

    def _handle_key_tap(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        keys = str(params.get("keys", "")).strip()
        if not keys:
            raise ValueError("按键动作缺少 keys 参数")
        self._press_combo(workflow_id, keys, source="tap")
        self._wait_delay(self._resolve_delay_ms(params, workflow_settings, field="delay_ms_after"), stop_event)

    def _handle_key_sequence(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        sequence = list(params.get("sequence", []))
        if not sequence:
            raise ValueError("按键序列为空")

        for step in sequence:
            if stop_event is not None and stop_event.is_set():
                return
            keys = str(step.get("keys", "")).strip()
            if not keys:
                continue
            self._press_combo(workflow_id, keys, source="sequence")
            self._wait_delay(self._resolve_delay_ms(step, workflow_settings, field="delay_ms"), stop_event)

    def _resolve_template_path(self, raw_path: str) -> Path:
        path = Path(raw_path)
        if path.is_absolute():
            return path
        return self._project_root / path

    def _build_miss_match(self, template_path: Path, confidence: float) -> dict[str, Any]:
        return {
            "found": False,
            "left": None,
            "top": None,
            "width": None,
            "height": None,
            "x": None,
            "y": None,
            "confidence": confidence,
            "template_path": str(template_path),
        }

    def _snapshot_local_var(self, context: dict[str, Any], var_name: str) -> dict[str, Any] | None:
        with context["vars_lock"]:
            value = context.get("vars", {}).get(var_name)
            return deepcopy(value) if isinstance(value, dict) else None

    def _resolve_variable(self, scope: str, var_name: str, context: dict[str, Any]) -> dict[str, Any] | None:
        if scope == "shared":
            if self._shared_variable_resolver is None:
                return None
            value = self._shared_variable_resolver(var_name)
            return deepcopy(value) if isinstance(value, dict) else None
        return self._snapshot_local_var(context, var_name)

    def _set_local_var(self, context: dict[str, Any], var_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        with context["vars_lock"]:
            context["vars"][var_name] = deepcopy(payload)
            context["last_match"] = deepcopy(payload)
            return deepcopy(context["vars"][var_name])

    def _build_manual_variable_payload(self, current_value: dict[str, Any] | None, found: bool) -> dict[str, Any]:
        payload = deepcopy(current_value) if isinstance(current_value, dict) else {}
        payload["updated_at"] = time.time()
        if found:
            payload["found"] = True
            payload["stale"] = False
        else:
            payload.update(
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
                    "stale": True,
                }
            )
        return payload

    def _set_variable_state(self, scope: str, var_name: str, found: bool, context: dict[str, Any], message: str) -> dict[str, Any]:
        if scope == "shared":
            if self._shared_variable_state_setter is None:
                raise RuntimeError("当前版本不支持写入共享变量。")
            value = self._shared_variable_state_setter(var_name, found, message)
            return deepcopy(value) if isinstance(value, dict) else {"found": found}

        current_value = self._snapshot_local_var(context, var_name)
        payload = self._build_manual_variable_payload(current_value, found)
        return self._set_local_var(context, var_name, payload)

    def _handle_detect_image(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        raw_template_path = str(params.get("template_path", "")).strip()
        if not raw_template_path:
            raise ValueError("识图动作缺少 template_path 参数")

        template_path = self._resolve_template_path(raw_template_path)
        confidence = float(params.get("confidence", 0.88))
        timeout_ms = self._resolve_delay_ms(params, workflow_settings, field="timeout_ms") or 2500
        search_step = max(1, int(params.get("search_step", 4)))
        save_as = str(params.get("save_as", "target")).strip() or "target"

        match = self._vision.locate_on_screen_details(
            template_path=template_path,
            confidence=confidence,
            timeout_ms=timeout_ms,
            search_step=search_step,
            stop_event=stop_event,
        )
        result = match or self._build_miss_match(template_path, confidence)
        stored_result = self._set_local_var(context, save_as, result)

        self._emit_runtime_event(
            workflow_id,
            {
                "type": "match",
                "var_name": save_as,
                "found": bool(stored_result.get("found")),
                "x": stored_result.get("x"),
                "y": stored_result.get("y"),
                "template_path": stored_result.get("template_path"),
            },
        )

        if stored_result.get("found"):
            self._logger(
                f"识图命中：{template_path.name}，保存到变量 {save_as} ({stored_result.get('x')}, {stored_result.get('y')})",
                "success",
            )
        else:
            self._logger(f"识图未命中：{template_path.name}，变量 {save_as}", "warn")

    def _handle_click_point(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        source = str(params.get("source", "var")).strip()
        if source not in {"var", "absolute", "shared", "current"}:
            source = "var"
        button = "right" if str(params.get("button", "left")).strip() == "right" else "left"
        raw_modifiers = list(params.get("modifiers", []))
        modifiers = [m for m in raw_modifiers if m in {"ctrl", "shift", "alt"}]

        settle_ms = max(0, int(params.get("settle_ms", 60)))
        modifier_delay_ms = max(0, int(params.get("modifier_delay_ms", 50)))

        if source == "current":
            if modifiers:
                current_pos = self._input.get_cursor_position()
                self._input.click_at(
                    target_position=current_pos,
                    button=button,
                    settle_ms=0,
                    return_cursor=False,
                    modifiers=modifiers,
                    modifier_delay_ms=modifier_delay_ms,
                )
            else:
                self._input.click_here(button)
            self._emit_runtime_event(
                workflow_id,
                {
                    "type": "click",
                    "x": None,
                    "y": None,
                    "button": button,
                    "source": "current",
                },
            )
            return

        offset_x = int(params.get("offset_x", 0))
        offset_y = int(params.get("offset_y", 0))
        return_cursor = bool(params.get("return_cursor", True))

        if source == "absolute":
            x = int(params.get("x", 0)) + offset_x
            y = int(params.get("y", 0)) + offset_y
        else:
            var_name = str(params.get("var_name", "target")).strip() or "target"
            point = self._resolve_variable("shared" if source == "shared" else "local", var_name, context)
            if not point or not point.get("found"):
                raise RuntimeError(f"变量 {var_name} 中没有可点击坐标")
            x = int(point.get("x", 0)) + offset_x
            y = int(point.get("y", 0)) + offset_y

        self._input.click_at(
            target_position=(x, y),
            button=button,
            settle_ms=settle_ms,
            return_cursor=return_cursor,
            modifiers=modifiers or None,
            modifier_delay_ms=modifier_delay_ms,
        )
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "click",
                "x": x,
                "y": y,
                "button": button,
            },
        )

    def _coerce_action(self, payload: Any) -> ActionDefinition:
        if isinstance(payload, ActionDefinition):
            return payload
        if not isinstance(payload, dict):
            raise ValueError("分支步骤格式无效")
        kind = str(payload.get("kind", payload.get("type", "delay"))).strip() or "delay"
        params = {key: value for key, value in payload.items() if key not in {"kind", "type", "title", "description"}}
        return ActionDefinition(
            kind=kind,
            title=str(payload.get("title", kind)).strip() or kind,
            description=str(payload.get("description", "")).strip(),
            params=params,
        )

    def _handle_if_var_found(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        var_name = str(params.get("var_name", "target")).strip() or "target"
        variable_scope = str(params.get("variable_scope", "local")).strip()
        if variable_scope not in {"local", "shared"}:
            variable_scope = "local"
        branch_value = self._resolve_variable(variable_scope, var_name, context) or {}
        found = bool(branch_value.get("found"))
        branch_key = "then_steps" if found else "else_steps"
        branch_steps = [self._coerce_action(item) for item in list(params.get(branch_key, []))]
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "branch",
                "var_name": var_name,
                "found": found,
                "message": f"条件 {var_name}.found = {'true' if found else 'false'}，进入 {'then' if found else 'else'} 分支。",
            },
        )
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
        child_steps = [self._coerce_action(item) for item in list(params.get("steps", []))]
        self._input.press_key(key)
        try:
            self._emit_runtime_event(workflow_id, {"type": "key_hold", "key": key, "action": "press"})
            self._execute_steps(workflow_id, child_steps, workflow_settings, context, stop_event)
        finally:
            self._input.release_key(key)
            self._emit_runtime_event(workflow_id, {"type": "key_hold", "key": key, "action": "release"})

    def _handle_detect_click_return(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        detect_params = dict(params)
        save_as = str(detect_params.get("save_as", "target")).strip() or "target"
        detect_params["save_as"] = save_as
        self._handle_detect_image(workflow_id, detect_params, workflow_settings, context, stop_event)
        if stop_event is not None and stop_event.is_set():
            return
        match = self._snapshot_local_var(context, save_as)
        if not match or not match.get("found"):
            raise RuntimeError(f"识图失败：{Path(str(detect_params.get('template_path', 'unknown'))).name}")
        self._handle_click_point(
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
        )
