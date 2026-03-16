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
from app.core.executor import WorkflowExecutor
from app.core.hotkeys import HotkeyManager
from app.core.workflows import (
    build_custom_flow_workflows,
    build_preset_custom_flow_records,
    default_custom_flow_payload,
    extract_shared_variable_names,
    get_tab_definitions,
    iter_action_payloads,
)
from app.models import WorkflowBinding, WorkflowDefinition
from app.services.async_vision import AsyncVisionManager, sanitize_async_monitor_record
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
        loaded = self.config_store.load_all()
        self.async_monitor_records = loaded["async_monitor_records"]
        self.custom_flow_presets_seeded = loaded["custom_flow_presets_seeded"]
        custom_flow_records = loaded["custom_flow_records"]
        if not self.custom_flow_presets_seeded:
            existing_ids = {
                str(record.get("workflow_id", "")).strip()
                for record in custom_flow_records
                if isinstance(record, dict)
            }
            for record in build_preset_custom_flow_records(project_root):
                workflow_id = str(record.get("workflow_id", "")).strip()
                if workflow_id and workflow_id not in existing_ids:
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
            custom_workflows=self.custom_workflows,
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
        templates_root = self.project_root / "assets" / "templates"
        templates_root.mkdir(parents=True, exist_ok=True)
        return templates_root

    def _decode_uploaded_image(self, raw_payload: str) -> bytes:
        payload = str(raw_payload or "").strip()
        if not payload:
            raise ValueError("上传内容不能为空。")

        if payload.startswith("data:"):
            matched = re.match(
                r"^data:image/[a-zA-Z0-9.+-]+;base64,(?P<body>.+)$",
                payload,
                flags=re.IGNORECASE | re.DOTALL,
            )
            if matched is None:
                raise ValueError("上传内容不是合法的图片数据。")
            payload = matched.group("body")

        payload = re.sub(r"\s+", "", payload)
        try:
            return base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("图片解码失败，请重新选择模板图。") from exc

    def _build_uploaded_template_name(self, filename: str, image_format: str) -> str:
        raw_stem = Path(filename or "template").stem.strip()
        safe_stem = re.sub(r"[^0-9a-zA-Z]+", "-", raw_stem.lower()).strip("-") or "template"

        normalized_suffix = Path(filename or "").suffix.lower()
        allowed_suffixes = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}
        suffix_by_format = {
            "PNG": ".png",
            "JPEG": ".jpg",
            "JPG": ".jpg",
            "BMP": ".bmp",
            "WEBP": ".webp",
        }
        if normalized_suffix not in allowed_suffixes:
            normalized_suffix = suffix_by_format.get(image_format.upper(), ".png")
        if normalized_suffix == ".jpeg":
            normalized_suffix = ".jpg"

        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        return f"{safe_stem}-{timestamp}-{uuid4().hex[:8]}{normalized_suffix}"

    def _store_uploaded_template(self, filename: str, image_bytes: bytes) -> dict[str, str]:
        try:
            with Image.open(BytesIO(image_bytes)) as image:
                image.load()
                image_format = str(image.format or "").upper()
        except UnidentifiedImageError as exc:
            raise ValueError("上传文件不是支持的图片格式。") from exc

        target_name = self._build_uploaded_template_name(filename, image_format)
        target_path = self._templates_root() / target_name
        target_path.write_bytes(image_bytes)

        relative_path = target_path.relative_to(self.project_root).as_posix()
        self.add_log(f"已上传模板图：{target_name}", "success")
        return {
            "template_path": relative_path,
            "filename": target_name,
        }

    def capture_screen_for_crop(self) -> dict[str, str]:
        """截取当前屏幕，返回 base64 编码的 PNG 数据 URL，供前端覆盖层使用。"""
        import cv2 as _cv2

        frame = self._shared_capture.grab()
        success, png_buffer = _cv2.imencode(".png", frame)
        if not success:
            raise RuntimeError("屏幕截图编码失败。")
        b64 = base64.b64encode(png_buffer.tobytes()).decode("ascii")
        h, w = frame.shape[:2]
        return {
            "data_url": f"data:image/png;base64,{b64}",
            "width": w,
            "height": h,
        }

    def test_template_match(self, template_path: str, confidence: float = 0.88) -> dict:
        """单次识图测试，返回匹配结果和标注预览图。"""
        resolved = Path(template_path)
        if not resolved.is_absolute():
            resolved = self.project_root / resolved
        if not resolved.exists():
            raise ValueError(f"模板图片不存在：{resolved.name}")
        return self.vision.test_template_match(
            template_path=resolved,
            confidence=confidence,
        )

    def crop_and_save_template(
        self, data_url: str, left: int, top: int, width: int, height: int, filename: str = ""
    ) -> dict[str, str]:
        """从截屏数据中裁剪指定区域并保存为模板图片。"""
        image_bytes = self._decode_uploaded_image(data_url)
        with Image.open(BytesIO(image_bytes)) as img:
            img.load()
            crop_box = (
                max(0, int(left)),
                max(0, int(top)),
                min(img.width, int(left) + int(width)),
                min(img.height, int(top) + int(height)),
            )
            cropped = img.crop(crop_box)
            buf = BytesIO()
            cropped.save(buf, format="PNG")
            cropped_bytes = buf.getvalue()

        save_name = filename.strip() if filename else "crop"
        return self._store_uploaded_template(f"{save_name}.png", cropped_bytes)

    def upload_template_image(self, filename: str, data_url: str) -> dict[str, str]:
        image_bytes = self._decode_uploaded_image(data_url)
        return self._store_uploaded_template(filename, image_bytes)

    def import_template_image_file(self, source_path: str) -> dict[str, str]:
        resolved_source_path = Path(str(source_path or "")).expanduser()
        if not resolved_source_path.exists() or not resolved_source_path.is_file():
            raise ValueError("选择的模板文件不存在。")

        try:
            image_bytes = resolved_source_path.read_bytes()
        except OSError as exc:
            raise ValueError("读取模板文件失败。") from exc

        return self._store_uploaded_template(resolved_source_path.name, image_bytes)

    def get_template_thumbnail(self, template_path: str, max_size: int = 120) -> dict[str, Any]:
        """返回模板图片的缩略图 data URL。"""
        resolved = Path(template_path)
        if not resolved.is_absolute():
            resolved = self.project_root / resolved
        if not resolved.exists():
            return {"ok": False, "error": "模板图片不存在"}
        try:
            with Image.open(resolved) as img:
                img.load()
                w, h = img.size
                ratio = min(max_size / w, max_size / h, 1.0)
                thumb_w = max(1, int(w * ratio))
                thumb_h = max(1, int(h * ratio))
                thumb = img.resize((thumb_w, thumb_h), Image.LANCZOS)
                buf = BytesIO()
                thumb.save(buf, format="PNG")
                import base64
                data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
                return {"ok": True, "data_url": data_url, "width": w, "height": h}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

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
                "name": "Luoqi Assistant",
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
