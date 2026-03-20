from __future__ import annotations

from pathlib import Path
from typing import Any


def _edge(source: str, target: str, source_handle: str = "bottom", target_handle: str = "top") -> dict[str, Any]:
    return {
        "id": f"edge-{source}-{source_handle}-{target}",
        "source": source,
        "sourceHandle": source_handle,
        "target": target,
        "targetHandle": target_handle,
    }


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
            "node_graph": {
                "nodes": [
                    {"id": "__start__", "kind": "__start__", "position": {"x": 80, "y": 60}, "params": {}},
                    {"id": "tap-f9", "kind": "key_tap", "position": {"x": 80, "y": 200}, "params": {"keys": "f9", "delay_ms_after": 0}},
                    {"id": "delay-short", "kind": "delay", "position": {"x": 80, "y": 340}, "params": {"milliseconds": 10}},
                    {"id": "tap-f11", "kind": "key_tap", "position": {"x": 80, "y": 480}, "params": {"keys": "f11", "delay_ms_after": 0}},
                    {"id": "delay-long", "kind": "delay", "position": {"x": 80, "y": 620}, "params": {"milliseconds": 100}},
                    {"id": "__end__default", "kind": "__end__", "position": {"x": 80, "y": 760}, "params": {}},
                ],
                "edges": [
                    _edge("__start__", "tap-f9"),
                    _edge("tap-f9", "delay-short"),
                    _edge("delay-short", "tap-f11"),
                    _edge("tap-f11", "delay-long"),
                    _edge("delay-long", "__end__default"),
                ],
            },
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
            "node_graph": {
                "nodes": [
                    {"id": "__start__", "kind": "__start__", "position": {"x": 80, "y": 60}, "params": {}},
                    {
                        "id": "combo-sequence",
                        "kind": "key_sequence",
                        "position": {"x": 80, "y": 220},
                        "params": {
                            "sequence": [
                                {"keys": "1", "delay_ms": 120},
                                {"keys": "2", "delay_ms": 120},
                                {"keys": "space", "delay_ms": 180},
                                {"keys": "ctrl+3", "delay_ms": 220},
                            ]
                        },
                    },
                    {"id": "__end__default", "kind": "__end__", "position": {"x": 80, "y": 380}, "params": {}},
                ],
                "edges": [
                    _edge("__start__", "combo-sequence"),
                    _edge("combo-sequence", "__end__default"),
                ],
            },
        },
        {
            "workflow_id": "preset-vision-then-burst",
            "name": "识图后补按键",
            "description": "先识图保存坐标，再通过 if 分支决定是否点击并继续按键，展示上下文变量的用法。",
            "category": "组合流程",
            "notes": [
                "识图结果会写入变量 target，后续节点可继续引用坐标。",
                "这是迁移后的预置流程，可直接在流程编排页编辑。",
            ],
            "hotkey": "alt+f8",
            "enabled": True,
            "run_mode": {"type": "once"},
            "node_graph": {
                "nodes": [
                    {"id": "__start__", "kind": "__start__", "position": {"x": 100, "y": 60}, "params": {}},
                    {
                        "id": "detect-target",
                        "kind": "detect_image",
                        "position": {"x": 100, "y": 220},
                        "params": {
                            "template_path": template_path,
                            "save_as": "target",
                            "confidence": 0.88,
                            "timeout_ms": 2500,
                            "search_step": 4,
                        },
                    },
                    {
                        "id": "if-target-found",
                        "kind": "if_var_found",
                        "position": {"x": 100, "y": 400},
                        "params": {
                            "var_name": "target",
                            "variable_scope": "local",
                        },
                    },
                    {
                        "id": "click-target",
                        "kind": "click_point",
                        "position": {"x": -120, "y": 580},
                        "params": {
                            "source": "var",
                            "var_name": "target",
                            "button": "left",
                            "return_cursor": True,
                            "offset_x": 0,
                            "offset_y": 0,
                            "settle_ms": 50,
                        },
                    },
                    {"id": "delay-then", "kind": "delay", "position": {"x": -120, "y": 740}, "params": {"milliseconds": 200}},
                    {
                        "id": "burst-after-click",
                        "kind": "key_sequence",
                        "position": {"x": -120, "y": 900},
                        "params": {
                            "sequence": [
                                {"keys": "f", "delay_ms": 100},
                                {"keys": "r", "delay_ms": 120},
                            ]
                        },
                    },
                    {"id": "delay-else", "kind": "delay", "position": {"x": 320, "y": 580}, "params": {"milliseconds": 120}},
                    {"id": "__end__default", "kind": "__end__", "position": {"x": 100, "y": 1080}, "params": {}},
                ],
                "edges": [
                    _edge("__start__", "detect-target"),
                    _edge("detect-target", "if-target-found"),
                    _edge("if-target-found", "click-target", "then"),
                    _edge("if-target-found", "delay-else", "else"),
                    _edge("click-target", "delay-then"),
                    _edge("delay-then", "burst-after-click"),
                    _edge("burst-after-click", "__end__default"),
                    _edge("delay-else", "__end__default"),
                ],
            },
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
            "node_graph": {
                "nodes": [
                    {"id": "__start__", "kind": "__start__", "position": {"x": 100, "y": 60}, "params": {}},
                    {
                        "id": "detect-target",
                        "kind": "detect_image",
                        "position": {"x": 100, "y": 220},
                        "params": {
                            "template_path": template_path,
                            "save_as": "target",
                            "confidence": 0.88,
                            "timeout_ms": 2500,
                            "search_step": 4,
                        },
                    },
                    {
                        "id": "if-target-found",
                        "kind": "if_var_found",
                        "position": {"x": 100, "y": 400},
                        "params": {
                            "var_name": "target",
                            "variable_scope": "local",
                        },
                    },
                    {
                        "id": "click-target",
                        "kind": "click_point",
                        "position": {"x": -100, "y": 580},
                        "params": {
                            "source": "var",
                            "var_name": "target",
                            "button": "left",
                            "return_cursor": True,
                            "offset_x": 0,
                            "offset_y": 0,
                            "settle_ms": 50,
                        },
                    },
                    {"id": "delay-else", "kind": "delay", "position": {"x": 300, "y": 580}, "params": {"milliseconds": 300}},
                    {"id": "delay-after", "kind": "delay", "position": {"x": 100, "y": 760}, "params": {"milliseconds": 200}},
                    {"id": "__end__default", "kind": "__end__", "position": {"x": 100, "y": 940}, "params": {}},
                ],
                "edges": [
                    _edge("__start__", "detect-target"),
                    _edge("detect-target", "if-target-found"),
                    _edge("if-target-found", "click-target", "then"),
                    _edge("if-target-found", "delay-else", "else"),
                    _edge("click-target", "delay-after"),
                    _edge("delay-else", "delay-after"),
                    _edge("delay-after", "__end__default"),
                ],
            },
        },
    ]
