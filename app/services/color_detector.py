from __future__ import annotations

from typing import Any

import numpy as np

try:
    import cv2
except ModuleNotFoundError:
    cv2 = None

from app.services.vision import SharedScreenCapture


class ColorRegionDetector:
    """HSV 颜色区域检测：在屏幕截图中查找指定 HSV 范围的连通区域。"""

    def __init__(self, shared_capture: SharedScreenCapture | None = None) -> None:
        self._shared_capture = shared_capture

    def _grab_frame(self) -> np.ndarray:
        if self._shared_capture is not None:
            return self._shared_capture.grab()
        raise RuntimeError("ColorRegionDetector 需要 SharedScreenCapture")

    def detect(
        self,
        h_min: int = 0,
        h_max: int = 179,
        s_min: int = 50,
        s_max: int = 255,
        v_min: int = 50,
        v_max: int = 255,
        region: dict[str, int] | None = None,
        min_area: int = 100,
    ) -> dict[str, Any]:
        """
        在屏幕截图中检测 HSV 范围内的颜色区域。
        返回最大连通区域的中心坐标和边界框，以及所有区域列表。
        """
        if cv2 is None:
            raise RuntimeError("OpenCV is required for color region detection.")

        frame = self._grab_frame()
        fh, fw = frame.shape[:2]

        # 裁剪搜索区域
        rl, rt, rw, rh = 0, 0, fw, fh
        if isinstance(region, dict):
            rl = max(0, min(int(region.get("left", 0)), fw - 1))
            rt = max(0, min(int(region.get("top", 0)), fh - 1))
            rw = max(1, min(int(region.get("width", fw)), fw - rl))
            rh = max(1, min(int(region.get("height", fh)), fh - rt))
        roi = frame[rt:rt + rh, rl:rl + rw]

        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        lower = np.array([h_min, s_min, v_min], dtype=np.uint8)
        upper = np.array([h_max, s_max, v_max], dtype=np.uint8)
        mask = cv2.inRange(hsv, lower, upper)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        regions: list[dict[str, Any]] = []
        for cnt in contours:
            area = int(cv2.contourArea(cnt))
            if area < min_area:
                continue
            bx, by, bw, bh = cv2.boundingRect(cnt)
            cx = rl + bx + bw // 2
            cy = rt + by + bh // 2
            regions.append({
                "x": cx,
                "y": cy,
                "left": rl + bx,
                "top": rt + by,
                "width": bw,
                "height": bh,
                "area": area,
            })

        regions.sort(key=lambda r: r["area"], reverse=True)

        if not regions:
            return {
                "found": False,
                "x": 0,
                "y": 0,
                "count": 0,
                "regions": [],
            }

        best = regions[0]
        return {
            "found": True,
            "x": best["x"],
            "y": best["y"],
            "left": best["left"],
            "top": best["top"],
            "width": best["width"],
            "height": best["height"],
            "area": best["area"],
            "count": len(regions),
            "regions": regions[:20],
        }
