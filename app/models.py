from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


RUN_MODE_TYPES = {"once", "repeat_n", "toggle_loop"}


@dataclass(slots=True)
class ActionDefinition:
    kind: str
    title: str
    description: str = ""
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "title": self.title,
            "description": self.description,
            "params": self.params,
        }


@dataclass(slots=True)
class WorkflowSettingDefinition:
    key: str
    title: str
    description: str
    default_value: int
    input_type: str = "number"
    min_value: int | None = None
    max_value: int | None = None
    step: int = 1

    def normalize(self, value: Any) -> int:
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            normalized = self.default_value

        if self.min_value is not None:
            normalized = max(self.min_value, normalized)
        if self.max_value is not None:
            normalized = min(self.max_value, normalized)
        return normalized

    def to_dict(self, current_value: Any | None = None) -> dict[str, Any]:
        value = self.normalize(self.default_value if current_value is None else current_value)
        return {
            "key": self.key,
            "title": self.title,
            "description": self.description,
            "input_type": self.input_type,
            "default_value": self.default_value,
            "value": value,
            "min_value": self.min_value,
            "max_value": self.max_value,
            "step": self.step,
        }


@dataclass(slots=True)
class WorkflowBinding:
    hotkey: str
    enabled: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "hotkey": self.hotkey,
            "enabled": self.enabled,
        }


@dataclass(slots=True)
class WorkflowDefinition:
    workflow_id: str
    name: str
    description: str
    category: str
    tab_key: str
    default_hotkey: str
    actions: list[ActionDefinition]
    notes: list[str] = field(default_factory=list)
    settings: list[WorkflowSettingDefinition] = field(default_factory=list)
    run_mode: dict[str, Any] = field(default_factory=lambda: {"type": "once"})
    source: str = "builtin"
    definition_editable: bool = False

    def default_settings(self) -> dict[str, int]:
        return {
            setting.key: setting.default_value
            for setting in self.settings
        }

    def normalize_settings(self, values: dict[str, Any] | None = None) -> dict[str, int]:
        current_values = values or {}
        return {
            setting.key: setting.normalize(current_values.get(setting.key, setting.default_value))
            for setting in self.settings
        }

    def normalize_run_mode(self, value: dict[str, Any] | None = None) -> dict[str, Any]:
        raw = value or self.run_mode or {"type": "once"}
        mode_type = str(raw.get("type", "once")).strip()
        if mode_type not in RUN_MODE_TYPES:
            mode_type = "once"

        normalized: dict[str, Any] = {"type": mode_type}
        if mode_type == "repeat_n":
            try:
                count = int(raw.get("count", 1))
            except (TypeError, ValueError):
                count = 1
            normalized["count"] = max(1, min(count, 100000))
        return normalized

    def is_toggle_loop(self) -> bool:
        return self.normalize_run_mode().get("type") == "toggle_loop"

    def to_dict(
        self,
        binding: WorkflowBinding,
        issues: list[str] | None = None,
        setting_values: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_settings = self.normalize_settings(setting_values)
        normalized_run_mode = self.normalize_run_mode()
        return {
            "workflow_id": self.workflow_id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "tab_key": self.tab_key,
            "default_hotkey": self.default_hotkey,
            "binding": binding.to_dict(),
            "notes": list(self.notes),
            "issues": issues or [],
            "source": self.source,
            "is_custom": self.source == "custom",
            "definition_editable": self.definition_editable,
            "run_mode": normalized_run_mode,
            "is_loop": normalized_run_mode.get("type") == "toggle_loop",
            "settings": [
                setting.to_dict(normalized_settings.get(setting.key))
                for setting in self.settings
            ],
            "actions": [action.to_dict() for action in self.actions],
        }
