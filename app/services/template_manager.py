from __future__ import annotations

import base64
import binascii
import re
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

from PIL import Image, UnidentifiedImageError


class TemplateManager:
    """管理模板图片的上传、裁剪、缩略图等操作。"""

    def __init__(
        self,
        project_root: Path,
        shared_capture: Any,
        vision: Any,
        logger: Any,
    ) -> None:
        self._project_root = project_root
        self._shared_capture = shared_capture
        self._vision = vision
        self._logger = logger

    def templates_root(self) -> Path:
        templates_root = self._project_root / "assets" / "templates"
        templates_root.mkdir(parents=True, exist_ok=True)
        return templates_root

    def decode_uploaded_image(self, raw_payload: str) -> bytes:
        payload = str(raw_payload or "").strip()
        if not payload:
            raise ValueError("上传内容不能为空。")

        if payload.startswith("data:"):
            matched = re.match(
                r"^data:image/[a-zA-Z0-9.+-]+;base64,(?P<body>.+)$",
                payload,
                flags=re.IGNORECASE | re.DOTALL,
            )
            if matched is None:
                raise ValueError("上传内容不是合法的图片数据。")
            payload = matched.group("body")

        payload = re.sub(r"\s+", "", payload)
        try:
            return base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("图片解码失败，请重新选择模板图。") from exc

    def build_uploaded_template_name(self, filename: str, image_format: str) -> str:
        raw_stem = Path(filename or "template").stem.strip()
        safe_stem = re.sub(r"[^0-9a-zA-Z]+", "-", raw_stem.lower()).strip("-") or "template"

        normalized_suffix = Path(filename or "").suffix.lower()
        allowed_suffixes = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}
        suffix_by_format = {
            "PNG": ".png",
            "JPEG": ".jpg",
            "JPG": ".jpg",
            "BMP": ".bmp",
            "WEBP": ".webp",
        }
        if normalized_suffix not in allowed_suffixes:
            normalized_suffix = suffix_by_format.get(image_format.upper(), ".png")
        if normalized_suffix == ".jpeg":
            normalized_suffix = ".jpg"

        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        return f"{safe_stem}-{timestamp}-{uuid4().hex[:8]}{normalized_suffix}"

    def store_uploaded_template(self, filename: str, image_bytes: bytes) -> dict[str, str]:
        try:
            with Image.open(BytesIO(image_bytes)) as image:
                image.load()
                image_format = str(image.format or "").upper()
        except UnidentifiedImageError as exc:
            raise ValueError("上传文件不是支持的图片格式。") from exc

        target_name = self.build_uploaded_template_name(filename, image_format)
        target_path = self.templates_root() / target_name
        target_path.write_bytes(image_bytes)

        relative_path = target_path.relative_to(self._project_root).as_posix()
        self._logger(f"已上传模板图：{target_name}", "success")
        return {
            "template_path": relative_path,
            "filename": target_name,
        }

    def capture_screen_for_crop(self) -> dict[str, str]:
        """截取当前屏幕，返回 base64 编码的 PNG 数据 URL，供前端覆盖层使用。"""
        import cv2 as _cv2

        frame = self._shared_capture.grab()
        success, png_buffer = _cv2.imencode(".png", frame)
        if not success:
            raise RuntimeError("屏幕截图编码失败。")
        b64 = base64.b64encode(png_buffer.tobytes()).decode("ascii")
        h, w = frame.shape[:2]
        return {
            "data_url": f"data:image/png;base64,{b64}",
            "width": w,
            "height": h,
        }

    def test_template_match(self, template_path: str, confidence: float = 0.88) -> dict:
        """单次识图测试，返回匹配结果和标注预览图。"""
        resolved = Path(template_path)
        if not resolved.is_absolute():
            resolved = self._project_root / resolved
        if not resolved.exists():
            raise ValueError(f"模板图片不存在：{resolved.name}")
        return self._vision.test_template_match(
            template_path=resolved,
            confidence=confidence,
        )

    def crop_and_save_template(
        self, data_url: str, left: int, top: int, width: int, height: int, filename: str = ""
    ) -> dict[str, str]:
        """从截屏数据中裁剪指定区域并保存为模板图片。"""
        image_bytes = self.decode_uploaded_image(data_url)
        with Image.open(BytesIO(image_bytes)) as img:
            img.load()
            crop_box = (
                max(0, int(left)),
                max(0, int(top)),
                min(img.width, int(left) + int(width)),
                min(img.height, int(top) + int(height)),
            )
            cropped = img.crop(crop_box)
            buf = BytesIO()
            cropped.save(buf, format="PNG")
            cropped_bytes = buf.getvalue()

        save_name = filename.strip() if filename else "crop"
        return self.store_uploaded_template(f"{save_name}.png", cropped_bytes)

    def upload_template_image(self, filename: str, data_url: str) -> dict[str, str]:
        image_bytes = self.decode_uploaded_image(data_url)
        return self.store_uploaded_template(filename, image_bytes)

    def import_template_image_file(self, source_path: str) -> dict[str, str]:
        resolved_source_path = Path(str(source_path or "")).expanduser()
        if not resolved_source_path.exists() or not resolved_source_path.is_file():
            raise ValueError("选择的模板文件不存在。")

        try:
            image_bytes = resolved_source_path.read_bytes()
        except OSError as exc:
            raise ValueError("读取模板文件失败。") from exc

        return self.store_uploaded_template(resolved_source_path.name, image_bytes)

    def get_template_thumbnail(self, template_path: str, max_size: int = 120) -> dict[str, Any]:
        """返回模板图片的缩略图 data URL。"""
        resolved = Path(template_path)
        if not resolved.is_absolute():
            resolved = self._project_root / resolved
        if not resolved.exists():
            return {"ok": False, "error": "模板图片不存在"}
        try:
            with Image.open(resolved) as img:
                img.load()
                w, h = img.size
                ratio = min(max_size / w, max_size / h, 1.0)
                thumb_w = max(1, int(w * ratio))
                thumb_h = max(1, int(h * ratio))
                thumb = img.resize((thumb_w, thumb_h), Image.LANCZOS)
                buf = BytesIO()
                thumb.save(buf, format="PNG")
                data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
                return {"ok": True, "data_url": data_url, "width": w, "height": h}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
