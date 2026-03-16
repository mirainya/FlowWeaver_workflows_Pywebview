from __future__ import annotations

import atexit
import sys
from pathlib import Path


def _configure_console_encoding() -> None:
    for stream_name in ('stdout', 'stderr'):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, 'reconfigure', None)
        if callable(reconfigure):
            try:
                reconfigure(encoding='utf-8')
            except Exception:
                pass


def main() -> None:
    _configure_console_encoding()

    try:
        import webview

        from app.api import DesktopApi
        from app.application import AssistantApplication
    except ModuleNotFoundError as exc:
        missing_name = exc.name or str(exc)
        print(f"缺少依赖：{missing_name}。请先执行 `pip install -r requirements.txt`。")
        sys.exit(1)

    project_root = Path(__file__).resolve().parent
    application = AssistantApplication(project_root)
    atexit.register(application.shutdown)
    desktop_api = DesktopApi(application)

    ui_dist = project_root / 'app' / 'ui' / 'dist' / 'index.html'
    ui_fallback = project_root / 'app' / 'ui' / 'index.html'
    ui_entry = (ui_dist if ui_dist.exists() else ui_fallback).as_uri()
    window = webview.create_window(
        title='织流 FlowWeaver',
        url=ui_entry,
        js_api=desktop_api,
        width=1440,
        height=960,
        min_size=(1180, 780),
        text_select=True,
    )
    desktop_api.attach_window(window)
    webview.start(debug=False)


if __name__ == '__main__':
    main()
