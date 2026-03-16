from __future__ import annotations

import logging
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any

import numpy as np
from mss import mss

try:
    import cv2
except ModuleNotFoundError:
    cv2 = None

_logger = logging.getLogger(__name__)
_IS_WINDOWS = sys.platform == "win32"


@dataclass(slots=True)
class LoadedTemplate:
    image: np.ndarray
    mask: np.ndarray | None
    width: int
    height: int
    mtime_ns: int


class SharedScreenCapture:
    """独立线程持续截屏，所有消费者共享最新帧，避免跨线程 GDI 调用导致屏幕闪烁。"""

    _MIN_FPS = 5
    _MAX_FPS = 30
    _DEFAULT_FPS = 15

    def __init__(self, monitor_index: int = 1) -> None:
        self._monitor_index = monitor_index
        self._lock = Lock()
        self._frame: np.ndarray | None = None
        self._frame_time: float = 0.0
        self._last_demand: float = 0.0
        self._target_fps: float = self._DEFAULT_FPS
        self._stop = Event()
        self._ready = Event()
        self._thread = Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def set_target_fps(self, fps: float) -> None:
        self._target_fps = max(self._MIN_FPS, min(self._MAX_FPS, fps))

    def _capture_loop(self) -> None:
        sct = mss()
        try:
            while not self._stop.is_set():
                if time.monotonic() - self._last_demand > 2.0:
                    self._stop.wait(0.2)
                    continue
                interval = 1.0 / self._target_fps
                start = time.monotonic()
                try:
                    monitor_count = len(sct.monitors)
                    index = self._monitor_index if 0 < self._monitor_index < monitor_count else 1
                    raw = sct.grab(sct.monitors[index])
                    frame = np.ascontiguousarray(np.array(raw, dtype=np.uint8)[:, :, :3])
                    with self._lock:
                        self._frame = frame
                        self._frame_time = time.monotonic()
                    self._ready.set()
                except Exception as exc:
                    _logger.warning("截屏失败: %s", exc)
                elapsed = time.monotonic() - start
                remaining = max(0.0, interval - elapsed)
                if remaining > 0:
                    self._stop.wait(remaining)
        finally:
            try:
                sct.close()
            except Exception:
                pass

    def grab(self) -> np.ndarray:
        self._last_demand = time.monotonic()
        with self._lock:
            if self._frame is not None:
                return self._frame
        self._ready.wait(timeout=3.0)
        with self._lock:
            if self._frame is not None:
                return self._frame
        raise RuntimeError("屏幕截图不可用")

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=1.5)


class TemplateMatcher:
    def __init__(self, shared_capture: SharedScreenCapture | None = None) -> None:
        self._shared_capture = shared_capture
        self._own_capture = shared_capture is None
        self._screen_capture = mss() if self._own_capture else None
        self._template_cache: dict[str, LoadedTemplate] = {}

    def close(self) -> None:
        if self._own_capture and self._screen_capture is not None:
            try:
                self._screen_capture.close()
            except Exception:
                pass

    def get_latest_frame(self) -> np.ndarray | None:
        """获取最新一帧屏幕截图（BGR格式），供取色等功能使用。"""
        try:
            return self._capture_primary_screen()
        except Exception:
            return None

    def locate_on_screen(
        self,
        template_path: Path,
        confidence: float = 0.88,
        timeout_ms: int = 2500,
        search_step: int = 4,
        search_region: dict[str, int] | None = None,
        capture_once: bool = False,
        stop_event: Event | None = None,
    ) -> tuple[int, int] | None:
        details = self.locate_on_screen_details(
            template_path=template_path,
            confidence=confidence,
            timeout_ms=timeout_ms,
            search_step=search_step,
            search_region=search_region,
            capture_once=capture_once,
            stop_event=stop_event,
        )
        if details is None:
            return None
        return (int(details["x"]), int(details["y"]))

    def locate_on_screen_details(
        self,
        template_path: Path,
        confidence: float = 0.88,
        timeout_ms: int = 2500,
        search_step: int = 4,
        search_region: dict[str, int] | None = None,
        capture_once: bool = False,
        stop_event: Event | None = None,
    ) -> dict[str, Any] | None:
        self._ensure_opencv_available()
        if not template_path.exists():
            raise FileNotFoundError(f"Template file not found: {template_path}")

        loaded_template = self._load_template(template_path)
        threshold = max(min(float(confidence), 0.999), 0.55)
        deadline = time.monotonic() + max(100, int(timeout_ms)) / 1000
        poll_interval = 0.04 if search_step <= 2 else 0.06 if search_step <= 4 else 0.09

        while True:
            if stop_event is not None and stop_event.is_set():
                return None
            screen_image = self._capture_primary_screen()
            normalized_region = self._normalize_search_region(search_region, screen_image.shape[1], screen_image.shape[0])
            region_left = int(normalized_region["left"]) if normalized_region is not None else 0
            region_top = int(normalized_region["top"]) if normalized_region is not None else 0
            region_width = int(normalized_region["width"]) if normalized_region is not None else int(screen_image.shape[1])
            region_height = int(normalized_region["height"]) if normalized_region is not None else int(screen_image.shape[0])
            region_image = screen_image[
                region_top:region_top + region_height,
                region_left:region_left + region_width,
            ]

            if loaded_template.width > region_image.shape[1] or loaded_template.height > region_image.shape[0]:
                return None

            prepared_screen = self._prepare_screen(region_image)
            score, left, top = self._match_template(prepared_screen, loaded_template)
            if score >= threshold:
                return {
                    "found": True,
                    "left": int(region_left + left),
                    "top": int(region_top + top),
                    "width": loaded_template.width,
                    "height": loaded_template.height,
                    "x": int(region_left + left + loaded_template.width // 2),
                    "y": int(region_top + top + loaded_template.height // 2),
                    "confidence": float(score),
                    "template_path": str(template_path),
                    "search_region": normalized_region,
                }

            if capture_once:
                return None
            if time.monotonic() >= deadline:
                break
            if stop_event is not None:
                if stop_event.wait(poll_interval):
                    return None
            else:
                time.sleep(poll_interval)
        return None

    def _ensure_opencv_available(self) -> None:
        if cv2 is None:
            raise RuntimeError(
                "OpenCV is required. Run `pip install -r requirements.txt` or install `opencv-python`."
            )

    def _capture_primary_screen(self) -> np.ndarray:
        if self._shared_capture is not None:
            return self._shared_capture.grab()
        monitor = self._screen_capture.monitors[1]
        raw_screen = self._screen_capture.grab(monitor)
        screen_bgra = np.array(raw_screen, dtype=np.uint8)
        return np.ascontiguousarray(screen_bgra[:, :, :3])

    def _normalize_cache_key(self, path: Path) -> str:
        resolved = str(path.resolve())
        return resolved.lower() if _IS_WINDOWS else resolved

    def _load_template(self, template_path: Path) -> LoadedTemplate:
        cache_key = self._normalize_cache_key(template_path)
        cached_template = self._template_cache.get(cache_key)
        # 有缓存时跳过 stat()，通过 mtime_ns=-1 标记强制刷新
        if cached_template is not None and cached_template.mtime_ns >= 0:
            return cached_template
        template_mtime = template_path.stat().st_mtime_ns
        if cached_template is not None and cached_template.mtime_ns == template_mtime:
            return cached_template

        file_buffer = np.fromfile(str(template_path), dtype=np.uint8)
        decoded_template = cv2.imdecode(file_buffer, cv2.IMREAD_UNCHANGED)
        if decoded_template is None:
            raise ValueError(f"Unable to read template image: {template_path}")

        template_mask: np.ndarray | None = None
        if decoded_template.ndim == 2:
            processed_template = decoded_template
        elif decoded_template.ndim == 3 and decoded_template.shape[2] == 4:
            alpha_channel = decoded_template[:, :, 3]
            if not np.any(alpha_channel > 0):
                raise ValueError(f"Template alpha channel is invalid: {template_path}")
            processed_template = cv2.cvtColor(decoded_template[:, :, :3], cv2.COLOR_BGR2GRAY)
            if np.any(alpha_channel < 255):
                template_mask = alpha_channel
        elif decoded_template.ndim == 3 and decoded_template.shape[2] == 3:
            processed_template = cv2.cvtColor(decoded_template, cv2.COLOR_BGR2GRAY)
        else:
            raise ValueError(f"Unsupported template image format: {template_path}")

        template_height, template_width = processed_template.shape[:2]
        if template_width < 1 or template_height < 1:
            raise ValueError(f"Template image size is invalid: {template_path}")

        loaded_template = LoadedTemplate(
            image=np.ascontiguousarray(processed_template),
            mask=np.ascontiguousarray(template_mask) if template_mask is not None else None,
            width=int(template_width),
            height=int(template_height),
            mtime_ns=int(template_mtime),
        )
        self._template_cache[cache_key] = loaded_template
        return loaded_template

    def invalidate_template_cache(self) -> None:
        """将所有缓存标记为需要重新检查 mtime（下次 _load_template 时触发 stat）。"""
        for key, cached in self._template_cache.items():
            self._template_cache[key] = LoadedTemplate(
                image=cached.image,
                mask=cached.mask,
                width=cached.width,
                height=cached.height,
                mtime_ns=-1,
            )

    def _prepare_screen(self, screen_image: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(screen_image, cv2.COLOR_BGR2GRAY)

    def _normalize_search_region(
        self,
        raw_region: dict[str, int] | None,
        screen_width: int,
        screen_height: int,
    ) -> dict[str, int] | None:
        if not isinstance(raw_region, dict):
            return None

        try:
            left = int(raw_region.get("left", 0))
            top = int(raw_region.get("top", 0))
            width = int(raw_region.get("width", 0))
            height = int(raw_region.get("height", 0))
        except (TypeError, ValueError):
            return None

        if width <= 0 or height <= 0:
            return None

        left = max(0, min(left, max(0, screen_width - 1)))
        top = max(0, min(top, max(0, screen_height - 1)))
        width = max(1, min(width, screen_width - left))
        height = max(1, min(height, screen_height - top))
        return {
            "left": int(left),
            "top": int(top),
            "width": int(width),
            "height": int(height),
        }

    def _resolve_cv_method(self, method_name: str) -> int:
        _METHOD_MAP = {
            "ccorr_normed": cv2.TM_CCORR_NORMED,
            "ccoeff_normed": cv2.TM_CCOEFF_NORMED,
            "sqdiff_normed": cv2.TM_SQDIFF_NORMED,
        }
        return _METHOD_MAP.get(method_name, cv2.TM_CCORR_NORMED)

    def _match_template(
        self,
        screen_image: np.ndarray,
        loaded_template: LoadedTemplate,
        match_method: str = "ccorr_normed",
    ) -> tuple[float, int, int]:
        cv_method = self._resolve_cv_method(match_method)
        result_map = cv2.matchTemplate(
            screen_image,
            loaded_template.image,
            cv_method,
            mask=loaded_template.mask if cv_method != cv2.TM_CCOEFF_NORMED else None,
        )
        if cv_method == cv2.TM_SQDIFF_NORMED:
            min_val, _, min_loc, _ = cv2.minMaxLoc(result_map)
            return float(1.0 - min_val), int(min_loc[0]), int(min_loc[1])
        _, max_score, _, max_location = cv2.minMaxLoc(result_map)
        return float(max_score), int(max_location[0]), int(max_location[1])

    def locate_all_on_screen(
        self,
        template_path: Path,
        confidence: float = 0.88,
        search_region: dict[str, int] | None = None,
        max_results: int = 20,
        nms_overlap: float = 0.3,
        match_method: str = "ccorr_normed",
    ) -> list[dict[str, Any]]:
        """单帧多目标匹配，返回所有满足阈值的匹配结果列表（已做 NMS 去重）。"""
        self._ensure_opencv_available()
        if not template_path.exists():
            raise FileNotFoundError(f"Template file not found: {template_path}")

        loaded = self._load_template(template_path)
        threshold = max(min(float(confidence), 0.999), 0.55)
        screen = self._capture_primary_screen()
        h, w = screen.shape[:2]
        norm_region = self._normalize_search_region(search_region, w, h)

        region_left = int(norm_region["left"]) if norm_region else 0
        region_top = int(norm_region["top"]) if norm_region else 0
        region_w = int(norm_region["width"]) if norm_region else w
        region_h = int(norm_region["height"]) if norm_region else h
        region_img = screen[region_top:region_top + region_h, region_left:region_left + region_w]

        if loaded.width > region_img.shape[1] or loaded.height > region_img.shape[0]:
            return []

        prepared = self._prepare_screen(region_img)
        cv_method = self._resolve_cv_method(match_method)
        result_map = cv2.matchTemplate(
            prepared,
            loaded.image,
            cv_method,
            mask=loaded.mask if cv_method != cv2.TM_CCOEFF_NORMED else None,
        )

        if cv_method == cv2.TM_SQDIFF_NORMED:
            score_map = 1.0 - result_map
        else:
            score_map = result_map

        locations = np.where(score_map >= threshold)
        if len(locations[0]) == 0:
            return []

        scores = score_map[locations[0], locations[1]]
        tw, th = loaded.width, loaded.height
        boxes = np.array([
            [int(x), int(y), int(x + tw), int(y + th)]
            for y, x in zip(locations[0], locations[1])
        ])

        # NMS 去重
        keep = self._nms(boxes, scores, nms_overlap)
        results = []
        for idx in keep[:max_results]:
            bx, by = int(boxes[idx][0]), int(boxes[idx][1])
            results.append({
                "found": True,
                "left": region_left + bx,
                "top": region_top + by,
                "width": tw,
                "height": th,
                "x": region_left + bx + tw // 2,
                "y": region_top + by + th // 2,
                "confidence": float(scores[idx]),
                "template_path": str(template_path),
            })
        results.sort(key=lambda r: r["confidence"], reverse=True)
        return results

    @staticmethod
    def _nms(boxes: np.ndarray, scores: np.ndarray, overlap_thresh: float) -> list[int]:
        if len(boxes) == 0:
            return []
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        areas = (x2 - x1) * (y2 - y1)
        order = scores.argsort()[::-1]
        keep: list[int] = []
        while order.size > 0:
            i = order[0]
            keep.append(int(i))
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])
            inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
            iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
            remaining = np.where(iou <= overlap_thresh)[0]
            order = order[remaining + 1]
        return keep

    def test_template_match(
        self,
        template_path: Path,
        confidence: float = 0.88,
        search_region: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        """单次匹配测试，返回匹配结果和标注后的截图 base64。"""
        import base64 as _b64

        self._ensure_opencv_available()
        if not template_path.exists():
            raise FileNotFoundError(f"模板文件不存在：{template_path}")

        loaded = self._load_template(template_path)
        screen = self._capture_primary_screen()
        h, w = screen.shape[:2]
        norm_region = self._normalize_search_region(search_region, w, h)

        region_left = int(norm_region["left"]) if norm_region else 0
        region_top = int(norm_region["top"]) if norm_region else 0
        region_w = int(norm_region["width"]) if norm_region else w
        region_h = int(norm_region["height"]) if norm_region else h
        region_img = screen[region_top:region_top + region_h, region_left:region_left + region_w]

        if loaded.width > region_img.shape[1] or loaded.height > region_img.shape[0]:
            return {"found": False, "confidence": 0.0, "message": "模板比搜索区域大，无法匹配。"}

        prepared = self._prepare_screen(region_img)
        score, left, top = self._match_template(prepared, loaded)
        threshold = max(min(float(confidence), 0.999), 0.55)
        found = score >= threshold

        # 在截图上画标注
        annotated = screen.copy()
        abs_left = region_left + left
        abs_top = region_top + top
        color = (52, 211, 153) if found else (113, 113, 248)  # BGR: green / red
        cv2.rectangle(annotated, (abs_left, abs_top), (abs_left + loaded.width, abs_top + loaded.height), color, 2)
        label = f"{score:.3f}"
        cv2.putText(annotated, label, (abs_left, max(abs_top - 6, 14)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)

        if norm_region:
            cv2.rectangle(annotated, (region_left, region_top), (region_left + region_w, region_top + region_h), (250, 190, 60), 1)

        # 裁剪到匹配点附近区域以减小传输量
        pad = 120
        crop_l = max(0, abs_left - pad)
        crop_t = max(0, abs_top - pad)
        crop_r = min(annotated.shape[1], abs_left + loaded.width + pad)
        crop_b = min(annotated.shape[0], abs_top + loaded.height + pad)
        crop_img = annotated[crop_t:crop_b, crop_l:crop_r]

        ok, buf = cv2.imencode(".jpg", crop_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        preview_url = ""
        if ok:
            preview_url = "data:image/jpeg;base64," + _b64.b64encode(buf.tobytes()).decode("ascii")

        return {
            "found": found,
            "confidence": round(score, 4),
            "x": int(region_left + left + loaded.width // 2) if found else 0,
            "y": int(region_top + top + loaded.height // 2) if found else 0,
            "left": abs_left,
            "top": abs_top,
            "width": loaded.width,
            "height": loaded.height,
            "preview_url": preview_url,
            "message": f"匹配分数 {score:.4f}，阈值 {threshold:.2f}。{'已找到！' if found else '未达到阈值。'}",
        }
