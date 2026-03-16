from __future__ import annotations

import time
from pathlib import Path
from threading import Event as _Event, Thread
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from threading import Event


class VisionHandlersMixin:
    """处理视觉检测动作：detect_image, detect_click_return, detect_color, detect_color_region"""

    def _handle_detect_image(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        raw_template_path = str(params.get("template_path", "")).strip()
        if not raw_template_path:
            raise ValueError("识图动作缺少 template_path 参数")

        template_path = self._resolve_template_path(raw_template_path)
        if not template_path.exists():
            raise FileNotFoundError(f"模板图片不存在：{template_path}")
        confidence = float(params.get("confidence", 0.88))
        raw_timeout = self._resolve_delay_ms(params, workflow_settings, field="timeout_ms")
        if raw_timeout <= 0:
            self._logger("timeout_ms 值无效，使用默认 2500ms", "warn")
            raw_timeout = 2500
        timeout_ms = raw_timeout
        search_step = max(1, int(params.get("search_step", 4)))
        save_as = str(params.get("save_as", "target")).strip() or "target"

        raw_search_region = params.get("search_region")
        search_region: dict[str, int] | None = None
        if isinstance(raw_search_region, dict):
            try:
                search_region = {
                    "left": int(raw_search_region.get("left", 0)),
                    "top": int(raw_search_region.get("top", 0)),
                    "width": int(raw_search_region.get("width", 0)),
                    "height": int(raw_search_region.get("height", 0)),
                }
                if search_region["width"] <= 0 or search_region["height"] <= 0:
                    search_region = None
            except (TypeError, ValueError):
                search_region = None

        match = self._vision.locate_on_screen_details(
            template_path=template_path,
            confidence=confidence,
            timeout_ms=timeout_ms,
            search_step=search_step,
            search_region=search_region,
            stop_event=stop_event,
        )
        result = match or self._build_miss_match(template_path, confidence)
        stored_result = self._set_local_var(context, save_as, result)

        self._emit_runtime_event(
            workflow_id,
            {
                "type": "match",
                "var_name": save_as,
                "found": bool(stored_result.get("found")),
                "x": stored_result.get("x"),
                "y": stored_result.get("y"),
                "template_path": stored_result.get("template_path"),
            },
        )

        found = bool(stored_result.get("found"))
        if found:
            self._logger(
                f"识图命中：{template_path.name}，保存到变量 {save_as} ({stored_result.get('x')}, {stored_result.get('y')})",
                "success",
            )
        else:
            self._logger(f"识图未命中：{template_path.name}，变量 {save_as}", "warn")

        self._execute_visual_branch(workflow_id, params, found, workflow_settings, context, stop_event)

    def _handle_detect_click_return(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        detect_params = dict(params)
        save_as = str(detect_params.get("save_as", "target")).strip() or "target"
        detect_params["save_as"] = save_as
        self._handle_detect_image(workflow_id, detect_params, workflow_settings, context, stop_event)
        if stop_event is not None and stop_event.is_set():
            return
        match = self._snapshot_local_var(context, save_as)
        if not match or not match.get("found"):
            raise RuntimeError(f"识图失败：{Path(str(detect_params.get('template_path', 'unknown'))).name}")
        self._handle_click_point(
            workflow_id,
            {
                "source": "var",
                "var_name": save_as,
                "button": params.get("button", "left"),
                "return_cursor": True,
                "offset_x": 0,
                "offset_y": 0,
                "settle_ms": params.get("settle_ms", 60),
            },
            context,
            stop_event,
        )

    def _handle_detect_color(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return

        source = str(params.get("source", "absolute")).strip()
        if source == "var":
            var_name = str(params.get("var_name", "target")).strip() or "target"
            variable_scope = str(params.get("variable_scope", "local")).strip()
            match = self._resolve_variable(variable_scope, var_name, context)
            if not match or not match.get("found"):
                raise RuntimeError(f"变量 {var_name} 未命中或不存在，无法取色。")
            x = int(match.get("x", 0))
            y = int(match.get("y", 0))
        elif source == "current":
            pos = self._input.get_cursor_position()
            x, y = pos[0], pos[1]
        else:
            x = int(params.get("x", 0))
            y = int(params.get("y", 0))

        offset_x = int(params.get("offset_x", 0))
        offset_y = int(params.get("offset_y", 0))
        x += offset_x
        y += offset_y

        save_as = str(params.get("save_as", "color_result")).strip() or "color_result"
        expected_color = str(params.get("expected_color", "")).strip()
        tolerance = max(0, int(params.get("tolerance", 20)))

        if self._pixel_checker is None:
            raise RuntimeError("PixelChecker 未初始化")
        r, g, b = self._pixel_checker.get_pixel_color(x, y)
        hex_color = f"#{r:02x}{g:02x}{b:02x}"

        matched = False
        if expected_color:
            ec = expected_color.lstrip("#")
            if len(ec) == 6:
                er, eg, eb = int(ec[0:2], 16), int(ec[2:4], 16), int(ec[4:6], 16)
                matched = abs(r - er) <= tolerance and abs(g - eg) <= tolerance and abs(b - eb) <= tolerance

        payload = {
            "found": matched,
            "x": x,
            "y": y,
            "color": hex_color,
            "r": r,
            "g": g,
            "b": b,
            "expected_color": expected_color,
            "tolerance": tolerance,
        }
        self._set_local_var(context, save_as, payload)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "detect_color",
                "x": x,
                "y": y,
                "color": hex_color,
                "matched": matched,
                "save_as": save_as,
            },
        )

        self._execute_visual_branch(workflow_id, params, matched, workflow_settings, context, stop_event)

    def _handle_detect_color_region(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        if self._color_detector is None:
            raise RuntimeError("ColorRegionDetector 未初始化")
        save_as = str(params.get("save_as", "color_region_result")).strip() or "color_region_result"
        result = self._color_detector.detect(
            target_color=str(params.get("target_color", "#ff0000")),
            region={
                "left": int(params.get("region_left", 0)),
                "top": int(params.get("region_top", 0)),
                "width": int(params.get("region_width", 100)),
                "height": int(params.get("region_height", 100)),
            },
            tolerance=int(params.get("tolerance", 30)),
            min_area=int(params.get("min_area", 10)),
        )
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "detect_color_region",
                "found": result["found"],
                "x": result.get("x"),
                "y": result.get("y"),
                "count": result.get("count", 0),
                "save_as": save_as,
            },
        )

        self._execute_visual_branch(workflow_id, params, result["found"], workflow_settings, context, stop_event)

    def _handle_async_detect(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        """后台识图步骤：在单独线程中循环模板匹配，主线程等待结果或超时。"""
        raw_template_path = str(params.get("template_path", "")).strip()
        if not raw_template_path:
            raise ValueError("后台识图缺少 template_path 参数")

        template_path = self._resolve_template_path(raw_template_path)
        if not template_path.exists():
            raise FileNotFoundError(f"模板图片不存在：{template_path}")

        # Match mode → confidence
        match_mode = str(params.get("match_mode", "normal")).strip()
        mode_confidence_map = {"loose": 0.82, "normal": 0.88, "strict": 0.94}
        if match_mode == "custom":
            confidence = float(params.get("confidence", 0.88))
        else:
            confidence = mode_confidence_map.get(match_mode, 0.88)

        # Scan rate → interval
        scan_rate = str(params.get("scan_rate", "normal")).strip()
        rate_interval_map = {"low": 900, "normal": 350, "high": 150, "ultra": 30}
        if scan_rate == "custom":
            interval_ms = max(10, int(params.get("custom_interval_ms", 350)))
        else:
            interval_ms = rate_interval_map.get(scan_rate, 350)

        timeout_ms = self._resolve_delay_ms(params, workflow_settings, field="timeout_ms")
        if timeout_ms <= 0:
            timeout_ms = 5000
        save_as = str(params.get("save_as", "async_target")).strip() or "async_target"
        search_step = max(1, int(params.get("search_step", 4)))
        not_found_action = str(params.get("not_found_action", "mark_missing")).strip()

        # Search region
        search_region: dict[str, int] | None = None
        search_scope = str(params.get("search_scope", "full_screen")).strip()
        if search_scope == "fixed_region":
            raw_search_region = params.get("search_region")
            if isinstance(raw_search_region, dict):
                try:
                    search_region = {
                        "left": int(raw_search_region.get("left", 0)),
                        "top": int(raw_search_region.get("top", 0)),
                        "width": int(raw_search_region.get("width", 0)),
                        "height": int(raw_search_region.get("height", 0)),
                    }
                    if search_region["width"] <= 0 or search_region["height"] <= 0:
                        search_region = None
                except (TypeError, ValueError):
                    search_region = None

        self._emit_runtime_event(workflow_id, {
            "type": "async_detect_start",
            "template_path": str(template_path),
            "timeout_ms": timeout_ms,
            "scan_rate": scan_rate,
            "match_mode": match_mode,
            "confidence": confidence,
            "save_as": save_as,
        })
        self._logger(
            f"后台识图启动：{template_path.name}，超时 {timeout_ms}ms，"
            f"速度 {scan_rate}({interval_ms}ms)，精度 {match_mode}({confidence:.2f})",
            "info",
        )

        # Result container shared between threads
        result_holder: dict[str, Any] = {"result": None}
        detect_stop = _Event()

        def _detect_loop() -> None:
            while not detect_stop.is_set():
                if stop_event is not None and stop_event.is_set():
                    break
                match = self._vision.locate_on_screen_details(
                    template_path=template_path,
                    confidence=confidence,
                    timeout_ms=min(interval_ms, 500),
                    search_step=search_step,
                    search_region=search_region,
                    stop_event=detect_stop,
                )
                if match and match.get("found"):
                    result_holder["result"] = match
                    return
                wait_s = max(0, (interval_ms - 50)) / 1000
                if detect_stop.wait(wait_s):
                    break

        worker = Thread(target=_detect_loop, daemon=True)
        worker.start()

        # Wait for result or timeout
        deadline = time.monotonic() + timeout_ms / 1000
        while worker.is_alive() and time.monotonic() < deadline:
            if stop_event is not None and stop_event.is_set():
                detect_stop.set()
                worker.join(timeout=1.0)
                break
            worker.join(timeout=0.1)

        detect_stop.set()
        worker.join(timeout=1.0)

        # Handle result based on not_found_action
        if result_holder["result"]:
            result = result_holder["result"]
        elif not_found_action == "keep_last":
            existing = self._snapshot_local_var(context, save_as)
            result = existing if existing else self._build_miss_match(template_path, confidence)
        else:
            result = self._build_miss_match(template_path, confidence)

        stored_result = self._set_local_var(context, save_as, result)
        found = bool(stored_result.get("found"))

        self._emit_runtime_event(workflow_id, {
            "type": "async_detect_end",
            "var_name": save_as,
            "found": found,
            "x": stored_result.get("x"),
            "y": stored_result.get("y"),
            "template_path": str(template_path),
        })

        if found:
            self._logger(
                f"后台识图命中：{template_path.name}，保存到变量 {save_as} ({stored_result.get('x')}, {stored_result.get('y')})",
                "success",
            )
        else:
            self._logger(f"后台识图超时未命中：{template_path.name}，变量 {save_as}", "warn")

        self._execute_visual_branch(workflow_id, params, found, workflow_settings, context, stop_event)
