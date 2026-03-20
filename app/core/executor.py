from __future__ import annotations

import time
from copy import deepcopy
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any, Callable

from app.models import ActionDefinition, WorkflowDefinition
from app.services.input_controller import WindowsInputController
from app.services.vision import TemplateMatcher
from app.core.graph_executor import GraphRunner

from app.core.handlers.basic import BasicHandlersMixin
from app.core.handlers.mouse import MouseHandlersMixin
from app.core.handlers.vision import VisionHandlersMixin
from app.core.handlers.variable import VariableHandlersMixin
from app.core.handlers.flow import FlowHandlersMixin
from app.core.handlers.pixel import PixelHandlersMixin


class WorkflowExecutor(
    BasicHandlersMixin,
    MouseHandlersMixin,
    VisionHandlersMixin,
    VariableHandlersMixin,
    FlowHandlersMixin,
    PixelHandlersMixin,
):
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
        self._state_lock = Lock()
        self._active_workflows: dict[str, Event] = {}
        self._active_threads: dict[str, Thread] = {}
        self._loop_stops: dict[str, Event] = {}
        self._toggle_cooldown: dict[str, float] = {}
        self._toggle_cooldown_seconds = 0.5
        self._graph_runner = GraphRunner(self)

    def _emit_runtime_event(self, workflow_id: str, event: dict[str, Any]) -> None:
        if self._runtime_event_callback is not None:
            self._runtime_event_callback(workflow_id, event)

    def _snapshot_runtime_handles(self, workflow_id: str) -> tuple[Event | None, Thread | None, Event | None]:
        with self._state_lock:
            return (
                self._active_workflows.get(workflow_id),
                self._active_threads.get(workflow_id),
                self._loop_stops.get(workflow_id),
            )

    def _try_register_workflow(self, workflow_id: str, stop_event: Event, thread: Thread, loop_stop: Event | None = None) -> bool:
        with self._state_lock:
            existing_thread = self._active_threads.get(workflow_id)
            if existing_thread is not None and existing_thread.is_alive():
                return False
            existing_stop = self._active_workflows.get(workflow_id)
            if existing_stop is not None and not existing_stop.is_set():
                return False
            self._active_workflows[workflow_id] = stop_event
            self._active_threads[workflow_id] = thread
            if loop_stop is None:
                self._loop_stops.pop(workflow_id, None)
            else:
                self._loop_stops[workflow_id] = loop_stop
            return True

    def _finalize_workflow(self, workflow_id: str, stop_event: Event, thread: Thread) -> None:
        with self._state_lock:
            if self._active_workflows.get(workflow_id) is stop_event:
                self._active_workflows.pop(workflow_id, None)
            if self._active_threads.get(workflow_id) is thread:
                self._active_threads.pop(workflow_id, None)
            self._loop_stops.pop(workflow_id, None)

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

        stop_event = Event()
        thread = Thread(
            target=self._execute_thread,
            args=(workflow, settings, stop_event, run_mode),
            daemon=True,
        )
        if not self._try_register_workflow(workflow.workflow_id, stop_event, thread):
            self._logger(f"流程仍在运行或停止中，忽略本次触发：{workflow.name}", "warn")
            self._emit_runtime_event(
                workflow.workflow_id,
                {"type": "status", "status": "stopping", "active": True, "message": f"流程仍在运行或停止中，暂不重复启动：{workflow.name}"},
            )
            return
        thread.start()

    def stop_workflow(self, workflow_id: str, timeout: float = 3.0) -> bool:
        stop_event, thread, loop_stop = self._snapshot_runtime_handles(workflow_id)
        if stop_event is None:
            return False
        self._emit_runtime_event(
            workflow_id,
            {"type": "stopping", "message": "正在停止流程…"},
        )
        stop_event.set()
        if loop_stop is not None:
            loop_stop.set()
        if thread is not None:
            thread.join(timeout=timeout)
            if thread.is_alive():
                self._emit_runtime_event(
                    workflow_id,
                    {"type": "stopping", "message": "停止请求已发出，正在等待线程退出…"},
                )
            else:
                self._emit_runtime_event(
                    workflow_id,
                    {"type": "status", "status": "idle", "active": False, "message": "流程已停止。"},
                )
        return True

    def shutdown(self) -> None:
        for workflow_id in list(self._active_workflows):
            self.stop_workflow(workflow_id, timeout=2.0)

    def _toggle_loop_workflow(
        self,
        workflow: WorkflowDefinition,
        settings: dict[str, Any],
        run_mode: dict[str, Any],
    ) -> None:
        wid = workflow.workflow_id
        now = time.time()
        should_start = False
        thread: Thread | None = None
        stop_event: Event | None = None
        loop_stop: Event | None = None

        with self._loop_lock:
            active_stop, active_thread, active_loop_stop = self._snapshot_runtime_handles(wid)
            if active_stop is not None and active_thread is not None and active_thread.is_alive():
                self._logger(f"停止循环流程：{workflow.name}", "info")
                self._emit_runtime_event(wid, {"type": "loop_stop", "message": f"正在停止循环：{workflow.name}"})
                active_stop.set()
                if active_loop_stop is not None:
                    active_loop_stop.set()
                self._toggle_cooldown.pop(wid, None)
                return

            last = self._toggle_cooldown.get(wid, 0.0)
            if now - last < self._toggle_cooldown_seconds:
                remaining_ms = int((self._toggle_cooldown_seconds - (now - last)) * 1000)
                self._logger(f"循环切换过快，已忽略：{workflow.name}", "warn")
                self._emit_runtime_event(
                    wid,
                    {"type": "toggle_throttled", "message": f"切换过快，已忽略本次触发（约 {max(1, remaining_ms)}ms 冷却）。"},
                )
                return
            self._toggle_cooldown[wid] = now

            self._logger(f"启动循环流程：{workflow.name}", "info")
            stop_event = Event()
            loop_stop = Event()
            thread = Thread(
                target=self._execute_thread,
                args=(workflow, settings, stop_event, run_mode),
                daemon=True,
            )
            if not self._try_register_workflow(wid, stop_event, thread, loop_stop):
                self._logger(f"循环流程仍在停止中，忽略本次启动：{workflow.name}", "warn")
                self._emit_runtime_event(wid, {"type": "stopping", "message": f"循环仍在停止中，暂不重新启动：{workflow.name}"})
                return
            self._emit_runtime_event(wid, {"type": "loop_start", "message": f"循环已启动：{workflow.name}"})
            should_start = True

        if should_start and thread is not None:
            thread.start()

    def _execute_thread(
        self,
        workflow: WorkflowDefinition,
        workflow_settings: dict[str, Any],
        stop_event: Event,
        run_mode: dict[str, Any],
    ) -> None:
        wid = workflow.workflow_id
        from threading import Lock as _Lock, current_thread
        running_thread = current_thread()
        context: dict[str, Any] = {"vars": {}, "vars_lock": _Lock(), "last_match": None}

        node_graph = workflow.node_graph
        if not isinstance(node_graph, dict) or not isinstance(node_graph.get("nodes"), list) or not node_graph.get("nodes"):
            raise ValueError(f"流程 {workflow.name} 缺少合法 node_graph，无法执行。")

        def _run_once() -> None:
            node_count = len(node_graph.get("nodes", []))
            edge_count = len(node_graph.get("edges", [])) if isinstance(node_graph.get("edges"), list) else 0
            self._logger(f"进入图执行器：{workflow.name}，nodes={node_count}，edges={edge_count}", "info")
            self._graph_runner.execute(wid, node_graph, workflow_settings, context, stop_event)

        try:
            self._emit_runtime_event(wid, {"type": "start", "message": f"开始执行：{workflow.name}"})
            self._logger(f"开始执行流程：{workflow.name} ({self._run_mode_message(run_mode)})", "info")

            if run_mode["type"] == "toggle_loop":
                loop_stop = self._loop_stops.get(wid)
                iteration = 0
                while not stop_event.is_set():
                    iteration += 1
                    self._emit_runtime_event(wid, {"type": "loop_iteration", "iteration": iteration})
                    _run_once()
                    if stop_event.is_set():
                        break
                    delay_ms = int(run_mode.get("loop_delay_ms", 50))
                    if delay_ms > 0 and loop_stop is not None:
                        loop_stop.wait(delay_ms / 1000)
            elif run_mode["type"] == "repeat_n":
                count = max(1, int(run_mode.get("count", 1)))
                self._logger(f"流程将按次数模式执行：{workflow.name}，共 {count} 次", "info")
                for i in range(count):
                    if stop_event.is_set():
                        break
                    self._emit_runtime_event(wid, {"type": "run_count", "current": i + 1, "total": count})
                    _run_once()
            else:
                _run_once()

        except Exception as exc:
            self._logger(f"流程执行出错：{exc}", "error")
            self._emit_runtime_event(wid, {"type": "error", "message": str(exc)})
        finally:
            self._finalize_workflow(wid, stop_event, running_thread)
            self._emit_runtime_event(wid, {"type": "end", "message": f"流程结束：{workflow.name}"})
            self._logger(f"流程结束：{workflow.name}", "info")

    def _run_mode_message(self, run_mode: dict[str, Any]) -> str:
        mode_type = run_mode.get("type", "once")
        if mode_type == "toggle_loop":
            return "开关循环"
        if mode_type == "repeat_n":
            return f"执行 {run_mode.get('count', 1)} 次"
        return "单次执行"

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
            "if_var_found": lambda params: self._handle_if_var_found(workflow_id, params, context),
            "if_condition": lambda params: self._handle_if_condition(workflow_id, params, context),
            "set_variable_state": lambda params: self._handle_set_variable_state(workflow_id, params, context),
            "key_hold": lambda params: self._handle_key_hold(workflow_id, params, stop_event),
            "detect_click_return": lambda params: self._handle_detect_click_return(workflow_id, params, workflow_settings, context, stop_event),
            "mouse_scroll": lambda params: self._handle_mouse_scroll(workflow_id, params, stop_event),
            "mouse_hold": lambda params: self._handle_mouse_hold(workflow_id, params, context, stop_event),
            "detect_color": lambda params: self._handle_detect_color(workflow_id, params, workflow_settings, context, stop_event),
            "loop": lambda params: self._handle_loop(workflow_id, params),
            "call_workflow": lambda params: self._handle_call_workflow(workflow_id, params, stop_event),
            "log": lambda params: self._handle_log(workflow_id, params, context),
            "mouse_drag": lambda params: self._handle_mouse_drag(workflow_id, params, context, stop_event),
            "type_text": lambda params: self._handle_type_text(workflow_id, params, stop_event),
            "mouse_move": lambda params: self._handle_mouse_move(workflow_id, params, context, stop_event),
            "set_variable": lambda params: self._handle_set_variable(workflow_id, params, context),
            "check_pixels": lambda params: self._handle_check_pixels(workflow_id, params, workflow_settings, context, stop_event),
            "check_region_color": lambda params: self._handle_check_region_color(workflow_id, params, workflow_settings, context, stop_event),
            "detect_color_region": lambda params: self._handle_detect_color_region(workflow_id, params, workflow_settings, context, stop_event),
            "match_fingerprint": lambda params: self._handle_match_fingerprint(workflow_id, params, workflow_settings, context, stop_event),
            "async_detect": lambda params: self._handle_async_detect(workflow_id, params, workflow_settings, context, stop_event),
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
