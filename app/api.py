from __future__ import annotations

from typing import Any

import webview

from app.application import AssistantApplication


class DesktopApi:
    def __init__(self, application: AssistantApplication) -> None:
        self._application = application
        self._window: Any | None = None

    def attach_window(self, window: Any) -> None:
        self._window = window

    def bootstrap(self) -> dict[str, Any]:
        return self._application.bootstrap()

    def list_logs(self) -> list[dict[str, str]]:
        return self._application.get_logs()

    def get_runtime_snapshot(self) -> dict[str, Any]:
        return self._application.get_runtime_snapshot()

    def save_binding(
        self,
        workflow_id: str,
        hotkey: str,
        enabled: bool,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            binding = self._application.update_binding(
                workflow_id=workflow_id,
                hotkey=hotkey,
                enabled=enabled,
                settings=settings,
            )
            return {
                "ok": True,
                "binding": binding.to_dict(),
                "summary": self._application.get_summary(),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_custom_flow(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            workflow = self._application.save_custom_flow(payload)
            return {
                "ok": True,
                "workflow": workflow,
                "summary": self._application.get_summary(),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def upload_template_image(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            result = self._application.upload_template_image(
                filename=str(payload.get("filename", "")),
                data_url=str(payload.get("data_url", "")),
            )
            return {
                "ok": True,
                **result,
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def pick_template_image(self) -> dict[str, Any]:
        try:
            if self._window is None:
                raise RuntimeError("文件对话框尚未准备好，请稍后再试。")

            open_dialog = getattr(getattr(webview, "FileDialog", None), "OPEN", None)
            if open_dialog is None:
                open_dialog = webview.OPEN_DIALOG

            selected_paths = self._window.create_file_dialog(
                open_dialog,
                allow_multiple=False,
                file_types=(
                    "图片文件 (*.png;*.jpg;*.jpeg;*.bmp;*.webp)",
                    "全部文件 (*.*)",
                ),
            )
            if not selected_paths:
                return {
                    "ok": True,
                    "template_path": "",
                    "filename": "",
                }

            if isinstance(selected_paths, (list, tuple)):
                selected_path = str(selected_paths[0])
            else:
                selected_path = str(selected_paths)

            result = self._application.import_template_image_file(selected_path)
            return {
                "ok": True,
                **result,
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def get_async_vision_snapshot(self) -> dict[str, Any]:
        return self._application.get_async_vision_snapshot()

    def save_async_monitor(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            monitor = self._application.save_async_monitor(payload)
            return {
                "ok": True,
                "monitor": monitor,
                "summary": self._application.get_summary(),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def delete_async_monitor(self, monitor_id: str) -> dict[str, Any]:
        try:
            self._application.delete_async_monitor(monitor_id)
            return {
                "ok": True,
                "summary": self._application.get_summary(),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_loop_macro(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            workflow = self._application.save_loop_macro(payload)
            return {
                "ok": True,
                "workflow": workflow,
                "summary": self._application.get_summary(),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def delete_custom_workflow(self, workflow_id: str) -> dict[str, Any]:
        try:
            self._application.delete_custom_workflow(workflow_id)
            return {
                "ok": True,
                "summary": self._application.get_summary(),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def run_workflow_now(self, workflow_id: str) -> dict[str, Any]:
        self._application.run_workflow(workflow_id, trigger_source="panel")
        return {"ok": True}

    def begin_key_capture(self) -> dict[str, Any]:
        self._application.set_hotkey_capture(True)
        return {"ok": True}

    def end_key_capture(self) -> dict[str, Any]:
        self._application.set_hotkey_capture(False)
        return {"ok": True}

    def capture_screen_for_crop(self) -> dict[str, Any]:
        try:
            return {"ok": True, **self._application.capture_screen_for_crop()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def crop_and_save_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            result = self._application.crop_and_save_template(
                data_url=str(payload.get("data_url", "")),
                left=int(payload.get("left", 0)),
                top=int(payload.get("top", 0)),
                width=int(payload.get("width", 0)),
                height=int(payload.get("height", 0)),
                filename=str(payload.get("filename", "")),
            )
            return {"ok": True, **result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def test_template_match(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            result = self._application.test_template_match(
                template_path=str(payload.get("template_path", "")),
                confidence=float(payload.get("confidence", 0.88)),
            )
            return {"ok": True, **result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def get_template_thumbnail(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._application.get_template_thumbnail(
                template_path=str(payload.get("template_path", "")),
                max_size=int(payload.get("max_size", 120)),
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def pick_color(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            result = self._application.pixel_checker.pick_color(
                x=int(payload.get("x", 0)),
                y=int(payload.get("y", 0)),
            )
            return {"ok": True, **result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def capture_fingerprint(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            anchor_x = int(payload.get("anchor_x", 0))
            anchor_y = int(payload.get("anchor_y", 0))
            raw_offsets = list(payload.get("offsets", []))
            offsets = [(int(o.get("dx", 0)), int(o.get("dy", 0))) for o in raw_offsets if isinstance(o, dict)]
            sample_points = self._application.feature_matcher.capture_fingerprint(
                anchor_x=anchor_x,
                anchor_y=anchor_y,
                offsets=offsets,
            )
            return {"ok": True, "sample_points": sample_points}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
