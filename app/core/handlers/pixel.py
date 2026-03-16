from __future__ import annotations

from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from threading import Event


class PixelHandlersMixin:
    """处理像素检测动作：check_pixels, check_region_color, detect_color_region, match_fingerprint"""

    def _handle_check_pixels(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        if self._pixel_checker is None:
            raise RuntimeError("PixelChecker 未初始化")
        points = list(params.get("points", []))
        logic = str(params.get("logic", "all")).strip()
        save_as = str(params.get("save_as", "pixel_result")).strip() or "pixel_result"
        result = self._pixel_checker.check_pixels(points, logic=logic)
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "check_pixels",
                "found": result["found"],
                "match_count": result["match_count"],
                "total": result["total"],
                "save_as": save_as,
            },
        )

        self._execute_visual_branch(workflow_id, params, result["found"], workflow_settings, context, stop_event)

    def _handle_check_region_color(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        if self._pixel_checker is None:
            raise RuntimeError("PixelChecker 未初始化")
        save_as = str(params.get("save_as", "region_color_result")).strip() or "region_color_result"
        result = self._pixel_checker.check_region_color(
            left=int(params.get("left", 0)),
            top=int(params.get("top", 0)),
            width=int(params.get("width", 100)),
            height=int(params.get("height", 100)),
            expected_color=str(params.get("expected_color", "")),
            tolerance=int(params.get("tolerance", 20)),
            min_ratio=float(params.get("min_ratio", 0.5)),
        )
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "check_region_color",
                "found": result["found"],
                "ratio": result["ratio"],
                "save_as": save_as,
            },
        )

        self._execute_visual_branch(workflow_id, params, result["found"], workflow_settings, context, stop_event)

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
        region = None
        rw, rh = int(params.get("region_width", 0)), int(params.get("region_height", 0))
        if rw > 0 and rh > 0:
            region = {
                "left": int(params.get("region_left", 0)),
                "top": int(params.get("region_top", 0)),
                "width": rw,
                "height": rh,
            }
        result = self._color_detector.detect(
            h_min=int(params.get("h_min", 0)),
            h_max=int(params.get("h_max", 179)),
            s_min=int(params.get("s_min", 50)),
            s_max=int(params.get("s_max", 255)),
            v_min=int(params.get("v_min", 50)),
            v_max=int(params.get("v_max", 255)),
            region=region,
            min_area=int(params.get("min_area", 100)),
        )
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "detect_color_region",
                "found": result["found"],
                "count": result.get("count", 0),
                "save_as": save_as,
            },
        )

        self._execute_visual_branch(workflow_id, params, result["found"], workflow_settings, context, stop_event)

    def _handle_match_fingerprint(
        self,
        workflow_id: str,
        params: dict[str, Any],
        workflow_settings: dict[str, Any],
        context: dict[str, Any],
        stop_event: Event | None = None,
    ) -> None:
        if stop_event is not None and stop_event.is_set():
            return
        if self._feature_matcher is None:
            raise RuntimeError("FeatureMatcher 未初始化")
        save_as = str(params.get("save_as", "fingerprint_result")).strip() or "fingerprint_result"
        result = self._feature_matcher.match(
            anchor_x=int(params.get("anchor_x", 0)),
            anchor_y=int(params.get("anchor_y", 0)),
            sample_points=list(params.get("sample_points", [])),
            tolerance=int(params.get("tolerance", 20)),
        )
        self._set_local_var(context, save_as, result)
        self._emit_runtime_event(
            workflow_id,
            {
                "type": "match_fingerprint",
                "found": result["found"],
                "match_count": result.get("match_count", 0),
                "total": result.get("total", 0),
                "save_as": save_as,
            },
        )

        self._execute_visual_branch(workflow_id, params, result["found"], workflow_settings, context, stop_event)
