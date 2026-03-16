from __future__ import annotations

import random
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
        call_workflow_handler: Callable[[str, Event | None], None] | None = None,
    ) -> None:
        self._input = input_controller
        self._vision = vision
        self._logger = logger
        self._project_root = project_root
        self._runtime_event_callback = runtime_event_callback
        self._shared_variable_resolver = shared_variable_resolver
        self._shared_variable_state_setter = shared_variable_state_setter
        self._call_workflow_handler = call_workflow_handler
        self._pixel_checker: Any = None
        self._color_detector: Any = None
        self._feature_matcher: Any = None
        self._loop_lock = Lock()
        self._active_workflows: dict[str, Event] = {}
        self._active_threads: dict[str, Thread] = {}
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

        thread = Thread(
            target=self._execute_thread,
            args=(workflow, settings, stop_event, run_mode),
            daemon=True,
        )
        self._active_threads[workflow.workflow_id] = thread
        thread.start()

    def stop_workflow(self, workflow_id: str, timeout: float = 3.0) -> bool:
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
        thread = self._active_threads.get(workflow_id)
        if thread is not None and thread.is_alive():
            thread.join(timeout=timeout)
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
            thread = Thread(
                target=self._execute_thread,
                args=(workflow, workflow_settings, stop_event, run_mode),
                daemon=True,
            )
            self._active_threads[workflow.workflow_id] = thread
            thread.start()
        except Exception as exc:
            self._active_workflows.pop(workflow.workflow_id, None)
            self._active_threads.pop(workflow.workflow_id, None)
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
            self._active_threads.pop(workflow.workflow_id, None)
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
        for step_index, action in enumerate(actions):
            if stop_event is not None and stop_event.is_set():
                return
            self._emit_runtime_event(workflow_id, {
                "type": "step_enter",
                "step_index": step_index,
                "step_kind": action.kind,
                "step_title": action.title,
            })
            try:
                self._execute_action(workflow_id, action, workflow_settings, context, stop_event)
            finally:
                self._emit_runtime_event(workflow_id, {
                    "type": "step_exit",
                    "step_index": step_index,
                    "step_kind": action.kind,
                })

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
            "click_point": lambda params: self._handle_click_point(workflow_id, params, context, stop_event),
            "if_var_found": lambda params: self._handle_if_var_found(workflow_id, params, workflow_settings, context, stop_event),
            "if_condition": lambda params: self._handle_if_condition(workflow_id, params, workflow_settings, context, stop_event),
            "set_variable_state": lambda params: self._handle_set_variable_state(workflow_id, params, context),
            "key_hold": lambda params: self._handle_key_hold(workflow_id, params, workflow_settings, context, stop_event),
            "detect_click_return": lambda params: self._handle_detect_click_return(workflow_id, params, workflow_settings, context, stop_event),
            "mouse_scroll": lambda params: self._handle_mouse_scroll(workflow_id, params, stop_event),
            "mouse_hold": lambda params: self._handle_mouse_hold(workflow_id, params, context, stop_event),
            "detect_color": lambda params: self._handle_detect_color(workflow_id, params, context, stop_event),
            "loop": lambda params: self._handle_loop(workflow_id, params, workflow_settings, context, stop_event),
            "call_workflow": lambda params: self._handle_call_workflow(workflow_id, params, stop_event),
            "log": lambda params: self._handle_log(workflow_id, params, context),
            "mouse_drag": lambda params: self._handle_mouse_drag(workflow_id, params, context, stop_event),
            "type_text": lambda params: self._handle_type_text(workflow_id, params, stop_event),
            "mouse_move": lambda params: self._handle_mouse_move(workflow_id, params, context, stop_event),
            "set_variable": lambda params: self._handle_set_variable(workflow_id, params, context),
            "check_pixels": lambda params: self._handle_check_pixels(workflow_id, params, context, stop_event),
            "check_region_color": lambda params: self._handle_check_region_color(workflow_id, params, context, stop_event),
            "detect_color_region": lambda params: self._handle_detect_color_region(workflow_id, params, context, stop_event),
            "match_fingerprint": lambda params: self._handle_match_fingerprint(workflow_id, params, context, stop_event),
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
        random_min = max(0, int(params.get("random_min", 0)))
        random_max = max(0, int(params.get("random_max", 0)))
        if random_min > 0 and random_max > random_min:
            delay_ms = random.randint(random_min, random_max)
        else:
            delay_ms = self._resolve_delay_ms(params, workflow_settings)
        self._wait_delay(delay_ms, stop_event)

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
        if not template_path.exists():
            raise FileNotFoundError(f"模板图片不存在：{template_path}")
        confidence = float(params.get("confidence", 0.88))
        raw_timeout = self._resolve_delay_ms(params, workflow_settings, field="timeout_ms")
        if raw_timeout <= 0:
            self._logger("timeout_ms 值无效，使用默认 2500ms", "warn")
            raw_timeout = 2500
        timeout_ms = raw_timeout
        search_step = max(1, int(params.get("search_step", 4)))
        save_as = str(params.get("save_as", "target")).strip() or "target"

        raw_search_region = params.get("search_region")
        search_region: dict[str, int] | None = None
        if isinstance(raw_search_region, dict):
            try:
                search_region = {
                    "left": int(raw_search_region.get("left", 0)),
                    "top": int(raw_search_region.get("top", 0)),
                    "width": int(raw_search_region.get("width", 0)),
                    "height": int(raw_search_region.get("height", 0)),
                }
                if search_region["width"] <= 0 or search_region["height"] <= 0:
                    search_region = None
            except (TypeError, ValueError):
                search_region = None

        match = self._vision.locate_on_screen_details(
            template_path=template_path,
            confidence=confidence,
            timeout_ms=timeout_ms,
            search_step=search_step,
            search_region=search_region,
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
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        source = str(params.get("source", "var")).strip()
        if source not in {"var", "absolute", "shared", "current"}:
            source = "var"
        button = "right" if str(params.get("button", "left")).strip() == "right" else "left"
        raw_modifiers = list(params.get("modifiers", []))
        modifiers = [m for m in raw_modifiers if m in {"ctrl", "shift", "alt"}]
        click_count = max(1, int(params.get("click_count", 1)))

        settle_ms = max(0, int(params.get("settle_ms", 60)))
        modifier_delay_ms = max(0, int(params.get("modifier_delay_ms", 50)))

        if source == "current":
            if modifiers or click_count > 1:
                current_pos = self._input.get_cursor_position()
                self._input.click_at(
                    target_position=current_pos,
                    button=button,
                    settle_ms=0,
                    return_cursor=False,
                    modifiers=modifiers,
                    modifier_delay_ms=modifier_delay_ms,
                    click_count=click_count,
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
            click_count=click_count,
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

    def _handle_if_condition(
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
        field = str(params.get("field", "found")).strip() or "found"
        operator = str(params.get("operator", "==")).strip()
        if operator not in {">", ">=", "<", "<=", "==", "!="}:
            operator = "=="
        value = str(params.get("value", "true")).strip()
        result = self._evaluate_condition(variable_scope, var_name, field, operator, value, context)
        branch_key = "then_steps" if result else "else_steps"
        branch_steps = [self._coerce_action(item) for item in list(params.get(branch_key, []))]
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
            stop_event,
        )

    def _handle_mouse_scroll(
        self,
        workflow_id: str,
        params: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        direction = str(params.get("direction", "down")).strip()
        if direction not in {"up", "down", "left", "right"}:
            direction = "down"
        clicks = max(1, int(params.get("clicks", 3)))
        self._input.scroll(clicks=clicks, direction=direction)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "scroll",
                "direction": direction,
                "clicks": clicks,
            },
        )

    def _handle_mouse_hold(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        button = str(params.get("button", "left")).strip()
        if button not in {"left", "right", "middle"}:
            button = "left"
        duration_ms = max(0, int(params.get("duration_ms", 500)))

        source = str(params.get("source", "current")).strip()
        if source not in {"current", "var", "shared", "absolute"}:
            source = "current"

        if source == "absolute":
            x = int(params.get("x", 0))
            y = int(params.get("y", 0))
            self._input.set_cursor_position((x, y))
            time.sleep(max(0, int(params.get("settle_ms", 60))) / 1000)
        elif source in {"var", "shared"}:
            var_name = str(params.get("var_name", "target")).strip() or "target"
            point = self._resolve_variable("shared" if source == "shared" else "local", var_name, context)
            if not point or not point.get("found"):
                raise RuntimeError(f"变量 {var_name} 中没有可点击坐标")
            x = int(point.get("x", 0)) + int(params.get("offset_x", 0))
            y = int(point.get("y", 0)) + int(params.get("offset_y", 0))
            self._input.set_cursor_position((x, y))
            time.sleep(max(0, int(params.get("settle_ms", 60))) / 1000)

        self._input.mouse_down(button)
        self._emit_runtime_event(workflow_id, {"type": "mouse_hold", "button": button, "action": "down"})
        try:
            self._wait_delay(duration_ms, stop_event)
        finally:
            self._input.mouse_up(button)
            self._emit_runtime_event(workflow_id, {"type": "mouse_hold", "button": button, "action": "up"})

    def _handle_detect_color(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return

        source = str(params.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "shared"}:
            source = "absolute"

        if source == "absolute":
            x = int(params.get("x", 0))
            y = int(params.get("y", 0))
        else:
            var_name = str(params.get("var_name", "target")).strip() or "target"
            point = self._resolve_variable("shared" if source == "shared" else "local", var_name, context)
            if not point or not point.get("found"):
                raise RuntimeError(f"变量 {var_name} 中没有坐标")
            x = int(point.get("x", 0)) + int(params.get("offset_x", 0))
            y = int(point.get("y", 0)) + int(params.get("offset_y", 0))

        frame = self._vision.get_latest_frame()
        if frame is None:
            raise RuntimeError("无法获取屏幕截图")

        h, w = frame.shape[:2]
        if not (0 <= x < w and 0 <= y < h):
            raise RuntimeError(f"坐标 ({x}, {y}) 超出屏幕范围 ({w}x{h})")

        b, g, r = int(frame[y, x, 0]), int(frame[y, x, 1]), int(frame[y, x, 2])
        hex_color = f"#{r:02X}{g:02X}{b:02X}"

        save_as = str(params.get("save_as", "color_result")).strip() or "color_result"
        expected_color = str(params.get("expected_color", "")).strip().upper()
        tolerance = max(0, int(params.get("tolerance", 20)))

        matched = False
        if expected_color:
            ec = expected_color.lstrip("#")
            if len(ec) == 6:
                er, eg, eb = int(ec[0:2], 16), int(ec[2:4], 16), int(ec[4:6], 16)
                matched = abs(r - er) <= tolerance and abs(g - eg) <= tolerance and abs(b - eb) <= tolerance

        payload = {
            "found": matched,
            "x": x,
            "y": y,
            "color": hex_color,
            "r": r,
            "g": g,
            "b": b,
            "expected_color": expected_color,
            "tolerance": tolerance,
        }
        self._set_local_var(context, save_as, payload)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "detect_color",
                "x": x,
                "y": y,
                "color": hex_color,
                "matched": matched,
                "save_as": save_as,
            },
        )

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

    def _handle_log(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        message = str(params.get("message", "")).strip()
        level = str(params.get("level", "info")).strip()
        if level not in {"info", "warn", "success"}:
            level = "info"
        # 简单变量插值: {var_name.field}
        import re
        def _replace_var(m: re.Match) -> str:
            parts = m.group(1).split(".", 1)
            var_name = parts[0].strip()
            field = parts[1].strip() if len(parts) > 1 else "found"
            val = self._resolve_variable("local", var_name, context) or {}
            return str(val.get(field, ""))
        resolved = re.sub(r"\{([^}]+)\}", _replace_var, message)
        self._logger(f"[LOG] {resolved}", level)
        self._emit_runtime_event(workflow_id, {"type": "log", "message": resolved, "level": level})

    def _handle_mouse_drag(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        source = str(params.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "shared"}:
            source = "absolute"
        if source == "absolute":
            start_x = int(params.get("start_x", 0))
            start_y = int(params.get("start_y", 0))
            end_x = int(params.get("end_x", 0))
            end_y = int(params.get("end_y", 0))
        else:
            var_name = str(params.get("var_name", "target")).strip() or "target"
            var_data = self._resolve_variable(source, var_name, context) or {}
            base_x = int(var_data.get("x", 0))
            base_y = int(var_data.get("y", 0))
            start_x = base_x + int(params.get("start_offset_x", 0))
            start_y = base_y + int(params.get("start_offset_y", 0))
            end_x = base_x + int(params.get("end_offset_x", 0))
            end_y = base_y + int(params.get("end_offset_y", 0))
        button = str(params.get("button", "left")).strip()
        if button not in {"left", "right", "middle"}:
            button = "left"
        duration_ms = max(0, int(params.get("duration_ms", 300)))
        self._emit_runtime_event(
            workflow_id,
            {"type": "mouse_drag", "start": [start_x, start_y], "end": [end_x, end_y], "button": button},
        )
        self._input.drag(
            start=(start_x, start_y),
            end=(end_x, end_y),
            button=button,
            duration_ms=duration_ms,
        )

    def _handle_type_text(
        self,
        workflow_id: str,
        params: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        text = str(params.get("text", ""))
        interval_ms = max(0, int(params.get("interval_ms", 50)))
        self._emit_runtime_event(
            workflow_id,
            {"type": "type_text", "length": len(text)},
        )
        self._input.type_text(text, interval_ms=interval_ms)

    def _handle_mouse_move(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        source = str(params.get("source", "absolute")).strip()
        if source not in {"absolute", "var", "shared"}:
            source = "absolute"
        if source == "absolute":
            x = int(params.get("x", 0))
            y = int(params.get("y", 0))
        else:
            var_name = str(params.get("var_name", "target")).strip() or "target"
            var_data = self._resolve_variable(source, var_name, context) or {}
            x = int(var_data.get("x", 0)) + int(params.get("offset_x", 0))
            y = int(var_data.get("y", 0)) + int(params.get("offset_y", 0))
        self._emit_runtime_event(workflow_id, {"type": "mouse_move", "x": x, "y": y})
        self._input.set_cursor_position((x, y))

    def _handle_set_variable(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        var_name = str(params.get("var_name", "target")).strip() or "target"
        field = str(params.get("field", "found")).strip() or "found"
        value = str(params.get("value", ""))
        # 自动类型转换
        if value.lower() == "true":
            typed_value: Any = True
        elif value.lower() == "false":
            typed_value = False
        else:
            try:
                typed_value = int(value)
            except ValueError:
                try:
                    typed_value = float(value)
                except ValueError:
                    typed_value = value
        variables = context.setdefault("variables", {})
        var_data = variables.setdefault(var_name, {})
        var_data[field] = typed_value
        self._emit_runtime_event(
            workflow_id,
            {"type": "set_variable", "var_name": var_name, "field": field, "value": typed_value},
        )

    def _handle_check_pixels(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        if self._pixel_checker is None:
            raise RuntimeError("PixelChecker 未初始化")
        points = list(params.get("points", []))
        logic = str(params.get("logic", "all")).strip()
        save_as = str(params.get("save_as", "pixel_result")).strip() or "pixel_result"
        result = self._pixel_checker.check_pixels(points, logic=logic)
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "check_pixels",
                "found": result["found"],
                "match_count": result["match_count"],
                "total": result["total"],
                "save_as": save_as,
            },
        )

    def _handle_check_region_color(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        if self._pixel_checker is None:
            raise RuntimeError("PixelChecker 未初始化")
        save_as = str(params.get("save_as", "region_color_result")).strip() or "region_color_result"
        result = self._pixel_checker.check_region_color(
            left=int(params.get("left", 0)),
            top=int(params.get("top", 0)),
            width=int(params.get("width", 100)),
            height=int(params.get("height", 100)),
            expected_color=str(params.get("expected_color", "")),
            tolerance=int(params.get("tolerance", 20)),
            min_ratio=float(params.get("min_ratio", 0.5)),
        )
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "check_region_color",
                "found": result["found"],
                "ratio": result["ratio"],
                "save_as": save_as,
            },
        )

    def _handle_detect_color_region(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        if self._color_detector is None:
            raise RuntimeError("ColorRegionDetector 未初始化")
        save_as = str(params.get("save_as", "color_region_result")).strip() or "color_region_result"
        region = None
        rw, rh = int(params.get("region_width", 0)), int(params.get("region_height", 0))
        if rw > 0 and rh > 0:
            region = {
                "left": int(params.get("region_left", 0)),
                "top": int(params.get("region_top", 0)),
                "width": rw,
                "height": rh,
            }
        result = self._color_detector.detect(
            h_min=int(params.get("h_min", 0)),
            h_max=int(params.get("h_max", 179)),
            s_min=int(params.get("s_min", 50)),
            s_max=int(params.get("s_max", 255)),
            v_min=int(params.get("v_min", 50)),
            v_max=int(params.get("v_max", 255)),
            region=region,
            min_area=int(params.get("min_area", 100)),
        )
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "detect_color_region",
                "found": result["found"],
                "count": result.get("count", 0),
                "save_as": save_as,
            },
        )

    def _handle_match_fingerprint(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        if self._feature_matcher is None:
            raise RuntimeError("FeatureMatcher 未初始化")
        save_as = str(params.get("save_as", "fingerprint_result")).strip() or "fingerprint_result"
        result = self._feature_matcher.match(
            anchor_x=int(params.get("anchor_x", 0)),
            anchor_y=int(params.get("anchor_y", 0)),
            sample_points=list(params.get("sample_points", [])),
            tolerance=int(params.get("tolerance", 20)),
        )
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "match_fingerprint",
                "found": result["found"],
                "match_count": result.get("match_count", 0),
                "total": result.get("total", 0),
                "save_as": save_as,
            },
        )
