# Luoqi Assistant

基于 pywebview 的桌面自动化流程编排工具，支持全局热键触发、图像识别和流程执行。

![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)

## 功能特性

### 流程编排
- 可视化流程编辑器，支持步骤配置和预览
- 三种运行模式：`once`（执行一次）、`repeat_n`（指定次数）、`toggle_loop`（开关循环）
- 支持的步骤类型：
  - `key_tap`：按键触发
  - `delay`：延时等待
  - `key_sequence`：按键序列
  - `detect_image`：识图存变量
  - `click_point`：点击坐标
  - `if_var_found`：识图分支
- 上下文变量系统：识图结果保存到变量，后续步骤可引用

### 图像识别
- 基于 OpenCV 的模板匹配
- 异步监控模式：后台持续识别，刷新共享变量
- 支持配置置信度、搜索范围、扫描频率
- 共享变量可在不同流程间使用

### 输入控制
- 全局热键注册与监听
- 键盘输入模拟（单键、组合键、序列）
- 鼠标操作（坐标点击、相对偏移、修饰键）
- 支持延迟设置

### 运行监控
- 实时显示流程状态（待机/执行中/循环中/停止）
- 运行日志记录
- 按键事件追踪
- 循环次数统计

## 安装与运行

### 安装依赖
```bash
python -m pip install -r requirements.txt
npm install
```

### 启动应用
```bash
python main.py
```

或使用批处理文件：
```bash
一键启动.bat
```

### 构建 UI 样式
```bash
npm run build:ui
```

## 使用示例

### 创建基础流程
1. 打开应用，进入"流程编排"标签
2. 点击"新建流程"
3. 填写信息：
   - 名称：例如"自动补给"
   - 热键：例如 `alt+9`
   - 运行模式：选择 `toggle_loop`
4. 添加步骤：
   - 点击"添加步骤"
   - 选择"按键触发"，设置按键为 `f9`，延迟 100ms
   - 再添加"延时等待"，设置 500ms
5. 保存流程

### 使用图像识别
1. 准备模板图（截图工具截取需要识别的区域）
2. 在流程中添加步骤 `识图存变量`
3. 上传模板图，设置保存变量名（如 `target`）
4. 添加 `识图分支` 步骤，判断 `target.found`
5. 在"then"分支中添加 `点击坐标`，选择变量 `target`

### 配置异步监控
1. 切换到"异步识图"标签
2. 新建监控，配置：
   - 识别名称：自定义
   - 保存变量：如 `long`
   - 模板图片：选择本地图片
   - 扫描频率：normal / fast / ultra
3. 在流程中通过 `if_var_found` 引用共享变量 `long`

## 项目结构

```
Luoqi Assistant
├── main.py             # 应用入口
├── app/
│   ├── core/            # 核心模块
│   │   ├── executor.py     # 流程执行器
│   │   ├── hotkeys.py      # 热键管理
│   │   └── workflows.py    # 工作流定义
│   ├── services/        # 服务层
│   │   ├── vision.py       # 图像识别
│   │   ├── async_vision.py  # 异步识别
│   │   └── input_controller.py # 输入控制
│   ├── ui/              # Web 界面
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── app.js
│   ├── api.py          # Webview API 桥接
│   └── application.py  # 应用编排
├── assets/templates/    # 图像模板目录
├── data/config.json    # 配置文件
└── requirements.txt    # Python 依赖
```

## 配置说明

配置文件位于 `data/config.json`，包含：

```json
{
  "bindings": {
    // 流程热键绑定和启用状态
  },
  "settings": {
    // 流程参数配置
  },
  "custom_workflows": {
    "flows": [
      // 自定义流程定义
    ]
  },
  "async_vision": {
    "monitors": [
      // 异步监控配置
    ]
  }
}
```

## 技术栈

- **后端**: Python 3.8+
- **界面框架**: pywebview
- **图像处理**: OpenCV, Pillow, MSS
- **输入模拟**: keyboard (Windows)
- **前端**: HTML/CSS/JavaScript, SCSS

## 适用场景

- 游戏辅助：技能连招、状态监控、自动操作
- 办公自动化：重复性键鼠操作
- 测试辅助：界面交互自动化
- 个人脚本：自定义自动化任务

## 注意事项

- `keyboard` 库在某些系统环境下可能需要管理员权限才能正常监听全局热键
- 图像识别效果受模板图质量影响，建议使用清晰稳定的截图
- 模板图建议统一存放在 `assets/templates` 目录下便于管理
- 当前版本仅支持 Windows 平台

## 开发计划

- 增加更多动作节点（窗口聚焦、OCR 识别等）
- 流程导入导出功能
- 变量调试面板
- 区域截图工具集成

## License

MIT License

---

**Keywords**: 桌面自动化，流程编排，图像识别，Python, OpenCV, pywebview, 按键模拟
