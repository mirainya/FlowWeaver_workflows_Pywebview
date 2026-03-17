from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class WorkflowStore:
    """data/workflows/ 目录下单文件读写，每个工作流一个 JSON 文件。"""

    def __init__(self, workflows_dir: Path) -> None:
        self._dir = workflows_dir

    def _ensure_dir(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)

    def load_all_records(self) -> list[dict[str, Any]]:
        if not self._dir.is_dir():
            return []
        records: list[dict[str, Any]] = []
        for file_path in sorted(self._dir.glob("*.json")):
            try:
                raw = json.loads(file_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict) and raw.get("workflow_id"):
                    records.append(raw)
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("跳过无法解析的工作流文件 %s: %s", file_path.name, exc)
        return records

    def save_record(self, record: dict[str, Any]) -> None:
        self._ensure_dir()
        workflow_id = str(record.get("workflow_id", "")).strip()
        if not workflow_id:
            raise ValueError("record 缺少 workflow_id")
        filename = f"{workflow_id}.json"
        target_path = self._dir / filename
        content = json.dumps(record, ensure_ascii=False, indent=2)
        try:
            fd, tmp_path = tempfile.mkstemp(dir=str(self._dir), suffix=".tmp")
            try:
                os.write(fd, content.encode("utf-8"))
                os.close(fd)
                fd = -1
                os.replace(tmp_path, str(target_path))
            except BaseException:
                if fd >= 0:
                    os.close(fd)
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise
        except OSError:
            target_path.write_text(content, encoding="utf-8")

    def delete_record(self, workflow_id: str) -> bool:
        filename = f"{workflow_id}.json"
        target_path = self._dir / filename
        if target_path.exists():
            try:
                target_path.unlink()
                return True
            except OSError as exc:
                logger.warning("删除工作流文件失败 %s: %s", filename, exc)
                return False
        return False
