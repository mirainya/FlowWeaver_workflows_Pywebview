from __future__ import annotations

from typing import Any

import numpy as np

from app.services.vision import SharedScreenCapture


class FeatureMatcher:
    """多点像素特征指纹匹配：在锚点周围采样多个像素点，比对颜色是否一致。"""

    def __init__(self, shared_capture: SharedScreenCapture | None = None) -> None:
        self._shared_capture = shared_capture

    def _grab_frame(self) -> np.ndarray:
        if self._shared_capture is not None:
            return self._shared_capture.grab()
        raise RuntimeError("FeatureMatcher 需要 SharedScreenCapture")

    def match(
        self,
        anchor_x: int,
        anchor_y: int,
        sample_points: list[dict[str, Any]],
        tolerance: int = 20,
    ) -> dict[str, Any]:
        """
        以 (anchor_x, anchor_y) 为锚点，检查每个采样点 (anchor_x+dx, anchor_y+dy) 的颜色
        是否与 expected_color 匹配（容差 tolerance）。
        返回: {"found": bool, "match_count": int, "total": int, "x": anchor_x, "y": anchor_y, "results": [...]}
        """
        frame = self._grab_frame()
        fh, fw = frame.shape[:2]
        results: list[dict[str, Any]] = []
        match_count = 0
        total = len(sample_points)

        for sp in sample_points:
            dx = int(sp.get("dx", 0))
            dy = int(sp.get("dy", 0))
            px, py = anchor_x + dx, anchor_y + dy
            expected = str(sp.get("expected_color", "")).strip().upper().lstrip("#")

            if not (0 <= px < fw and 0 <= py < fh):
                results.append({"dx": dx, "dy": dy, "matched": False, "reason": "out_of_bounds"})
                continue

            b, g, r = int(frame[py, px, 0]), int(frame[py, px, 1]), int(frame[py, px, 2])
            actual_hex = f"#{r:02X}{g:02X}{b:02X}"
            matched = False

            if len(expected) == 6:
                er, eg, eb = int(expected[0:2], 16), int(expected[2:4], 16), int(expected[4:6], 16)
                matched = abs(r - er) <= tolerance and abs(g - eg) <= tolerance and abs(b - eb) <= tolerance

            if matched:
                match_count += 1
            results.append({
                "dx": dx, "dy": dy,
                "actual_color": actual_hex, "r": r, "g": g, "b": b,
                "matched": matched,
            })

        found = match_count == total and total > 0
        return {
            "found": found,
            "x": anchor_x,
            "y": anchor_y,
            "match_count": match_count,
            "total": total,
            "results": results,
        }

    def capture_fingerprint(
        self,
        anchor_x: int,
        anchor_y: int,
        offsets: list[tuple[int, int]],
    ) -> list[dict[str, Any]]:
        """
        在锚点周围采样指定偏移位置的颜色，返回可直接用于 match() 的 sample_points。
        用于"录制"特征指纹。
        """
        frame = self._grab_frame()
        fh, fw = frame.shape[:2]
        sample_points: list[dict[str, Any]] = []

        for dx, dy in offsets:
            px, py = anchor_x + dx, anchor_y + dy
            if not (0 <= px < fw and 0 <= py < fh):
                continue
            b, g, r = int(frame[py, px, 0]), int(frame[py, px, 1]), int(frame[py, px, 2])
            sample_points.append({
                "dx": dx,
                "dy": dy,
                "expected_color": f"#{r:02X}{g:02X}{b:02X}",
            })

        return sample_points
