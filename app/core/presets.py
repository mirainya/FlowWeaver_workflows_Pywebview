from __future__ import annotations

from pathlib import Path
from typing import Any


def build_preset_custom_flow_records(project_root: Path) -> list[dict[str, Any]]:
    template_path = (project_root / "assets" / "templates" / "target_demo.png").relative_to(project_root).as_posix()

    return [
        {
            "workflow_id": "preset-f9-f11-loop",
            "name": "F9 / F11 循环宏",
            "description": "按下反引号键后切换循环：F9 → 延时 → F11 → 延时 → 继续循环。",
            "category": "循环宏",
            "notes": [
                "按一次启动循环，再按一次同一热键停止。",
                "这是迁移后的预置流程，可直接在流程编排页编辑。",
            ],
            "hotkey": "`",
            "enabled": True,
            "run_mode": {"type": "toggle_loop"},
            "steps": [
                {"kind": "key_tap", "keys": "f9", "delay_ms_after": 0},
                {"kind": "delay", "milliseconds": 10},
                {"kind": "key_tap", "keys": "f11", "delay_ms_after": 0},
                {"kind": "delay", "milliseconds": 100},
            ],
        },
        {
            "workflow_id": "preset-combo-burst",
            "name": "连招序列",
            "description": "按一次热键，连续触发多组按键，适合作为技能循环或固定操作链。",
            "category": "按键编排",
            "notes": [
                "每一步都可以单独设置延迟。",
                "这是迁移后的预置流程，可直接在流程编排页编辑。",
            ],
            "hotkey": "alt+f7",
            "enabled": True,
            "run_mode": {"type": "once"},
            "steps": [
                {
                    "kind": "key_sequence",
                    "sequence": [
                        {"keys": "1", "delay_ms": 120},
                        {"keys": "2", "delay_ms": 120},
                        {"keys": "space", "delay_ms": 180},
                        {"keys": "ctrl+3", "delay_ms": 220},
                    ],
                }
            ],
        },
        {
            "workflow_id": "preset-vision-then-burst",
            "name": "识图后补按键",
            "description": "先识图保存坐标，再通过 if 分支决定是否点击并继续按键，展示上下文变量的用法。",
            "category": "组合流程",
            "notes": [
                "识图结果会写入变量 target，后续步骤可继续引用坐标。",
                "这是迁移后的预置流程，可直接在流程编排页编辑。",
            ],
            "hotkey": "alt+f8",
            "enabled": True,
            "run_mode": {"type": "once"},
            "steps": [
                {
                    "kind": "detect_image",
                    "template_path": template_path,
                    "save_as": "target",
                    "confidence": 0.88,
                    "timeout_ms": 2500,
                    "search_step": 4,
                },
                {
                    "kind": "if_var_found",
                    "var_name": "target",
                    "variable_scope": "local",
                    "then_steps": [
                        {
                            "kind": "click_point",
                            "source": "var",
                            "var_name": "target",
                            "button": "left",
                            "return_cursor": True,
                            "offset_x": 0,
                            "offset_y": 0,
                            "settle_ms": 50,
                        },
                        {"kind": "delay", "milliseconds": 200},
                        {
                            "kind": "key_sequence",
                            "sequence": [
                                {"keys": "f", "delay_ms": 100},
                                {"keys": "r", "delay_ms": 120},
                            ],
                        },
                    ],
                    "else_steps": [
                        {"kind": "delay", "milliseconds": 120},
                    ],
                },
            ],
        },
        {
            "workflow_id": "preset-loop-detect-click",
            "name": "循环识图点击",
            "description": "开关循环模式：每轮识图一次，命中则点击，未命中则跳过，持续循环直到手动停止。",
            "category": "组合流程",
            "notes": [
                "适合需要反复检测并点击的场景。",
                "这是迁移后的预置流程，可直接在流程编排页编辑。",
            ],
            "hotkey": "alt+f9",
            "enabled": True,
            "run_mode": {"type": "toggle_loop"},
            "steps": [
                {
                    "kind": "detect_image",
                    "template_path": template_path,
                    "save_as": "target",
                    "confidence": 0.88,
                    "timeout_ms": 2500,
                    "search_step": 4,
                },
                {
                    "kind": "if_var_found",
                    "var_name": "target",
                    "variable_scope": "local",
                    "then_steps": [
                        {
                            "kind": "click_point",
                            "source": "var",
                            "var_name": "target",
                            "button": "left",
                            "return_cursor": True,
                            "offset_x": 0,
                            "offset_y": 0,
                            "settle_ms": 50,
                        },
                    ],
                    "else_steps": [
                        {"kind": "delay", "milliseconds": 300},
                    ],
                },
                {"kind": "delay", "milliseconds": 200},
            ],
        },
    ]
