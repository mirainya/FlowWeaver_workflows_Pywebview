from __future__ import annotations

from collections.abc import Callable

import keyboard

from app.models import WorkflowBinding, WorkflowDefinition
from app.services.input_controller import normalize_hotkey


class HotkeyManager:
    def __init__(
        self,
        trigger_callback: Callable[[str, str], None],
        logger: Callable[[str, str], None],
    ) -> None:
        self._trigger_callback = trigger_callback
        self._logger = logger
        self._registrations: list[int | str] = []

    def bind(
        self,
        workflows: list[WorkflowDefinition],
        bindings: dict[str, WorkflowBinding],
    ) -> None:
        self.clear()

        # 冲突检测
        hotkey_usage: dict[str, list[str]] = {}
        for workflow in workflows:
            binding = bindings.get(workflow.workflow_id)
            if binding is None or not binding.enabled:
                continue
            hotkey = normalize_hotkey(binding.hotkey.strip())
            if not hotkey:
                continue
            hotkey_usage.setdefault(hotkey, []).append(workflow.name)

        for hotkey, names in hotkey_usage.items():
            if len(names) > 1:
                self._logger(
                    f"热键冲突：{hotkey} 同时绑定了 {', '.join(names)}，仅第一个生效。",
                    "warn",
                )

        # 注册热键
        registered_hotkeys: set[str] = set()

        for workflow in workflows:
            binding = bindings.get(workflow.workflow_id)
            if binding is None or not binding.enabled:
                continue

            hotkey = normalize_hotkey(binding.hotkey.strip())
            if not hotkey:
                continue

            if hotkey in registered_hotkeys:
                continue
            registered_hotkeys.add(hotkey)

            try:
                registration = keyboard.add_hotkey(
                    hotkey,
                    lambda workflow_id=workflow.workflow_id: self._trigger_callback(workflow_id, "hotkey"),
                    suppress=False,
                    trigger_on_release=False,
                )
            except Exception as exc:
                self._logger(f"快捷键注册失败：{workflow.name} -> {hotkey}，{exc}", "error")
                continue

            self._registrations.append(registration)
            self._logger(f"快捷键已绑定：{workflow.name} -> {hotkey}", "info")

    def clear(self) -> None:
        for registration in self._registrations:
            try:
                keyboard.remove_hotkey(registration)
            except Exception:
                continue
        self._registrations.clear()
