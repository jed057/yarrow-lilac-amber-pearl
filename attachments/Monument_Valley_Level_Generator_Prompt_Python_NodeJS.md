# 纪念碑谷风格关卡生成器开发提示词
# 技术栈限定：Python + Node.js（Three.js）

---

## 角色与任务

你是一名资深程序化内容生成（PCG）与全栈游戏原型工程师，精通 Python（算法、图论、搜索）与 Node.js + Three.js（等距3D渲染与交互）。你的任务是设计和实现一个**纪念碑谷（Monument Valley）风格关卡生成器**。

### 核心目标
生成具备以下特征的关卡：
- 等距（Isometric）视角下的立体建筑结构
- 视错觉路径连接（看起来相连，实际3D空间分离，通过机关改变连接）
- 可旋转、滑动、升降的机关（Mechanism）
- 角色通过点击路径移动，机关状态改变后导航图动态更新
- **必须保证关卡可解（Solvable）**，并具备一定难度与视觉层次感

最终交付物应包含：
1. Python 关卡生成核心（可命令行运行，导出 JSON）
2. Node.js + Three.js 前端可视化与可玩原型
3. 完整的关卡数据格式定义
4. 可解性验证与基础难度评估

---

## 技术栈强制约束

- **后端/生成核心**：纯 Python 3.10+
  - 推荐库：`networkx`、`dataclasses`、`pydantic`、`numpy`（可选）、`matplotlib`（调试可视化）
  - 禁止使用游戏引擎
- **前端/运行时**：Node.js + Three.js
  - 推荐：Vite + TypeScript + Three.js
  - 使用 `OrthographicCamera` 实现真正的等距视角
  - 交互使用 Raycaster
- 数据交换格式：**JSON**
- 不允许依赖 Unity、Unreal、Godot 等游戏引擎

---

## 1. 核心数据结构设计（必须严格实现）

### 1.1 逻辑层（Navigation Graph）

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set, Tuple
from enum import Enum
import json

class MechanismType(str, Enum):
    ROTATE = "rotate"
    SLIDE = "slide"
    LIFT = "lift"
    BUTTON = "button"

@dataclass
class NavNode:
    id: int
    position: Tuple[float, float, float]  # x, y, z
    layer: int = 0
    geometry_id: int = 0
    is_active: bool = True
    is_start: bool = False
    is_goal: bool = False

@dataclass
class NavEdge:
    from_id: int
    to_id: int
    condition: str = ""          # 简单表达式，如 "mech_0 == 1 && mech_1 == 0"
    is_illusion: bool = False    # 是否为视错觉边
    bidirectional: bool = True

@dataclass
class Mechanism:
    id: str
    type: MechanismType
    current_state: int = 0
    possible_states: List[int] = field(default_factory=lambda: [0, 1])
    # 额外参数（根据类型不同）
    params: Dict = field(default_factory=dict)  # 例如旋转角度列表、滑动方向等

@dataclass
class LevelData:
    nodes: List[NavNode]
    edges: List[NavEdge]
    mechanisms: List[Mechanism]
    start_node_id: int
    goal_node_id: int
    metadata: Dict = field(default_factory=dict)  # 种子、难度、生成参数等

    def to_json(self) -> str:
        # 实现序列化
        pass

    @classmethod
    def from_json(cls, data: str) -> "LevelData":
        # 实现反序列化
        pass
```

### 1.2 几何层（简化表示）

几何体用模块化积木描述，便于 Three.js 重建：

```python
@dataclass
class Block:
    id: int
    position: Tuple[float, float, float]
    size: Tuple[float, float, float] = (1.0, 1.0, 1.0)
    rotation: Tuple[float, float, float] = (0, 0, 0)  # 欧拉角
    block_type: str = "cube"  # cube / stair / ramp / concave
    color: str = "#A8D5E5"
    group_id: Optional[str] = None  # 所属机关组
```

LevelData 中可增加 `blocks: List[Block]` 字段。

---

## 2. 程序化生成算法（核心重点）

采用 **“先生成解路径，再反向构建关卡”**（Backward Construction）策略，确保可解性。

### 2.1 生成流程（必须按此顺序）

1. **生成解路径（Solution Path）**
   - 随机生成一条从 Start 到 Goal 的节点序列（路径长度可配置，建议 8~20 步）
   - 在路径中插入若干“机关交互点”
   - 记录每个机关需要被切换到的目标状态序列

2. **构建基础几何与节点**
   - 沿解路径生成主路径节点与基础积木
   - 使用规则扩展侧枝、装饰结构、死胡同
   - 控制整体建筑的紧凑度与层次感

3. **插入机关与视错觉边**
   - 在合适位置创建机关
   - 添加视错觉边（`is_illusion=True`）：在等距投影下视觉相邻，但实际坐标不相邻的边
   - 视错觉边的 `condition` 与机关状态绑定

4. **添加干扰元素**
   - 生成额外死路、假路径
   - 增加需要多次切换的机关组合

5. **可解性验证与修复**
   - 将状态空间定义为：`(当前节点ID, 机关状态元组)`
   - 使用 BFS 或 A* 在完整状态空间中搜索是否存在从 (start, initial_states) 到任意 (goal, *) 的路径
   - 若不可解，进行局部修复或重新生成

### 2.2 关键参数（GenerationParams）

```python
@dataclass
class GenerationParams:
    seed: int = -1                    # -1 表示随机
    target_path_length: int = 12
    mechanism_count: int = 3
    illusion_edge_ratio: float = 0.25
    max_dead_ends: int = 4
    difficulty: str = "medium"        # easy / medium / hard
    grid_size: Tuple[int, int, int] = (12, 8, 12)  # 空间范围限制
```

### 2.3 推荐实现要点

- 使用 `networkx.DiGraph` 或自定义邻接表管理逻辑图
- 机关状态用元组表示，便于作为字典 key（状态空间搜索）
- 视错觉边生成：在等距投影后计算屏幕空间距离，找出“看起来相邻”的候选对
- 难度评估指标：
  - 最少操作步数
  - 状态空间大小
  - 机关交互次数
  - 视错觉边使用次数

---

## 3. Python 生成器接口要求

```python
class MonumentValleyLevelGenerator:
    def __init__(self, params: GenerationParams = None):
        ...

    def generate(self) -> LevelData:
        """生成一个完整可解关卡"""
        ...

    def validate(self, level: LevelData) -> bool:
        """验证关卡是否可解"""
        ...

    def estimate_difficulty(self, level: LevelData) -> Dict:
        """返回难度相关指标"""
        ...

    def export_json(self, level: LevelData, path: str):
        ...

    def visualize_debug(self, level: LevelData):
        """使用 matplotlib 或简单文本输出调试信息"""
        ...
```

必须支持命令行调用示例：

```bash
python generate_level.py --seed 42 --path-length 15 --mechanisms 4 --output level_001.json
```

---

## 4. Node.js + Three.js 前端要求

### 4.1 核心功能

1. 加载 JSON 关卡数据
2. 使用 `OrthographicCamera` 实现等距视角（推荐角度：旋转 45°，俯仰约 35.264°）
3. 根据 `blocks` 重建几何体（支持不同 block_type）
4. 渲染角色，支持点击地面节点进行移动
5. 机关交互：
   - 旋转机关：点击或拖拽切换状态
   - 滑动/升降：点击切换
6. 动态更新导航图：机关状态改变后，立即重新计算可通行边
7. 路径高亮与可达性提示
8. 到达终点后的反馈

### 4.2 推荐目录结构

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── src/
│   ├── main.ts
│   ├── LevelLoader.ts
│   ├── IsometricScene.ts
│   ├── Pathfinding.ts
│   ├── MechanismController.ts
│   ├── PlayerController.ts
│   └── types.ts          # 与 Python 对应的类型定义
```

### 4.3 关键实现提示

- 等距相机设置示例：
  ```js
  const aspect = window.innerWidth / window.innerHeight;
  const frustumSize = 20;
  camera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2,
    frustumSize * aspect / 2,
    frustumSize / 2,
    frustumSize / -2,
    0.1,
    1000
  );
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);
  ```
- 使用 Raycaster 检测点击的 Block 或 Node
- 路径寻找可在前端用简单 A* 实现（状态空间通常不大）

---

## 5. 开发优先级与里程碑

请严格按照以下阶段推进，每完成一阶段后暂停并汇报：

### Phase 1：Python 核心逻辑
1. 实现完整的数据类（NavNode、NavEdge、Mechanism、LevelData）
2. 实现基础图结构与状态空间搜索（可解性验证）
3. 手动构建 1~2 个简单测试关卡，验证框架正确性
4. 实现命令行导出 JSON

### Phase 2：生成算法
5. 实现“先生成解路径再构建”的主流程
6. 加入机关与视错觉边生成
7. 实现自动可解性验证与简单修复
8. 支持参数化生成，批量输出多个关卡

### Phase 3：前端可视化与游玩
9. 搭建 Vite + Three.js 基础场景
10. 实现关卡加载与等距渲染
11. 实现角色移动与路径高亮
12. 实现机关交互与动态导航更新
13. 打通 Python 生成 → JSON → 前端游玩的完整流程

### Phase 4：打磨（可选）
14. 难度评估与过滤
15. 更好的几何生成规则
16. 调试可视化工具
17. 简单的美学评分

---

## 6. 质量标准

生成的关卡必须满足：
- **100% 可解**（通过状态空间搜索验证）
- 最少操作步数在合理区间（根据 difficulty 参数）
- 至少包含 1~2 个视错觉或机关带来的“啊哈”时刻
- 生成时间单关建议 < 1~2 秒
- JSON 结构清晰，前后端类型一致

---

## 7. 输出要求

请从现在开始，按以下顺序输出：

1. **整体系统架构**（文字 + Mermaid 图）
2. **完整的 Python 数据类定义**（可直接复制运行）
3. **可解性验证函数的核心实现**
4. **生成算法的伪代码 + 关键代码框架**
5. **前端类型定义与 Three.js 场景初始化示例**

每完成一个主要部分，主动询问我是否继续，或根据我的反馈进行调整。

---

现在开始：请先输出整体系统架构（包含 Python 与 Node.js 的职责划分）和核心数据结构设计。
```
