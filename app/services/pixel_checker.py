from __future__ import annotations

from typing import Any

import numpy as np

from app.services.vision import SharedScreenCapture


class PixelChecker:
    """多点像素检测 & 区域颜色占比 & 取色器。"""

    def __init__(self, shared_capture: SharedScreenCapture | None = None) -> None:
        self._shared_capture = shared_capture

    def _grab_frame(self) -> np.ndarray:
        if self._shared_capture is not None:
            return self._shared_capture.grab()
        raise RuntimeError("PixelChecker 需要 SharedScreenCapture")

    # ── 取色器 ──────────────────────────────────────────────
    def pick_color(self, x: int, y: int) -> dict[str, Any]:
        frame = self._grab_frame()
        h, w = frame.shape[:2]
        if not (0 <= x < w and 0 <= y < h):
            raise RuntimeError(f"坐标 ({x}, {y}) 超出屏幕范围 ({w}x{h})")
        b, g, r = int(frame[y, x, 0]), int(frame[y, x, 1]), int(frame[y, x, 2])
        return {"r": r, "g": g, "b": b, "hex": f"#{r:02X}{g:02X}{b:02X}", "x": x, "y": y}

    # ── 多点像素检测 ────────────────────────────────────────
    def check_pixels(
        self,
        points: list[dict[str, Any]],
        logic: str = "all",
    ) -> dict[str, Any]:
        """
        points: [{"x": int, "y": int, "expected_color": "#RRGGBB", "tolerance": int}, ...]
        logic: "all" | "any" — 全部匹配 or 任一匹配
        返回: {"found": bool, "results": [...], "match_count": int, "total": int}
        """
        frame = self._grab_frame()
        fh, fw = frame.shape[:2]
        results: list[dict[str, Any]] = []
        match_count = 0

        for pt in points:
            px, py = int(pt.get("x", 0)), int(pt.get("y", 0))
            expected = str(pt.get("expected_color", "")).strip().upper().lstrip("#")
            tolerance = max(0, int(pt.get("tolerance", 20)))

            if not (0 <= px < fw and 0 <= py < fh):
                results.append({"x": px, "y": py, "matched": False, "reason": "out_of_bounds"})
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
                "x": px, "y": py,
                "actual_color": actual_hex, "r": r, "g": g, "b": b,
                "matched": matched,
            })

        total = len(points)
        if logic == "any":
            found = match_count > 0
        else:
            found = match_count == total and total > 0

        return {"found": found, "results": results, "match_count": match_count, "total": total}

    # ── 区域颜色占比 ───────────────────────────────────────
    def check_region_color(
        self,
        left: int,
        top: int,
        width: int,
        height: int,
        expected_color: str,
        tolerance: int = 20,
        min_ratio: float = 0.5,
    ) -> dict[str, Any]:
        """
        检测指定矩形区域内某颜色的像素占比是否达到阈值。
        返回: {"found": bool, "ratio": float, "pixel_count": int, "total_pixels": int}
        """
        frame = self._grab_frame()
        fh, fw = frame.shape[:2]
        left = max(0, min(left, fw - 1))
        top = max(0, min(top, fh - 1))
        right = min(fw, left + max(1, width))
        bottom = min(fh, top + max(1, height))
        region = frame[top:bottom, left:right]

        ec = expected_color.strip().upper().lstrip("#")
        if len(ec) != 6:
            return {"found": False, "ratio": 0.0, "pixel_count": 0, "total_pixels": 0, "reason": "invalid_color"}

        er, eg, eb = int(ec[0:2], 16), int(ec[2:4], 16), int(ec[4:6], 16)
        b_ch, g_ch, r_ch = region[:, :, 0], region[:, :, 1], region[:, :, 2]
        mask = (
            (np.abs(r_ch.astype(np.int16) - er) <= tolerance)
            & (np.abs(g_ch.astype(np.int16) - eg) <= tolerance)
            & (np.abs(b_ch.astype(np.int16) - eb) <= tolerance)
        )
        pixel_count = int(np.count_nonzero(mask))
        total_pixels = region.shape[0] * region.shape[1]
        ratio = pixel_count / total_pixels if total_pixels > 0 else 0.0

        return {
            "found": ratio >= min_ratio,
            "ratio": round(ratio, 4),
            "pixel_count": pixel_count,
            "total_pixels": total_pixels,
        }
