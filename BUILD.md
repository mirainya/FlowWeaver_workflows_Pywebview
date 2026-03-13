# 打包说明

## 环境要求
- Python 3.8+
- PyInstaller (`pip install pyinstaller`)

## 打包步骤

### 方法一：使用批处理脚本（推荐）
直接双击运行 `build.bat`

### 方法二：手动打包
```bash
pyinstaller build.spec
xcopy /E /I /Y data dist\LuoqiAssistant\data
xcopy /E /I /Y assets dist\LuoqiAssistant\assets
```

## 输出结构
```
dist/LuoqiAssistant/
├── LuoqiAssistant.exe    # 主程序
├── data/                  # 配置文件（用户可修改）
├── assets/                # 资源文件（用户可添加模板图）
└── _internal/             # 依赖库（自动生成）
```

## 发布
将整个 `dist/LuoqiAssistant/` 文件夹打包成压缩包即可发布

## 注意事项
- 首次打包可能需要较长时间
- 打包后的exe需要管理员权限运行（全局热键需要）
- 用户可以自由修改 data/config.json 和添加 assets/templates/ 中的图片
