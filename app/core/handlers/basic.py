from __future__ import annotations

import random
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from threading import Event


class BasicHandlersMixin:
    """处理基础动作：delay, key_tap, key_sequence, type_text, log"""

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
            return

        is_plain_key = len(keys) == 1 and keys.strip() and "+" not in keys
        if is_plain_key:
            self._input.tap_key(keys)
            self._emit_runtime_event(
                workflow_id,
                {
                    "type": "key",
                    "key": keys,
                    "source": "tap",
                },
            )
        else:
            self._press_combo(workflow_id, keys, "tap")

        delay_ms = self._resolve_delay_ms(params, workflow_settings, field="delay_ms_after")
        self._wait_delay(delay_ms, stop_event)

    def _handle_key_sequence(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        sequence = list(params.get("sequence", []))
        for item in sequence:
            if stop_event is not None and stop_event.is_set():
                return
            if not isinstance(item, dict):
                continue
            keys = str(item.get("keys", "")).strip()
            if not keys:
                continue
            self._press_combo(workflow_id, keys, "key_sequence")
            delay_ms = self._resolve_delay_ms(item, workflow_settings, field="delay_ms")
            self._wait_delay(delay_ms, stop_event)

    def _handle_type_text(
        self,
        workflow_id: str,
        params: dict[str, Any],
        stop_event: Event | None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        text = str(params.get("text", ""))
        if not text:
            return
        self._input.type_text(text)
        self._emit_runtime_event(
            workflow_id,
            {"type": "type_text", "length": len(text)},
        )

    def _handle_log(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        message = str(params.get("message", ""))
        level = str(params.get("level", "info")).strip()
        if level not in {"info", "warn", "error", "success"}:
            level = "info"

        if "{" in message:
            try:
                local_vars = {}
                with context["vars_lock"]:
                    local_vars = dict(context.get("vars", {}))
                flat: dict[str, str] = {}
                for var_name, var_data in local_vars.items():
                    if isinstance(var_data, dict):
                        for k, v in var_data.items():
                            flat[f"{var_name}.{k}"] = str(v)
                        flat[var_name] = str(var_data.get("found", ""))
                message = message.format_map(type("_FallbackDict", (dict,), {"__missing__": staticmethod(lambda key: f"{{{key}}}")})(**flat))
            except Exception:
                pass

        self._logger(f"[流程日志] {message}", level)
        self._emit_runtime_event(
            workflow_id,
            {"type": "log", "message": message, "level": level},
        )
