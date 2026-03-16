# 整体方案：三大功能 + 前后端模块化重构

## 现状分析

### 后端大文件
| 文件 | 行数 | 问题 |
|------|------|------|
| executor.py | 1281 | 1个类40+方法，20+个 `_handle_*` 全堆一起 |
| async_vision.py | 955 | sanitize函数 + SharedVariableStore + AsyncVisionManager 混在一起 |
| application.py | 954 | 模板管理、异步识图、流程管理、运行时状态全混一个类 |
| workflows.py | 720 | 步骤规范化、序列化、预设数据全混一起 |

### 前端大文件
| 文件 | 行数 | 问题 |
|------|------|------|
| DesignerPanel.tsx | 515 | 头部+基本字段+步骤列表+字段编辑器+可复用组件全堆一起 |
| AsyncVisionPanel.tsx | 408 | 暂不拆（独立面板，职责单一） |
| designer.ts | 376 | 暂不拆（store 逻辑内聚） |
| NodeInspector.tsx | 213 | 每个 step kind 的字段编辑器全堆一起 |

---

## 阶段 1：后端模块化重构

### 1.1 拆分 executor.py (1281行)

**思路**：把 20+ 个 `_handle_*` 方法按职责分组，提取到独立模块。

```
app/core/
├── executor.py              # 主类（~250行）：生命周期、调度、公共工具方法
├── handlers/
│   ├── __init__.py
│   ├── basic.py             # _handle_delay, _handle_key_tap, _handle_key_sequence, _handle_type_text, _handle_log
│   ├── mouse.py             # _handle_click_point, _handle_mouse_scroll, _handle_mouse_hold, _handle_mouse_drag, _handle_mouse_move
│   ├── vision.py            # _handle_detect_image, _handle_detect_click_return, _handle_detect_color, _handle_detect_color_region
│   ├── variable.py          # _handle_set_variable, _handle_set_variable_state, _handle_if_var_found, _handle_if_condition
│   ├── flow.py              # _handle_loop, _handle_call_workflow, _handle_key_hold
│   └── pixel.py             # _handle_check_pixels, _handle_check_region_color, _handle_match_fingerprint
```

**实现方式**：使用 mixin 模式，每个 handler 模块定义一个 Mixin 类，executor 继承所有 mixin。

```python
# app/core/handlers/basic.py
class BasicHandlersMixin:
    def _handle_delay(self, params, workflow_settings, stop_event): ...
    def _handle_key_tap(self, workflow_id, params, workflow_settings, stop_event): ...

# app/core/executor.py
from app.core.handlers.basic import BasicHandlersMixin
from app.core.handlers.mouse import MouseHandlersMixin
# ...

class WorkflowExecutor(BasicHandlersMixin, MouseHandlersMixin, VisionHandlersMixin, ...):
    # 只保留 __init__, run_workflow, stop_workflow, _execute_steps, _execute_action 等核心方法
```

### 1.2 拆分 application.py (954行)

**思路**：按职责域提取服务方法到独立模块。

```
app/
├── application.py           # 主类（~350行）：初始化、bootstrap、核心协调
├── services/
│   ├── template_manager.py  # 新增：模板图片管理（decode/upload/crop/thumbnail/import）~150行
│   └── ... (已有文件不动)
```

**提取到 template_manager.py 的方法**（约 200 行）：
- `_templates_root()`
- `_decode_uploaded_image()`
- `_build_uploaded_template_name()`
- `_store_uploaded_template()`
- `capture_screen_for_crop()`
- `test_template_match()`
- `crop_and_save_template()`
- `upload_template_image()`
- `import_template_image_file()`
- `get_template_thumbnail()`

```python
# app/services/template_manager.py
class TemplateManager:
    def __init__(self, project_root: Path, shared_capture, vision, logger): ...

# application.py 中
self.template_manager = TemplateManager(...)
# 原有方法委托给 template_manager
```

### 1.3 拆分 workflows.py (720行)

**思路**：预设数据和步骤规范化分离。

```
app/core/
├── workflows.py             # 核心函数（~350行）：sanitize、build、serialize、extract
├── presets.py               # 新增：预设流程数据（~200行）：build_preset_custom_flow_records
├── step_normalizer.py       # 新增：_normalize_custom_step 的大 switch（~170行）
```

### 1.4 拆分 async_vision.py (955行)

**思路**：sanitize 辅助函数、SharedVariableStore、AsyncVisionManager 分离。

```
app/services/
├── async_vision.py          # AsyncVisionManager（~450行）
├── async_sanitize.py        # 新增：sanitize_async_monitor_record 及所有 _sanitize_* 辅助函数（~200行）
├── shared_variables.py      # 新增：SharedVariableStore 类（~200行）
```

---

## 阶段 2：前端模块化重构

### 2.1 拆分 DesignerPanel.tsx (515行)

```
components/designer/
├── DesignerPanel.tsx          # 主面板容器（~120行）
├── DesignerHeader.tsx         # 头部：保存状态、视图切换、操作按钮（~60行）
├── DesignerBasicFields.tsx    # 基本字段：名称、热键、运行模式（~80行）
├── step-list/
│   ├── StepList.tsx           # 步骤列表容器（~50行）
│   ├── StepItem.tsx           # 单个步骤卡片（~60行）
│   └── StepFields.tsx         # 按 kind 渲染字段编辑器（~120行）
└── fields/                    # 可复用字段组件
    ├── index.ts               # 统一导出
    ├── FieldInput.tsx
    ├── FieldNumber.tsx
    └── FieldSelect.tsx
```

### 2.2 拆分 NodeInspector.tsx (213行)

```
components/node-editor/
├── NodeInspector.tsx              # 主检查器壳（~60行）
├── inspector-fields/
│   ├── InspectorFieldFactory.tsx  # 根据 step.kind 分发渲染（~40行）
│   ├── KeyTapFields.tsx
│   ├── DelayFields.tsx
│   ├── DetectImageFields.tsx
│   ├── ClickPointFields.tsx
│   ├── IfVarFoundFields.tsx
│   └── ... (每个 kind 一个文件，各 ~20-40行)
```

### 2.3 创建共享组件

```
components/shared/
├── TemplateFilePicker.tsx     # 模板路径输入 + 浏览按钮
├── VariableSelector.tsx       # 变量下拉选择 + 手动输入
└── WorkflowSelector.tsx       # 流程下拉选择
```

---

## 阶段 3：功能实现

### 3.1 保存节点画布状态

**前端改动**：
- `stores/designer.ts` 的 `saveFlow` 方法：将 `_nodeGraph`（nodes + edges）加入 payload
- `stores/designer.ts` 的 `openDesigner` 方法：从 workflow 数据恢复 `_nodeGraph`
- `models/workflow.ts`：确保 `DesignerState` 包含 `node_graph` 可选字段

**后端改动**：
- `application.py` 的 `save_custom_flow`：接收并保存 `node_graph` 字段到 record
- `workflows.py` 的 `serialize_custom_flow_workflow`：序列化时包含 `node_graph`
- `config_store.py`：确保 `node_graph` 能持久化到 JSON

### 3.2 图片模板文件选择器

**新建 `components/shared/TemplateFilePicker.tsx`**：
- 文本输入框（手动输入路径）
- "浏览"按钮 → 调用 `api.pickTemplateImage()` → 自动填充路径
- 在 `StepFields.tsx` 和 `DetectImageFields.tsx` 中替换原来的纯文本输入

### 3.3 变量/流程智能提示

**新建 `utils/variable-extractor.ts`**：
- 遍历所有 steps，提取 `detect_image.save_as`、`set_variable.var_name`、`detect_color.save_as` 等产生变量的字段
- 递归处理嵌套步骤（then_steps、else_steps、steps）

**新建 `components/shared/VariableSelector.tsx`**：
- 下拉列表展示当前流程中可用的变量
- 支持手动输入自定义变量名
- 用于 `click_point.var_name`、`if_var_found.var_name`、`set_variable_state.var_name` 等字段

**新建 `components/shared/WorkflowSelector.tsx`**：
- 下拉列表展示所有可调用的流程（从 app store 获取 workflows）
- 用于 `call_workflow.workflow_id` 字段

---

## 实施顺序

1. **阶段 1**：后端模块化（executor → application → workflows → async_vision）
2. **阶段 2**：前端模块化（DesignerPanel → NodeInspector → 共享组件）
3. **阶段 3.1**：保存画布状态
4. **阶段 3.2**：模板文件选择器
5. **阶段 3.3**：变量/流程智能提示

每个阶段完成后验证功能不回退，再进入下一阶段。
