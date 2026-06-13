# Crush Agent

> *你的 AI 伴侣，越聊越懂你。*

基于 DeepSeek API 的伴侣型 AI agent，具备五层人格、Dream 记忆系统和自主梦境优化。

## 特性

- **五层人格** — identity / style / emotion / constraints / background，AI 引导式初始化，维度独立编辑
- **Dream 记忆系统** — 自动从对话提取、评分、晋升长期记忆，10 分钟空闲触发自主梦境优化人格
- **缓存优化** — 前缀钉死 + SHA256 指纹，缓存命中率 95%+，Flash/Pro 分级计费
- **对话纠正** — 输入含"纠正"自动触发，LLM 分类为 约束/人格优化/临时反馈 三类，分别执行加约束（含冲突检测）、逐维度重写人格文件、仅确认
- **世界书** — 关键词触发注入世界观设定，token 预算控制
- **Web + 终端** — 终端聊天或浏览器聊天，Warm Intimacy 暗色主题，WebSocket 实时通信
- **工具调用** — AI 可主动记住 / 搜索 / 删除记忆、写每日笔记

## 快速开始

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash          # macOS / Linux
# powershell -c "irm bun.sh/install.ps1 | iex"    # Windows

# 克隆并安装
git clone https://github.com/luoyinwei7815/crush-agent.git
cd crush-agent
bun install

# 启动
bun run start    # 终端模式
bun run web      # Web 模式 → http://localhost:3000
```

首次运行自动进入引导：API Key → V4 Pro 对话生成五层人格 → 开始聊天。

支持环境变量跳过交互：`DEEPSEEK_API_KEY=sk-xxx bun run start`

## 使用

```
你: 今天好累啊
小助手: 又加班了？早点休息，别熬太晚。
[缓存: 96.3% | 费用: ¥0.002 | 模型: deepseek-v4-flash]
```

### 命令

| 命令 | 功能 |
|------|------|
| `/help` | 查看所有命令 |
| `/memory` | 查看长期记忆 |
| `/dream` | 手动触发记忆整理 + 人格优化 |
| `/whoami` | 查看用户画像 |
| `/constraints` | 查看硬约束 |
| `/persona <dim> <内容>` | 更新人格维度（identity/style/emotion/constraints/background） |
| `/persona-file <路径> [dim]` | 导入文件到人格维度 |
| `/correct <反馈>` | 纠正人格（也支持直接说"纠正..."） |
| `/world` | 查看世界书条目 |
| `/world-add 关键词1,关键词2 \| 内容` | 添加世界书条目 |
| `/model <名称>` | 切换模型（deepseek-v4-flash / deepseek-v4-pro） |
| `/reload-persona` | 重载人格文件 |
| `/reload-memory` | 重建记忆索引 |
| `/reload-world` | 重载世界书 |
| `/history` | 查看今日对话记录 |
| `/quit` | 退出（自动执行梦境优化） |

## 架构

```
UI Layer (Terminal TUI / Web)
    │
Chat Engine (loop.ts + commands.ts)
    │
    ├── Prefix Manager (immutable + guard + compose)
    │   └── 前缀钉死 + SHA256 指纹 + 所有 system 消息哈希监控
    │
    ├── Context Manager (三层压缩: 75%/78%/80%)
    │   └── fold: API 摘要生成，失败回退截断
    │
    ├── Memory System
    │   ├── store: YAML frontmatter markdown 文件
    │   ├── search: ngram 倒排索引 + 权重评分
    │   ├── dream: 分析对话 → 优化人格（单方法，10 分钟空闲触发）
    │   ├── summary: 对话概要（LLM 每 3 天生成结构化概要）
    │   ├── conversation: JSONL 对话缓存
    │   └── user-profile: 用户画像（Pro 分析对话提取特征）
    │
    ├── Persona System (五层文件 + CorrectEngine)
    │   └── identity / style / emotion / constraints / background
    │
    ├── World Engine (关键词匹配 + token 预算)
    │
    └── DeepSeek API Client (流式 + 重试 + 分级计费)
```

### 五层人格

| 维度 | 内容 | 示例 |
|------|------|------|
| identity | 身份标签 + 硬规则底线 | 名字、年龄、关系定位、"不自称 AI" |
| style | 表达方式 | 语气、口头禅、用词习惯 |
| emotion | 情感逻辑 | 依恋类型、吵架模式、撒娇触发 |
| constraints | 硬约束 | /correct 添加的不可违反规则 |
| background | 外貌 + 经历 + 世界观 | 身高、发型、职业、兴趣爱好 |

### 记忆系统

```
对话缓存（JSONL）→ 概要（每 3 天 LLM 生成）+ 用户画像（Pro 分析）
                                                        ↓
空闲 10 分钟 → Dream → V4 Pro 分析对话 → 优化人格文件（style/emotion/background）
```

### 命令注册

命令在 `src/chat/commands.ts` 中通过 Map 注册：

```typescript
exact("/memory", handler)    // 精确匹配
prefix("/model", handler)    // 前缀匹配
```

新增命令只需一行注册，无需修改 `loop.ts`。

## 配置

```yaml
api:
  base_url: https://api.deepseek.com/v1
  key: sk-xxxx          # 或通过 DEEPSEEK_API_KEY 环境变量
  model: deepseek-v4-flash
context:
  fold_threshold: 0.75
  fold_aggressive_threshold: 0.78
  force_summary_threshold: 0.80
  tail_fraction: 0.2
memory: {}
world:
  token_budget: 4000
  scan_depth: 8
```

## 项目文档

详见 [PROJECT.md](./PROJECT.md) — 完整架构、接口定义、设计决策。

## 致谢

- [DeepSeek](https://platform.deepseek.com)
- [deepseek-reasonix](https://github.com/esengine/deepseek-reasonix) — 前缀缓存稳定技术
- [OpenClaw](https://openclaw.ai) — Dream 记忆系统
- [ex-skill](https://github.com/perkfly/ex-skill) — 多层人格系统

## License

MIT
