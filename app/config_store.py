from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

from app.models import WorkflowBinding, WorkflowDefinition

logger = logging.getLogger(__name__)


class ConfigStore:
    def __init__(self, config_path: Path) -> None:
        self._config_path = config_path

    def _default_payload(self) -> dict[str, Any]:
        return {
            "bindings": {},
            "settings": {},
            "custom_workflows": {
                "sample_presets_seeded": False,
            },
            "async_vision": {
                "monitors": [],
            },
        }

    def load_payload(self) -> dict[str, Any]:
        payload = self._default_payload()
        if not self._config_path.exists():
            return payload

        try:
            raw_payload = json.loads(self._config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return payload

        if not isinstance(raw_payload, dict):
            return payload

        payload["bindings"] = dict(raw_payload.get("bindings", {}))
        payload["settings"] = dict(raw_payload.get("settings", {}))

        custom_payload = raw_payload.get("custom_workflows", {})
        if isinstance(custom_payload, dict):
            payload["custom_workflows"]["flows"] = list(custom_payload.get("flows", []))
            payload["custom_workflows"]["sample_presets_seeded"] = bool(custom_payload.get("sample_presets_seeded", False))

        async_vision_payload = raw_payload.get("async_vision", {})
        if isinstance(async_vision_payload, dict):
            payload["async_vision"]["monitors"] = list(async_vision_payload.get("monitors", []))
        return payload

    def load_async_monitor_records(self) -> list[dict[str, Any]]:
        payload = self.load_payload()
        return [
            dict(record)
            for record in payload["async_vision"].get("monitors", [])
            if isinstance(record, dict)
        ]

    def load_custom_flow_records(self) -> list[dict[str, Any]]:
        payload = self.load_payload()
        return [
            dict(record)
            for record in payload["custom_workflows"].get("flows", [])
            if isinstance(record, dict)
        ]

    def load_custom_flow_presets_seeded(self) -> bool:
        payload = self.load_payload()
        return bool(payload["custom_workflows"].get("sample_presets_seeded", False))

    def load_all(self) -> dict[str, Any]:
        payload = self.load_payload()
        return {
            "async_monitor_records": [
                dict(record)
                for record in payload["async_vision"].get("monitors", [])
                if isinstance(record, dict)
            ],
            "custom_flow_presets_seeded": bool(
                payload["custom_workflows"].get("sample_presets_seeded", False)
            ),
        }

    def load_state(
        self,
        builtin_workflows: list[WorkflowDefinition],
        custom_workflows: list[WorkflowDefinition],
        custom_flow_records: list[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, WorkflowBinding], dict[str, dict[str, int]]]:
        payload = self.load_payload()
        binding_payload = payload.get("bindings", {})
        settings_payload = payload.get("settings", {})
        records = custom_flow_records if custom_flow_records is not None else [
            dict(record)
            for record in payload["custom_workflows"].get("flows", [])
            if isinstance(record, dict)
        ]
        custom_lookup = {
            str(record.get("workflow_id", "")).strip(): record
            for record in records
            if isinstance(record, dict)
        }

        bindings: dict[str, WorkflowBinding] = {}
        settings: dict[str, dict[str, int]] = {}

        for workflow in builtin_workflows:
            current_binding = binding_payload.get(workflow.workflow_id, {})
            bindings[workflow.workflow_id] = WorkflowBinding(
                hotkey=str(current_binding.get("hotkey", workflow.hotkey)).strip(),
                enabled=bool(current_binding.get("enabled", True)),
            )
            settings[workflow.workflow_id] = workflow.normalize_settings(
                settings_payload.get(workflow.workflow_id, {})
            )

        for workflow in custom_workflows:
            current_record = custom_lookup.get(workflow.workflow_id, {})
            bindings[workflow.workflow_id] = WorkflowBinding(
                hotkey=str(current_record.get("hotkey", workflow.hotkey)).strip(),
                enabled=bool(current_record.get("enabled", True)),
            )
            settings[workflow.workflow_id] = {}

        return bindings, settings

    def save_state(
        self,
        builtin_workflows: list[WorkflowDefinition],
        bindings: dict[str, WorkflowBinding],
        settings: dict[str, dict[str, Any]],
        async_monitor_records: list[dict[str, Any]],
        custom_flow_presets_seeded: bool,
    ) -> None:
        self._config_path.parent.mkdir(parents=True, exist_ok=True)

        builtin_ids = {workflow.workflow_id for workflow in builtin_workflows}
        payload = self._default_payload()
        payload["bindings"] = {
            workflow_id: binding.to_dict()
            for workflow_id, binding in bindings.items()
            if workflow_id in builtin_ids
        }
        payload["settings"] = {
            workflow_id: values
            for workflow_id, values in settings.items()
            if workflow_id in builtin_ids and values
        }
        payload["custom_workflows"]["sample_presets_seeded"] = bool(custom_flow_presets_seeded)
        payload["async_vision"]["monitors"] = [
            dict(record)
            for record in async_monitor_records
            if isinstance(record, dict)
        ]

        content = json.dumps(payload, ensure_ascii=False, indent=2)
        try:
            fd, tmp_path = tempfile.mkstemp(
                dir=str(self._config_path.parent),
                suffix=".tmp",
            )
            try:
                os.write(fd, content.encode("utf-8"))
                os.close(fd)
                fd = -1
                os.replace(tmp_path, str(self._config_path))
            except BaseException:
                if fd >= 0:
                    os.close(fd)
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
        except OSError:
            self._config_path.write_text(content, encoding="utf-8")

    def migrate_flows_to_files(self, workflow_store: Any) -> int:
        """从旧 config.json 提取 flows 到独立文件，幂等操作。"""
        if not self._config_path.exists():
            return 0
        try:
            raw_payload = json.loads(self._config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return 0
        if not isinstance(raw_payload, dict):
            return 0
        custom_section = raw_payload.get("custom_workflows")
        if not isinstance(custom_section, dict):
            return 0
        flows = custom_section.get("flows")
        if not isinstance(flows, list) or not flows:
            return 0

        migrated = 0
        existing_records = {
            str(r.get("workflow_id", "")).strip()
            for r in workflow_store.load_all_records()
        }
        for record in flows:
            if not isinstance(record, dict):
                continue
            wid = str(record.get("workflow_id", "")).strip()
            if not wid or wid in existing_records:
                continue
            record["version"] = record.get("version", 1)
            try:
                workflow_store.save_record(record)
                migrated += 1
                logger.info("已迁移工作流到独立文件: %s", wid)
            except Exception as exc:
                logger.warning("迁移工作流失败 %s: %s", wid, exc)

        if migrated > 0:
            custom_section.pop("flows", None)
            content = json.dumps(raw_payload, ensure_ascii=False, indent=2)
            try:
                self._config_path.write_text(content, encoding="utf-8")
            except OSError as exc:
                logger.warning("更新 config.json 失败: %s", exc)
            logger.info("已从 config.json 迁移 %d 个工作流到独立文件", migrated)
        return migrated
