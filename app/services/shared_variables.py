from __future__ import annotations

import time
from copy import deepcopy
from threading import Lock
from typing import Any


class SharedVariableStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._variables: dict[str, dict[str, Any]] = {}

    def ensure_variable(self, monitor: dict[str, Any]) -> None:
        variable_name = str(monitor.get("output_variable", "target")).strip() or "target"
        with self._lock:
            current = deepcopy(self._variables.get(variable_name, {}))
            if not current:
                current = self._build_default_value(monitor)
            current["template_path"] = str(monitor.get("template_path", ""))
            current["_shared"] = self._build_meta(monitor, current.get("_shared", {}), status="idle")
            self._variables[variable_name] = current

    def apply_result(
        self,
        monitor: dict[str, Any],
        result: dict[str, Any] | None,
        *,
        status: str,
        message: str,
        runtime_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        variable_name = str(monitor.get("output_variable", "target")).strip() or "target"
        with self._lock:
            current = deepcopy(self._variables.get(variable_name, {}))
            if not current:
                current = self._build_default_value(monitor)

            current_meta = dict(current.get("_shared", {}))
            merged_meta = self._build_meta(
                monitor,
                current_meta,
                status=status,
                message=message,
                runtime_meta=runtime_meta,
            )
            now = float(merged_meta.get("updated_at", time.time()))
            last_hit_at = float(merged_meta.get("last_hit_at") or 0)

            if result and result.get("found"):
                current.update(result)
                current["score"] = float(result.get("confidence", 0.0))
                current["updated_at"] = now
                current["stale"] = False
            elif status == "miss":
                current["updated_at"] = now
                current["template_path"] = str(monitor.get("template_path", ""))
                if str(monitor.get("not_found_action", "keep_last")) == "mark_missing":
                    current.update(
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
                        }
                    )
                    current["stale"] = True

                if str(monitor.get("not_found_action", "keep_last")) == "mark_missing":
                    current["stale"] = True
                elif last_hit_at <= 0:
                    current["stale"] = True
                else:
                    age_ms = max(0, int((now - last_hit_at) * 1000))
                    current["stale"] = age_ms >= int(monitor.get("stale_after_ms", 1200))
            else:
                current["updated_at"] = now
                if last_hit_at <= 0:
                    current["stale"] = True

            current["_shared"] = merged_meta
            self._variables[variable_name] = current
            return deepcopy(current)

    def get_variable(self, variable_name: str) -> dict[str, Any] | None:
        with self._lock:
            value = self._variables.get(variable_name)
            return deepcopy(value) if value is not None else None

    def set_variable_state(
        self,
        variable_name: str,
        *,
        found: bool,
        message: str = "",
    ) -> None:
        with self._lock:
            current = self._variables.get(variable_name)
            if current is None:
                return
            current = deepcopy(current)
            current["found"] = found
            if not found:
                current["stale"] = True
            meta = dict(current.get("_shared", {}))
            meta["status"] = "hit" if found else "miss"
            if message:
                meta["message"] = message
            meta["updated_at"] = time.time()
            current["_shared"] = meta
            self._variables[variable_name] = current

    def get_all_snapshots(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            return {
                name: deepcopy(value)
                for name, value in self._variables.items()
            }

    def remove_variable(self, variable_name: str) -> None:
        with self._lock:
            self._variables.pop(variable_name, None)

    def clear(self) -> None:
        with self._lock:
            self._variables.clear()

    def rename_variable(self, old_name: str, new_name: str) -> None:
        if old_name == new_name:
            return
        with self._lock:
            value = self._variables.pop(old_name, None)
            if value is not None:
                self._variables[new_name] = value

    def _build_default_value(self, monitor: dict[str, Any]) -> dict[str, Any]:
        now = time.time()
        return {
            "found": False,
            "x": None,
            "y": None,
            "left": None,
            "top": None,
            "width": None,
            "height": None,
            "confidence": None,
            "score": None,
            "template_path": str(monitor.get("template_path", "")),
            "updated_at": now,
            "stale": True,
            "_shared": self._build_meta(monitor, {}, status="idle"),
        }

    def _build_meta(
        self,
        monitor: dict[str, Any],
        current: dict[str, Any] | None,
        *,
        status: str,
        message: str = "",
        runtime_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = dict(current or {})
        meta = dict(runtime_meta or {})
        payload.update(
            {
                "monitor_id": str(monitor.get("monitor_id", "")),
                "monitor_name": str(monitor.get("name", "")),
                "output_variable": str(monitor.get("output_variable", "")),
                "enabled": bool(monitor.get("enabled", True)),
                "status": status,
                "message": message,
                "updated_at": float(meta.get("updated_at", time.time())),
                "last_hit_at": meta.get("last_hit_at", payload.get("last_hit_at")),
                "miss_count": int(meta.get("miss_count", payload.get("miss_count", 0))),
                "active_scope": str(meta.get("active_scope", payload.get("active_scope", monitor.get("search_scope", "full_screen")))),
                "search_region": deepcopy(meta.get("search_region", payload.get("search_region"))),
            }
        )
        return payload
