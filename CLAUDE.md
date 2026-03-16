# 项目规则

## 虚拟环境

本项目使用 Python 虚拟环境 `.venv`，所有 Python 相关操作必须在虚拟环境中执行。

- 激活命令（bash）：`source .venv/Scripts/activate`
- 激活命令（PowerShell）：`.venv\Scripts\Activate.ps1`
- 运行程序：`.venv/Scripts/python main.py`
- 安装依赖：`.venv/Scripts/pip install -r requirements.txt`

## 构建打包

PyInstaller 打包也必须使用虚拟环境中的 pyinstaller：

```bash
.venv/Scripts/pyinstaller build.spec
```

## 前端构建

前端位于 `app/ui/`，使用 Vite + React + TypeScript：

```bash
cd app/ui && npm run build
```

## 完整构建流程

1. 清理：`rm -rf build dist`
2. 前端构建：`cd app/ui && npm run build`
3. 打包：`.venv/Scripts/pyinstaller build.spec`
4. 复制资源：`cp -r data dist/LuoqiAssistant/data && cp -r assets dist/LuoqiAssistant/assets`
