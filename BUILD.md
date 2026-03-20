# Windows 打包说明

## 目标
项目采用现有的 PyInstaller **one-folder** 方案发布，正式产物是整个 `dist/LuoqiAssistant/` 目录，而不是单独一个 exe。

这样可以保留运行时可写目录，确保以下资源在发布后仍可正常读写：
- `data/config.json`
- `data/workflows/`
- `assets/templates/`

前端静态资源 `app/ui/dist/` 继续由 `build.spec` 打进发布目录，供 pywebview 启动界面使用。

## 环境要求
- Windows
- Python 3.8+
- Node.js + npm
- PyInstaller（`pip install pyinstaller`）

建议先安装项目依赖后再执行打包。

## 推荐打包方式

### 方法一：使用批处理脚本（推荐）
直接运行根目录下的 `build.bat`。

脚本会依次执行：
1. 清理旧的 `build/`、`dist/`
2. 构建前端 `app/ui/dist`
3. 执行 `pyinstaller build.spec`
4. 复制外部可写资源 `data/`、`assets/` 到 `dist/LuoqiAssistant/`

### 方法二：手动打包
```bash
cd app/ui
npm install
npm run build
cd ../..
pyinstaller build.spec
xcopy /E /I /Y data dist\LuoqiAssistant\data
xcopy /E /I /Y assets dist\LuoqiAssistant\assets
```

## 输出结构
```text
dist/LuoqiAssistant/
├── LuoqiAssistant.exe        # 主程序
├── data/                     # 用户配置与工作流（可写）
│   ├── config.json
│   └── workflows/
├── assets/                   # 模板图与资源（可写）
│   └── templates/
├── app/
│   └── ui/
│       └── dist/             # 前端构建产物
└── _internal/                # PyInstaller 依赖（自动生成）
```

## 发布方式
请**分发整个 `dist/LuoqiAssistant/` 目录**，不要只发送 `LuoqiAssistant.exe`。

推荐做法：
1. 打包完成后，将整个 `dist/LuoqiAssistant/` 压缩为 zip
2. 用户解压后直接运行 `LuoqiAssistant.exe`

## 运行要求与权限说明
- 建议将程序解压到**用户可写目录**运行，例如桌面、下载目录、普通工作目录
- 不建议直接放到 `Program Files`、系统盘受限目录或其他需要额外写权限的位置
- 普通功能应尽量支持普通权限运行
- 如果需要：
  - 注册全局热键
  - 与高权限窗口交互
  - 某些键鼠控制场景
  可能需要使用**管理员权限**启动

当前不要默认把“管理员权限”写成所有场景的强制要求，应该以实际验证结果为准。

## 验证清单
打包完成后，至少检查以下内容：

### 1. 产物结构
确认 `dist/LuoqiAssistant/` 内存在：
- `LuoqiAssistant.exe`
- `data/`
- `assets/`
- `_internal/`
- `app/ui/dist/`

### 2. 启动验证
启动 `LuoqiAssistant.exe`，确认：
- pywebview 窗口能正常打开
- 前端页面不白屏
- 前后端桥接通信正常

### 3. 可写目录验证
在 exe 模式下确认以下操作真实落盘：
- 修改设置后，`data/config.json` 会更新
- 保存/删除自定义流程后，`data/workflows/` 会变化
- 导入或裁剪模板图后，`assets/templates/` 会变化

### 4. 关键业务功能验证
重点验证：
- 异步识图
- 共享变量刷新
- 截图与模板匹配
- 热键触发
- 鼠标/键盘控制

### 5. 权限差异验证
分别在：
- 普通权限
- 管理员权限

两种方式下运行一次，记录哪些能力需要提权，并把结论补回本文档。

## 排障原则
如果打包后出现问题，优先按下面顺序排查：
1. 前端资源路径是否存在（`app/ui/dist/index.html`）
2. 发布目录中 `data/`、`assets/` 是否完整复制
3. 依赖是否缺失（如 pywebview / OpenCV / mss / keyboard）
4. 再针对性补 `build.spec` 的 `hiddenimports`、`binaries`、`datas` 或少量运行时兼容逻辑

原则上先复用现有 one-folder 方案，只有在验证失败时再做最小修补。
