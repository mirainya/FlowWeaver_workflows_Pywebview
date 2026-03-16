from __future__ import annotations

import time
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from threading import Event


class MouseHandlersMixin:
    """处理鼠标动作：click_point, mouse_scroll, mouse_hold, mouse_drag, mouse_move"""

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

        if source == "current":
            pos = self._input.get_cursor_position()
            x, y = pos[0], pos[1]
        elif source == "absolute":
            x = int(params.get("x", 0))
            y = int(params.get("y", 0))
        else:
            variable_scope = "shared" if source == "shared" else "local"
            var_name = str(params.get("var_name", "target")).strip() or "target"
            match = self._resolve_variable(variable_scope, var_name, context)
            if not match or not match.get("found"):
                raise RuntimeError(f"变量 {var_name} 未命中或不存在，无法点击。")
            x = int(match.get("x", 0))
            y = int(match.get("y", 0))

        offset_x = int(params.get("offset_x", 0))
        offset_y = int(params.get("offset_y", 0))
        final_x = x + offset_x
        final_y = y + offset_y
        button = "right" if str(params.get("button", "left")).strip() == "right" else "left"
        return_cursor = bool(params.get("return_cursor", True))
        settle_ms = max(0, int(params.get("settle_ms", 60)))
        click_count = max(1, min(5, int(params.get("click_count", 1))))
        modifiers = list(params.get("modifiers", []))

        saved_pos = self._input.get_cursor_position() if return_cursor else None

        if modifiers:
            modifier_delay_ms = max(0, int(params.get("modifier_delay_ms", 50)))
            for mod in modifiers:
                if mod in {"ctrl", "shift", "alt"}:
                    self._input.press_key(mod)
            if modifier_delay_ms > 0:
                time.sleep(modifier_delay_ms / 1000)

        try:
            self._input.move_to(final_x, final_y)
            if settle_ms > 0:
                time.sleep(settle_ms / 1000)
            for _ in range(click_count):
                self._input.click(button=button)
        finally:
            if modifiers:
                for mod in reversed(modifiers):
                    if mod in {"ctrl", "shift", "alt"}:
                        self._input.release_key(mod)

        self._emit_runtime_event(
            workflow_id,
            {
                "type": "click",
                "x": final_x,
                "y": final_y,
                "button": button,
                "source": source,
                "click_count": click_count,
            },
        )

        if saved_pos is not None:
            time.sleep(0.05)
            self._input.move_to(saved_pos[0], saved_pos[1])

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
        source = str(params.get("source", "var")).strip()
        button = "right" if str(params.get("button", "left")).strip() == "right" else "left"
        duration_ms = max(0, int(params.get("duration_ms", 500)))

        if source == "absolute":
            x = int(params.get("x", 0))
            y = int(params.get("y", 0))
        elif source == "current":
            pos = self._input.get_cursor_position()
            x, y = pos[0], pos[1]
        else:
            variable_scope = "shared" if source == "shared" else "local"
            var_name = str(params.get("var_name", "target")).strip() or "target"
            match = self._resolve_variable(variable_scope, var_name, context)
            if not match or not match.get("found"):
                raise RuntimeError(f"变量 {var_name} 未命中或不存在，无法按住鼠标。")
            x = int(match.get("x", 0))
            y = int(match.get("y", 0))

        offset_x = int(params.get("offset_x", 0))
        offset_y = int(params.get("offset_y", 0))
        final_x = x + offset_x
        final_y = y + offset_y

        self._input.move_to(final_x, final_y)
        time.sleep(0.03)
        self._input.mouse_down(button=button)
        self._emit_runtime_event(workflow_id, {"type": "mouse_hold", "action": "down", "x": final_x, "y": final_y, "button": button})
        try:
            self._wait_delay(duration_ms, stop_event)
        finally:
            self._input.mouse_up(button=button)
            self._emit_runtime_event(workflow_id, {"type": "mouse_hold", "action": "up", "x": final_x, "y": final_y, "button": button})

    def _handle_mouse_drag(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        source = str(params.get("source", "absolute")).strip()
        button = "right" if str(params.get("button", "left")).strip() == "right" else "left"
        duration_ms = max(0, int(params.get("duration_ms", 300)))

        if source == "current":
            pos = self._input.get_cursor_position()
            start_x, start_y = pos[0], pos[1]
        elif source in {"var", "shared"}:
            variable_scope = "shared" if source == "shared" else "local"
            var_name = str(params.get("var_name", "target")).strip() or "target"
            match = self._resolve_variable(variable_scope, var_name, context)
            if not match or not match.get("found"):
                raise RuntimeError(f"变量 {var_name} 未命中或不存在，无法拖拽。")
            start_x = int(match.get("x", 0))
            start_y = int(match.get("y", 0))
        else:
            start_x = int(params.get("start_x", 0))
            start_y = int(params.get("start_y", 0))

        end_x = int(params.get("end_x", start_x))
        end_y = int(params.get("end_y", start_y))
        steps = max(1, int(params.get("steps", 20)))

        self._input.move_to(start_x, start_y)
        time.sleep(0.03)
        self._input.mouse_down(button=button)
        self._emit_runtime_event(workflow_id, {"type": "mouse_drag", "action": "start", "x": start_x, "y": start_y})
        try:
            step_delay = (duration_ms / 1000) / steps if steps > 0 else 0
            for i in range(1, steps + 1):
                if stop_event is not None and stop_event.is_set():
                    break
                ratio = i / steps
                cx = int(start_x + (end_x - start_x) * ratio)
                cy = int(start_y + (end_y - start_y) * ratio)
                self._input.move_to(cx, cy)
                if step_delay > 0:
                    time.sleep(step_delay)
        finally:
            self._input.mouse_up(button=button)
            self._emit_runtime_event(workflow_id, {"type": "mouse_drag", "action": "end", "x": end_x, "y": end_y})

    def _handle_mouse_move(
        self,
        workflow_id: str,
        params: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        source = str(params.get("source", "absolute")).strip()

        if source in {"var", "shared"}:
            variable_scope = "shared" if source == "shared" else "local"
            var_name = str(params.get("var_name", "target")).strip() or "target"
            match = self._resolve_variable(variable_scope, var_name, context)
            if not match or not match.get("found"):
                raise RuntimeError(f"变量 {var_name} 未命中或不存在，无法移动鼠标。")
            x = int(match.get("x", 0))
            y = int(match.get("y", 0))
        else:
            x = int(params.get("x", 0))
            y = int(params.get("y", 0))

        offset_x = int(params.get("offset_x", 0))
        offset_y = int(params.get("offset_y", 0))
        final_x = x + offset_x
        final_y = y + offset_y

        self._input.move_to(final_x, final_y)
        self._emit_runtime_event(
            workflow_id,
            {"type": "mouse_move", "x": final_x, "y": final_y, "source": source},
        )
