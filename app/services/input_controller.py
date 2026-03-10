from __future__ import annotations

import ctypes
import time

# keyboard 库键名别名 —— 将 _VK_TABLE 中的别名映射为 keyboard 库接受的标准名称
_KEY_ALIASES: dict[str, str] = {
    "numminus": "subtract",
    "numsubtract": "subtract",
    "numplus": "add",
    "numadd": "add",
    "nummul": "multiply",
    "nummultiply": "multiply",
    "numdiv": "divide",
    "numdivide": "divide",
    "numperiod": "decimal",
    "numdecimal": "decimal",
    "numenter": "num enter",
    **{f"num{i}": f"num {i}" for i in range(10)},
    **{f"numpad{i}": f"num {i}" for i in range(10)},
}


def normalize_hotkey(hotkey: str) -> str:
    """将热键字符串（含别名键名）规范化为 keyboard 库接受的标准格式。"""
    parts = hotkey.split("+")
    return "+".join(
        _KEY_ALIASES.get(part.strip().lower(), part.strip()) for part in parts
    )


# VK 码表 —— 所有允许使用的键名（小写）→ Windows Virtual Key Code
_VK_TABLE: dict[str, int] = {
    # 字母
    **{c: ord(c.upper()) for c in "abcdefghijklmnopqrstuvwxyz"},
    # 主键盘数字行
    **{str(i): 0x30 + i for i in range(10)},
    # 功能键 f1=0x70 … f12=0x7B
    **{f"f{i}": 0x6F + i for i in range(1, 13)},
    # 小键盘数字（支持 num0/numpad0 两种写法）
    **{f"num{i}":    0x60 + i for i in range(10)},
    **{f"numpad{i}": 0x60 + i for i in range(10)},
    # 小键盘运算符（VK 码直接映射，无歧义）
    "numminus":    0x6D, "numsubtract": 0x6D, "subtract": 0x6D,
    "numplus":     0x6B, "numadd":      0x6B, "add":      0x6B,
    "nummul":      0x6A, "nummultiply": 0x6A, "multiply": 0x6A,
    "numdiv":      0x6F, "numdivide":   0x6F, "divide":   0x6F,
    "numperiod":   0x6E, "numdecimal":  0x6E, "decimal":  0x6E,
    "numenter":    0x0D,
    "numlock":     0x90,
    # 修饰键
    "ctrl": 0x11, "control": 0x11,
    "shift": 0x10,
    "alt":  0x12,
    "win":  0x5B, "windows": 0x5B, "super": 0x5B,
    # 特殊键
    "enter": 0x0D, "return": 0x0D,
    "backspace": 0x08,
    "tab":    0x09,
    "space":  0x20,
    "esc":    0x1B, "escape":   0x1B,
    "capslock":   0x14,
    "scrolllock": 0x91,
    "printscreen": 0x2C,
    "pause":  0x13,
    # 导航键
    "home":     0x24,
    "end":      0x23,
    "pageup":   0x21, "pgup": 0x21,
    "pagedown": 0x22, "pgdn": 0x22,
    "insert":   0x2D, "ins": 0x2D,
    "delete":   0x2E, "del": 0x2E,
    "up":    0x26,
    "down":  0x28,
    "left":  0x25,
    "right": 0x27,
    # OEM 符号键（US 布局）
    "-": 0xBD, "minus": 0xBD,
    "=": 0xBB, "equals": 0xBB,
    "[": 0xDB, "]": 0xDD,
    "\\": 0xDC, "backslash": 0xDC,
    ";": 0xBA, "semicolon": 0xBA,
    "'": 0xDE, "quote": 0xDE,
    ",": 0xBC, "comma": 0xBC,
    ".": 0xBE, "period": 0xBE,
    "/": 0xBF, "slash": 0xBF,
    "`": 0xC0, "grave": 0xC0,
}


class _Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


_INPUT_MOUSE          = 0
_INPUT_KEYBOARD       = 1
_KEYEVENTF_KEYUP      = 0x0002
_KEYEVENTF_EXTENDEDKEY = 0x0001
_MAPVK_VK_TO_VSC      = 0   # MapVirtualKeyW: VK → 硬件扫描码

# 需要附加 KEYEVENTF_EXTENDEDKEY 标志的 VK 码
_EXTENDED_VK: frozenset[int] = frozenset({
    0x21,  # VK_PRIOR  (Page Up)
    0x22,  # VK_NEXT   (Page Down)
    0x23,  # VK_END
    0x24,  # VK_HOME
    0x25,  # VK_LEFT
    0x26,  # VK_UP
    0x27,  # VK_RIGHT
    0x28,  # VK_DOWN
    0x2D,  # VK_INSERT
    0x2E,  # VK_DELETE
    0x5B,  # VK_LWIN
    0x5C,  # VK_RWIN
    0x6F,  # VK_DIVIDE  (小键盘 /)
})


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk",         ctypes.c_ushort),
        ("wScan",       ctypes.c_ushort),
        ("dwFlags",     ctypes.c_ulong),
        ("time",        ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class _INPUT(ctypes.Structure):
    class _UNION(ctypes.Union):
        _fields_ = [("mi", _MOUSEINPUT), ("ki", _KEYBDINPUT)]

    _fields_ = [
        ("type", ctypes.c_ulong),
        ("union", _UNION),
    ]


class WindowsInputController:
    MOUSEEVENTF_LEFTDOWN  = 0x0002
    MOUSEEVENTF_LEFTUP    = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP   = 0x0010

    def __init__(self) -> None:
        self._user32 = ctypes.windll.user32

    def get_cursor_position(self) -> tuple[int, int]:
        point = _Point()
        self._user32.GetCursorPos(ctypes.byref(point))
        return (point.x, point.y)

    def set_cursor_position(self, position: tuple[int, int]) -> None:
        self._user32.SetCursorPos(int(position[0]), int(position[1]))

    def _mouse_click(self, button: str) -> None:
        if button == "right":
            down = self.MOUSEEVENTF_RIGHTDOWN
            up   = self.MOUSEEVENTF_RIGHTUP
        else:
            down = self.MOUSEEVENTF_LEFTDOWN
            up   = self.MOUSEEVENTF_LEFTUP
        inputs = (_INPUT * 2)()
        inputs[0].type = _INPUT_MOUSE
        inputs[0].union.mi.dwFlags = down
        inputs[1].type = _INPUT_MOUSE
        inputs[1].union.mi.dwFlags = up
        self._user32.SendInput(2, inputs, ctypes.sizeof(_INPUT))

    def _send_key(self, vk: int, key_up: bool = False) -> None:
        scan = self._user32.MapVirtualKeyW(vk, _MAPVK_VK_TO_VSC)
        flags = 0
        if key_up:
            flags |= _KEYEVENTF_KEYUP
        if vk in _EXTENDED_VK:
            flags |= _KEYEVENTF_EXTENDEDKEY
        inp = (_INPUT * 1)()
        inp[0].type = _INPUT_KEYBOARD
        inp[0].union.ki.wVk = vk
        inp[0].union.ki.wScan = scan
        inp[0].union.ki.dwFlags = flags
        self._user32.SendInput(1, inp, ctypes.sizeof(_INPUT))

    def press_key(self, key: str) -> None:
        vk = _VK_TABLE.get(key.strip().lower())
        if vk:
            self._send_key(vk, key_up=False)

    def release_key(self, key: str) -> None:
        vk = _VK_TABLE.get(key.strip().lower())
        if vk:
            self._send_key(vk, key_up=True)

    def click_here(self, button: str = "left") -> None:
        self._mouse_click(button)

    def click_at(
        self,
        target_position: tuple[int, int],
        button: str = "left",
        settle_ms: int = 60,
        return_cursor: bool = False,
        modifiers: list[str] | None = None,
        modifier_delay_ms: int = 50,
    ) -> None:
        original_position = self.get_cursor_position() if return_cursor else None
        self.set_cursor_position(target_position)
        time.sleep(max(settle_ms, 0) / 1000)

        pressed_modifiers: list[str] = []
        try:
            for mod in (modifiers or []):
                self.press_key(mod)
                pressed_modifiers.append(mod)
            if pressed_modifiers:
                time.sleep(max(modifier_delay_ms, 0) / 1000)
            self._mouse_click(button)
            if pressed_modifiers:
                time.sleep(max(modifier_delay_ms, 0) / 1000)
        finally:
            for mod in reversed(pressed_modifiers):
                self.release_key(mod)

        time.sleep(max(settle_ms, 0) / 1000)
        if original_position is not None:
            self.set_cursor_position(original_position)

    def click_and_return(
        self,
        target_position: tuple[int, int],
        button: str = "left",
        settle_ms: int = 60,
    ) -> None:
        self.click_at(
            target_position=target_position,
            button=button,
            settle_ms=settle_ms,
            return_cursor=True,
        )

    def press_combo(self, keys: str) -> None:
        parts = [p.strip().lower() for p in keys.split("+")]
        vk_codes = [_VK_TABLE[p] for p in parts if p in _VK_TABLE]
        if not vk_codes:
            return
        n = len(vk_codes)
        inputs = (_INPUT * (n * 2))()
        for i, vk in enumerate(vk_codes):
            scan = self._user32.MapVirtualKeyW(vk, _MAPVK_VK_TO_VSC)
            flags = _KEYEVENTF_EXTENDEDKEY if vk in _EXTENDED_VK else 0
            inputs[i].type = _INPUT_KEYBOARD
            inputs[i].union.ki.wVk = vk
            inputs[i].union.ki.wScan = scan
            inputs[i].union.ki.dwFlags = flags
        for i, vk in enumerate(reversed(vk_codes)):
            scan = self._user32.MapVirtualKeyW(vk, _MAPVK_VK_TO_VSC)
            flags = _KEYEVENTF_KEYUP
            if vk in _EXTENDED_VK:
                flags |= _KEYEVENTF_EXTENDEDKEY
            inputs[n + i].type = _INPUT_KEYBOARD
            inputs[n + i].union.ki.wVk = vk
            inputs[n + i].union.ki.wScan = scan
            inputs[n + i].union.ki.dwFlags = flags
        self._user32.SendInput(n * 2, inputs, ctypes.sizeof(_INPUT))
