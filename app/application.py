from __future__ import annotations

import base64
import binascii
import re
from collections import deque
from datetime import datetime
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from app.config_store import ConfigStore
from app.workflow_store import WorkflowStore
from app.core.executor import WorkflowExecutor
from app.core.hotkeys import HotkeyManager
from app.core.workflows import (
    build_custom_flow_workflows,
    build_preset_custom_flow_records,
    default_custom_flow_payload,
    extract_shared_variable_names,
    get_tab_definitions,
    iter_action_payloads,
    serialize_custom_flow_workflow,
)
from app.models import WorkflowBinding, WorkflowDefinition
from app.services.async_vision import AsyncVisionManager, sanitize_async_monitor_record
from app.services.template_manager import TemplateManager
from app.services.input_controller import WindowsInputController
from app.services.vision import SharedScreenCapture, TemplateMatcher
from app.services.pixel_checker import PixelChecker
from app.services.color_detector import ColorRegionDetector
from app.services.feature_matcher import FeatureMatcher


class AssistantApplication:
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root
        self._log_lock = Lock()
        self._runtime_lock = Lock()
        self._hotkey_capture_lock = Lock()
        self._hotkey_capture_depth = 0
        self._logs: deque[dict[str, str]] = deque(maxlen=200)
        self._key_events: deque[dict[str, str]] = deque(maxlen=120)

        self.config_store = ConfigStore(project_root / "data" / "config.json")
        self.workflow_store = WorkflowStore(project_root / "data" / "workflows")

        # 自动迁移：从旧 config.json 提取 flows 到独立文件
        migrated_count = self.config_store.migrate_flows_to_files(self.workflow_store)
        if migrated_count > 0:
            self.add_log(f"已从 config.json 迁移 {migrated_count} 个工作流到独立文件。", "success")

        loaded = self.config_store.load_all()
        self.async_monitor_records = loaded["async_monitor_records"]
        self.custom_flow_presets_seeded = loaded["custom_flow_presets_seeded"]

        # 从独立文件加载自定义工作流
        custom_flow_records = self.workflow_store.load_all_records()
        if not self.custom_flow_presets_seeded:
            existing_ids = {
                str(record.get("workflow_id", "")).strip()
                for record in custom_flow_records
                if isinstance(record, dict)
            }
            for record in build_preset_custom_flow_records(project_root):
                workflow_id = str(record.get("workflow_id", "")).strip()
                if workflow_id and workflow_id not in existing_ids:
                    record["version"] = record.get("version", 1)
                    self.workflow_store.save_record(record)
                    custom_flow_records.append(record)
            self.custom_flow_presets_seeded = True
        self.builtin_workflows: list[WorkflowDefinition] = []
        self.custom_workflows = build_custom_flow_workflows(custom_flow_records)
        self.workflows: list[WorkflowDefinition] = []
        self.workflow_map: dict[str, WorkflowDefinition] = {}
        self.runtime_states: dict[str, dict[str, Any]] = {}
        self.bindings: dict[str, WorkflowBinding] = {}
        self.settings: dict[str, dict[str, int]] = {}
        self._rebuild_workflow_catalog()

        self.bindings, self.settings = self.config_store.load_state(
            self.builtin_workflows,
            self.custom_workflows,
            custom_flow_records=custom_flow_records,
        )
        self._sync_runtime_and_state_maps()

        self.input_controller = WindowsInputController()
        self._shared_capture = SharedScreenCapture()
        self.vision = TemplateMatcher(shared_capture=self._shared_capture)
        self.pixel_checker = PixelChecker(shared_capture=self._shared_capture)
        self.color_detector = ColorRegionDetector(shared_capture=self._shared_capture)
        self.feature_matcher = FeatureMatcher(shared_capture=self._shared_capture)
        self.template_manager = TemplateManager(
            project_root=project_root,
            shared_capture=self._shared_capture,
            vision=self.vision,
            logger=self.add_log,
        )
        self.async_vision = AsyncVisionManager(
            project_root=project_root,
            logger=self.add_log,
            shared_capture=self._shared_capture,
            pixel_checker=self.pixel_checker,
            color_detector=self.color_detector,
            feature_matcher=self.feature_matcher,
        )
        self._refresh_async_monitors()
        self.async_monitor_records = self.async_vision.get_records()
        self.executor = WorkflowExecutor(
            input_controller=self.input_controller,
            vision=self.vision,
            logger=self.add_log,
            project_root=project_root,
            runtime_event_callback=self.handle_runtime_event,
            shared_variable_resolver=self.async_vision.get_variable,
            shared_variable_state_setter=lambda variable_name, found, message: self.async_vision.set_variable_state(
                variable_name,
                found=found,
                message=message,
            ),
        )
        self.executor._pixel_checker = self.pixel_checker
        self.executor._color_detector = self.color_detector
        self.executor._feature_matcher = self.feature_matcher
        self.hotkeys = HotkeyManager(
            trigger_callback=self.run_workflow,
            logger=self.add_log,
        )

        self.add_log("应用启动，开始加载快捷键。")
        self.reload_hotkeys()
        self._save_state()

    def _now(self) -> str:
        return datetime.now().strftime("%H:%M:%S")

    def _status_label(self, status: str) -> str:
        labels = {
            "idle": "待机",
            "running": "执行中",
            "looping": "循环中",
            "stopping": "停止中",
            "success": "已完成",
            "error": "异常",
        }
        return labels.get(status, status)

    def _build_runtime_state(self, workflow: WorkflowDefinition) -> dict[str, Any]:
        return {
            "workflow_id": workflow.workflow_id,
            "workflow_name": workflow.name,
            "is_loop": workflow.is_toggle_loop(),
            "status": "idle",
            "status_label": "待机",
            "active": False,
            "last_message": "尚未触发",
            "last_trigger_time": "--",
            "last_finish_time": "--",
            "last_key": "--",
            "last_key_time": "--",
            "key_event_count": 0,
            "iteration_count": 0,
        }

    def _rebuild_workflow_catalog(self) -> None:
        previous_states = getattr(self, "runtime_states", {})
        self.workflows = [*self.builtin_workflows, *self.custom_workflows]
        self.workflow_map = {
            workflow.workflow_id: workflow for workflow in self.workflows
        }

        with self._runtime_lock:
            self.runtime_states = {
                workflow.workflow_id: {
                    **previous_states.get(workflow.workflow_id, self._build_runtime_state(workflow)),
                    "workflow_id": workflow.workflow_id,
                    "workflow_name": workflow.name,
                    "is_loop": workflow.is_toggle_loop(),
                }
                for workflow in self.workflows
            }

    def _sync_runtime_and_state_maps(self) -> None:
        self._rebuild_workflow_catalog()
        self.bindings = {
            workflow.workflow_id: self.bindings.get(
                workflow.workflow_id,
                WorkflowBinding(hotkey=workflow.default_hotkey, enabled=True),
            )
            for workflow in self.workflows
        }
        self.settings = {
            workflow.workflow_id: workflow.normalize_settings(
                self.settings.get(workflow.workflow_id, {})
            )
            for workflow in self.workflows
        }

    def _save_state(self) -> None:
        self.config_store.save_state(
            builtin_workflows=self.builtin_workflows,
            bindings=self.bindings,
            settings=self.settings,
            async_monitor_records=self.async_monitor_records,
            custom_flow_presets_seeded=self.custom_flow_presets_seeded,
        )

    def _generate_custom_flow_id(self, name: str) -> str:
        slug = re.sub(r"[^0-9a-zA-Z]+", "-", name.lower()).strip("-")
        slug = slug or "flow"
        candidate = f"custom-flow-{slug}"
        counter = 2
        while candidate in self.workflow_map:
            candidate = f"custom-flow-{slug}-{counter}"
            counter += 1
        return candidate

    def _generate_async_monitor_id(self, name: str) -> str:
        slug = re.sub(r"[^0-9a-zA-Z]+", "-", name.lower()).strip("-")
        slug = slug or "monitor"
        candidate = f"async-monitor-{slug}"
        counter = 2
        existing_ids = {
            str(record.get("monitor_id", "")).strip()
            for record in self.async_monitor_records
            if isinstance(record, dict)
        }
        while candidate in existing_ids:
            candidate = f"async-monitor-{slug}-{counter}"
            counter += 1
        return candidate

    def _templates_root(self) -> Path:
        return self.template_manager.templates_root()

    def _decode_uploaded_image(self, raw_payload: str) -> bytes:
        return self.template_manager.decode_uploaded_image(raw_payload)

    def _build_uploaded_template_name(self, filename: str, image_format: str) -> str:
        return self.template_manager.build_uploaded_template_name(filename, image_format)

    def _store_uploaded_template(self, filename: str, image_bytes: bytes) -> dict[str, str]:
        return self.template_manager.store_uploaded_template(filename, image_bytes)

    def capture_screen_for_crop(self) -> dict[str, str]:
        return self.template_manager.capture_screen_for_crop()

    def test_template_match(self, template_path: str, confidence: float = 0.88) -> dict:
        return self.template_manager.test_template_match(template_path, confidence)

    def crop_and_save_template(
        self, data_url: str, left: int, top: int, width: int, height: int, filename: str = ""
    ) -> dict[str, str]:
        return self.template_manager.crop_and_save_template(data_url, left, top, width, height, filename)

    def upload_template_image(self, filename: str, data_url: str) -> dict[str, str]:
        return self.template_manager.upload_template_image(filename, data_url)

    def import_template_image_file(self, source_path: str) -> dict[str, str]:
        return self.template_manager.import_template_image_file(source_path)

    def get_template_thumbnail(self, template_path: str, max_size: int = 120) -> dict[str, Any]:
        return self.template_manager.get_template_thumbnail(template_path, max_size)

    def save_async_monitor(self, payload: dict[str, Any]) -> dict[str, Any]:
        monitor_id = str(payload.get("monitor_id", "")).strip()
        name = str(payload.get("name", "")).strip()
        output_variable = str(payload.get("output_variable", payload.get("variable_name", ""))).strip()
        template_path = str(payload.get("template_path", "")).strip()

        if not name:
            raise ValueError("请先填写识别名称。")
        if not output_variable:
            raise ValueError("请先填写保存变量。")
        if not template_path:
            raise ValueError("请先选择模板图片。")

        resolved_template_path = Path(template_path)
        if not resolved_template_path.is_absolute():
            resolved_template_path = self.project_root / resolved_template_path
        if not resolved_template_path.exists():
            raise ValueError(f"模板图片不存在：{resolved_template_path.name}")

        existing_index = next(
            (
                index
                for index, item in enumerate(self.async_monitor_records)
                if str(item.get("monitor_id", "")).strip() == monitor_id
            ),
            None,
        )
        if monitor_id and existing_index is None:
            raise KeyError(monitor_id)
        if not monitor_id:
            monitor_id = self._generate_async_monitor_id(name)

        duplicate_variable = next(
            (
                item
                for item in self.async_monitor_records
                if str(item.get("monitor_id", "")).strip() != monitor_id
                and str(item.get("output_variable", item.get("variable_name", ""))).strip() == output_variable
            ),
            None,
        )
        if duplicate_variable is not None:
            duplicate_name = str(duplicate_variable.get("name", "其他识别")).strip() or "其他识别"
            raise ValueError(f"保存变量“{output_variable}”已被识别“{duplicate_name}”占用。")

        record = sanitize_async_monitor_record(
            {
                "monitor_id": monitor_id,
                "name": name,
                "output_variable": output_variable,
                "template_path": template_path,
                "enabled": payload.get("enabled", True),
                "preset": payload.get("preset", "fixed_button"),
                "search_scope": payload.get("search_scope", "full_screen"),
                "fixed_region": payload.get("fixed_region", {}),
                "scan_rate": payload.get("scan_rate", "normal"),
                "not_found_action": payload.get("not_found_action", "keep_last"),
                "match_mode": payload.get("match_mode", "normal"),
                "custom_confidence": payload.get("custom_confidence", 0.88),
                "follow_radius": payload.get("follow_radius", 220),
                "recover_after_misses": payload.get("recover_after_misses", 2),
                "stale_after_ms": payload.get("stale_after_ms", 1200),
            }
        )
        if record is None:
            raise ValueError("异步识图配置无效。")

        if existing_index is None:
            self.async_monitor_records.append(record)
        else:
            self.async_monitor_records[existing_index] = record

        self._refresh_async_monitors()
        self.async_monitor_records = self.async_vision.get_records()
        self._save_state()
        self.add_log(f"已保存异步识图：{record['name']}", "success")
        return next(
            (
                item
                for item in self.get_async_monitor_payloads()
                if str(item.get("monitor_id", "")).strip() == monitor_id
            ),
            record,
        )

    def delete_async_monitor(self, monitor_id: str) -> None:
        existing = next(
            (
                item
                for item in self.async_monitor_records
                if str(item.get("monitor_id", "")).strip() == monitor_id
            ),
            None,
        )
        if existing is None:
            raise KeyError(monitor_id)

        self.async_monitor_records = [
            item
            for item in self.async_monitor_records
            if str(item.get("monitor_id", "")).strip() != monitor_id
        ]
        self._refresh_async_monitors()
        self.async_monitor_records = self.async_vision.get_records()
        self._save_state()
        self.add_log(f"已删除异步识图：{existing.get('name', monitor_id)}", "warn")

    def get_async_monitor_payloads(self) -> list[dict[str, Any]]:
        return self.async_vision.get_monitor_payloads()

    def get_shared_variable_payloads(self) -> list[dict[str, Any]]:
        return self.async_vision.get_shared_variables_payload()

    def get_async_vision_snapshot(self) -> dict[str, Any]:
        return {
            "monitors": self.get_async_monitor_payloads(),
            "shared_variables": self.get_shared_variable_payloads(),
        }

    def add_log(self, message: str, level: str = "info") -> None:
        entry = {
            "time": self._now(),
            "level": level,
            "message": message,
        }
        with self._log_lock:
            self._logs.appendleft(entry)

    def get_logs(self) -> list[dict[str, str]]:
        with self._log_lock:
            return list(self._logs)

    def _update_runtime_state(self, workflow_id: str, **changes: Any) -> None:
        with self._runtime_lock:
            current = self.runtime_states.get(workflow_id)
            if current is None:
                return
            current.update(changes)
            current["status_label"] = self._status_label(str(current.get("status", "idle")))

    def _append_key_event(
        self,
        workflow_id: str,
        key: str,
        source: str,
        description: str,
    ) -> None:
        workflow = self.workflow_map.get(workflow_id)
        if workflow is None:
            return

        timestamp = self._now()
        entry = {
            "time": timestamp,
            "workflow_id": workflow_id,
            "workflow_name": workflow.name,
            "key": key,
            "source": source,
            "description": description,
        }
        with self._runtime_lock:
            self._key_events.appendleft(entry)
            current = self.runtime_states.get(workflow_id)
            if current is None:
                return
            current["last_key"] = key
            current["last_key_time"] = timestamp
            current["key_event_count"] = int(current.get("key_event_count", 0)) + 1

    def handle_runtime_event(self, workflow_id: str, event: dict[str, Any]) -> None:
        event_type = str(event.get("type", "")).strip()
        now = self._now()

        if event_type == "trigger":
            source = str(event.get("source", "trigger"))
            key = str(event.get("key", "")) or "面板按钮"
            description = f"收到触发：{key}" if source == "hotkey" else "从面板手动触发"
            self._append_key_event(workflow_id, key, "trigger", description)
            self._update_runtime_state(
                workflow_id,
                last_trigger_time=now,
                last_message=description,
                iteration_count=0,
            )
            return

        if event_type == "status":
            status = str(event.get("status", "idle"))
            active = bool(event.get("active", False))
            message = str(event.get("message", "")).strip() or "状态更新"
            changes: dict[str, Any] = {
                "status": status,
                "active": active,
                "last_message": message,
            }
            if status in {"running", "looping", "stopping"}:
                changes["last_trigger_time"] = now
            if status in {"idle", "success", "error"}:
                changes["last_finish_time"] = now
            self._update_runtime_state(workflow_id, **changes)
            return

        if event_type == "key":
            key = str(event.get("key", "")).strip()
            source = str(event.get("source", "macro"))
            if not key:
                return
            source_labels = {
                "loop": "循环输出按键",
                "sequence": "序列输出按键",
                "tap": "单次输出按键",
            }
            self._append_key_event(
                workflow_id,
                key,
                source,
                source_labels.get(source, "模拟输出按键"),
            )
            self._update_runtime_state(
                workflow_id,
                last_message=f"最近输出按键：{key}",
            )
            return

        if event_type == "iteration":
            self._update_runtime_state(
                workflow_id,
                iteration_count=int(event.get("count", 0)),
                last_message=f"已完成 {int(event.get('count', 0))} 轮。",
            )
            return

        if event_type == "match":
            found = bool(event.get("found", False))
            var_name = str(event.get("var_name", "target"))
            if found:
                x = event.get("x")
                y = event.get("y")
                message = f"识图命中并存入 {var_name}：({x}, {y})"
            else:
                message = f"识图未命中，变量 {var_name}。"
            self._update_runtime_state(workflow_id, last_message=message)
            return

        if event_type == "branch":
            self._update_runtime_state(
                workflow_id,
                last_message=str(event.get("message", "进入分支执行。")),
            )
            return

        if event_type == "click":
            x = event.get("x")
            y = event.get("y")
            self._update_runtime_state(
                workflow_id,
                last_message=f"已点击坐标：({x}, {y})",
            )
            return

        if event_type == "step_enter":
            self._update_runtime_state(
                workflow_id,
                current_step_index=int(event.get("step_index", -1)),
                current_step_kind=str(event.get("step_kind", "")),
            )
            return

        if event_type == "step_exit":
            self._update_runtime_state(
                workflow_id,
                current_step_index=-1,
                current_step_kind="",
            )
            return

    def get_runtime_snapshot(self) -> dict[str, Any]:
        with self._runtime_lock:
            workflow_states = {
                workflow_id: dict(state)
                for workflow_id, state in self.runtime_states.items()
            }
            key_events = list(self._key_events)
        active_loop_count = sum(
            1
            for state in workflow_states.values()
            if state.get("is_loop") and state.get("active")
        )
        return {
            "workflow_states": workflow_states,
            "key_events": key_events,
            "active_loop_count": active_loop_count,
        }

    def reload_hotkeys(self) -> None:
        self.hotkeys.bind(self.workflows, self.bindings)

    def set_hotkey_capture(self, active: bool) -> None:
        should_clear = False
        should_reload = False
        with self._hotkey_capture_lock:
            if active:
                self._hotkey_capture_depth += 1
                should_clear = self._hotkey_capture_depth == 1
            elif self._hotkey_capture_depth > 0:
                self._hotkey_capture_depth -= 1
                should_reload = self._hotkey_capture_depth == 0

        if should_clear:
            self.hotkeys.clear()
        elif should_reload:
            self.reload_hotkeys()

    def run_workflow(self, workflow_id: str, trigger_source: str = "hotkey") -> None:
        workflow = self.workflow_map.get(workflow_id)
        binding = self.bindings.get(workflow_id)
        if workflow is None or binding is None:
            self.add_log(f"未找到流程：{workflow_id}", level="error")
            return

        trigger_key = binding.hotkey if trigger_source == "hotkey" else "面板按钮"
        self.handle_runtime_event(
            workflow_id,
            {
                "type": "trigger",
                "source": trigger_source,
                "key": trigger_key,
            },
        )
        self.executor.run_workflow(workflow, self.settings.get(workflow_id, {}))

    def update_binding(
        self,
        workflow_id: str,
        hotkey: str | None = None,
        enabled: bool | None = None,
        settings: dict[str, Any] | None = None,
    ) -> WorkflowBinding:
        binding = self.bindings.get(workflow_id)
        workflow = self.workflow_map.get(workflow_id)
        if binding is None or workflow is None:
            raise KeyError(workflow_id)

        if hotkey is not None:
            binding.hotkey = hotkey.strip()
        if enabled is not None:
            binding.enabled = enabled
        if settings is not None:
            self.settings[workflow_id] = workflow.normalize_settings(settings)

        self._save_state()
        self.reload_hotkeys()
        if enabled is not None:
            self._refresh_async_monitors()
        return binding

    def save_custom_flow(self, payload: dict[str, Any]) -> dict[str, Any]:
        workflow_id = str(payload.get("workflow_id", "")).strip()
        name = str(payload.get("name", "")).strip()
        hotkey = str(payload.get("hotkey", "")).strip()
        description = str(payload.get("description", "")).strip() or "用户创建的流程。"
        enabled = bool(payload.get("enabled", True))
        run_mode = payload.get("run_mode", default_custom_flow_payload()["run_mode"])
        steps = payload.get("steps", default_custom_flow_payload()["steps"])
        node_graph = payload.get("node_graph", None)

        if not name:
            raise ValueError("流程名字不能为空。")
        if not hotkey:
            raise ValueError("触发热键不能为空。")

        if workflow_id:
            existing_workflow = self.workflow_map.get(workflow_id)
            if existing_workflow is None or existing_workflow.source != "custom":
                raise KeyError(workflow_id)
            self.executor.stop_workflow(workflow_id)
        else:
            workflow_id = self._generate_custom_flow_id(name)
            existing_workflow = None

        category = existing_workflow.category if existing_workflow is not None else "流程编排"
        notes = list(existing_workflow.notes) if existing_workflow is not None else [
            "这是用户自定义的流程，可在流程编排页继续编辑。",
            "支持一次执行、次数循环和开关循环。",
        ]

        record = {
            "workflow_id": workflow_id,
            "name": name,
            "description": description,
            "category": category,
            "notes": notes,
            "hotkey": hotkey,
            "enabled": enabled,
            "run_mode": run_mode,
            "steps": steps,
            "node_graph": node_graph,
        }
        workflow = build_custom_flow_workflows([record])[0]

        existing_index = next(
            (
                index
                for index, item in enumerate(self.custom_workflows)
                if item.workflow_id == workflow_id
            ),
            None,
        )
        if existing_index is None:
            self.custom_workflows.append(workflow)
        else:
            self.custom_workflows[existing_index] = workflow

        self._rebuild_workflow_catalog()
        self.bindings[workflow_id] = WorkflowBinding(hotkey=hotkey, enabled=enabled)
        self.settings[workflow_id] = {}

        # 保存工作流到独立文件
        file_record = serialize_custom_flow_workflow(
            workflow,
            self.bindings[workflow_id],
        )
        file_record["version"] = 1
        self.workflow_store.save_record(file_record)

        self._save_state()
        self.reload_hotkeys()
        self._refresh_async_monitors()
        self.add_log(f"已保存流程：{name}", "success")
        return workflow.to_dict(self.bindings[workflow_id], issues=[])

    def save_loop_macro(self, payload: dict[str, Any]) -> dict[str, Any]:
        sequence = payload.get("sequence", [])
        steps: list[dict[str, Any]] = []
        for step in list(sequence):
            if not isinstance(step, dict):
                continue
            steps.append(
                {
                    "kind": "key_tap",
                    "keys": str(step.get("keys", "")).strip(),
                    "delay_ms_after": int(step.get("delay_ms", 100)),
                }
            )
        return self.save_custom_flow(
            {
                "workflow_id": payload.get("workflow_id", ""),
                "name": payload.get("name", "循环宏"),
                "hotkey": payload.get("hotkey", ""),
                "description": payload.get("description", "兼容旧版循环宏入口创建的流程。"),
                "enabled": payload.get("enabled", True),
                "run_mode": {"type": "toggle_loop"},
                "steps": steps,
            }
        )

    def delete_custom_workflow(self, workflow_id: str) -> None:
        workflow = self.workflow_map.get(workflow_id)
        if workflow is None or workflow.source != "custom":
            raise KeyError(workflow_id)

        self.executor.stop_workflow(workflow_id)
        self.custom_workflows = [
            item for item in self.custom_workflows if item.workflow_id != workflow_id
        ]
        self.bindings.pop(workflow_id, None)
        self.settings.pop(workflow_id, None)
        with self._runtime_lock:
            self.runtime_states.pop(workflow_id, None)
        self._rebuild_workflow_catalog()
        self.workflow_store.delete_record(workflow_id)
        self._save_state()
        self.reload_hotkeys()
        self._refresh_async_monitors()
        self.add_log(f"已删除流程：{workflow.name}", "warn")

    def get_tabs_payload(self) -> list[dict[str, Any]]:
        counts = {item["key"]: 0 for item in get_tab_definitions()}
        for workflow in self.workflows:
            counts[workflow.tab_key] = counts.get(workflow.tab_key, 0) + 1
        counts["async_vision"] = len(self.async_monitor_records)
        return [
            {
                **tab,
                "count": counts.get(tab["key"], 0),
            }
            for tab in get_tab_definitions()
        ]

    def inspect_workflow(self, workflow: WorkflowDefinition) -> list[str]:
        issues: list[str] = []
        for payload in iter_action_payloads(workflow.actions):
            if payload.get("kind") not in {"detect_image", "detect_click_return"}:
                continue
            template_path = Path(str(payload.get("template_path", "")))
            if template_path and not template_path.is_absolute():
                template_path = self.project_root / template_path
            if template_path and not template_path.exists():
                issues.append(f"缺少模板图：{template_path.name}")
        return issues

    def get_workflow_payloads(self) -> list[dict[str, Any]]:
        tab_order = {
            tab["key"]: index for index, tab in enumerate(get_tab_definitions())
        }
        ordered_workflows = sorted(
            self.workflows,
            key=lambda workflow: (
                tab_order.get(workflow.tab_key, 99),
                workflow.source != "builtin",
                workflow.name.lower(),
            ),
        )
        return [
            workflow.to_dict(
                binding=self.bindings[workflow.workflow_id],
                issues=self.inspect_workflow(workflow),
                setting_values=self.settings.get(workflow.workflow_id, {}),
            )
            for workflow in ordered_workflows
        ]

    def get_summary(self) -> dict[str, int]:
        runtime_snapshot = self.get_runtime_snapshot()
        enabled_count = sum(1 for binding in self.bindings.values() if binding.enabled)
        visual_count = sum(
            1
            for workflow in self.workflows
                if any(payload.get("kind") == "detect_image" for payload in iter_action_payloads(workflow.actions))
        ) + len(self.async_monitor_records)
        loop_count = sum(1 for workflow in self.workflows if workflow.is_toggle_loop())
        custom_flow_count = len(self.custom_workflows)
        return {
            "workflow_count": len(self.workflows),
            "enabled_count": enabled_count,
            "visual_count": visual_count,
            "loop_count": loop_count,
            "custom_flow_count": custom_flow_count,
            "active_loop_count": int(runtime_snapshot["active_loop_count"]),
        }

    def bootstrap(self) -> dict[str, Any]:
        return {
            "app": {
                "name": "织流 FlowWeaver",
                "version": "0.7.0",
                "workflow_source": "app/core/workflows.py",
            },
            "designer_defaults": default_custom_flow_payload(),
            "tabs": self.get_tabs_payload(),
            "summary": self.get_summary(),
            "runtime": self.get_runtime_snapshot(),
            "workflows": self.get_workflow_payloads(),
            "logs": self.get_logs(),
            "async_vision": self.get_async_vision_snapshot(),
            "architecture": [
                {
                    "title": "统一流程模型",
                    "description": "流程统一为 run_mode + steps，支持一次、次数循环和开关循环。",
                },
                {
                    "title": "识图上下文变量",
                    "description": "识图结果会把坐标写入上下文变量，后续点击和分支可以直接引用。",
                },
                {
                    "title": "流程编排页",
                    "description": "全部同步流程统一汇总到流程编排页，内置示例与自定义流程共用同一套步骤模型。",
                },
            ],
        }

    def _collect_needed_shared_variables(self) -> set[str]:
        needed: set[str] = set()
        for workflow in self.workflows:
            binding = self.bindings.get(workflow.workflow_id)
            if binding is not None and binding.enabled:
                needed |= extract_shared_variable_names(workflow.actions)
        return needed

    def _refresh_async_monitors(self) -> None:
        needed_variables = self._collect_needed_shared_variables()
        self.async_vision.replace_monitors(self.async_monitor_records, needed_variables=needed_variables)

    def shutdown(self) -> None:
        for cleanup in (
            self.executor.shutdown,
            self.async_vision.shutdown,
            self.hotkeys.clear,
            self._shared_capture.close,
        ):
            try:
                cleanup()
            except Exception:
                pass
