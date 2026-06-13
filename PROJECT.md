# Crush Agent 项目文档

> 伴侣型 AI Agent，基于 DeepSeek API，具备五层人格、Dream 记忆系统和对话概要。

## 技术栈

| 层面 | 选型 |
|------|------|
| 运行时 | Bun |
| 语言 | TypeScript (strict, `noUncheckedIndexedAccess: true`) |
| API | DeepSeek V4-Flash / V4-Pro，通过 OpenAI SDK 兼容模式 |
| UI | 终端（chalk）+ Web（原生 WebSocket，无框架） |
| 存储 | 文件系统（JSONL + YAML frontmatter + JSON），无数据库 |
| 模块 | ESM，`verbatimModuleSyntax: true` |

## 架构

```
src/
 ├── index.ts              # 入口：needsSetup → runInit → chatLoop
 ├── setup.ts              # API 配置收集（环境变量优先 / 交互式向导）
 ├── init.ts               # V4 Pro 引导式初始化（多轮对话 → 五层人格 + 世界设定）
 │
 ├── api/
 │   └── deepseek.ts       # DeepSeek 客户端（流式 + 指数退避重试 + Flash/Pro 分级计费）
 │
 ├── chat/
 │   ├── loop.ts           # 主对话循环（输入分发 → 对话 → 工具调用 → 压缩）
 │   ├── commands.ts       # 命令注册系统（exact/prefix 匹配 + dispatchCommand）
 │   └── tools.ts          # AI 工具定义与执行（remember/recall/forget）
 │
 ├── core/
 │   ├── types.ts          # 接口层：IPersona / IMemory / IWorld / IUserProfile / ChatContext
 │   └── config.ts         # AppConfig 类型定义
 │
 ├── context/
 │   ├── manager.ts        # 压缩决策（三层阈值：75% fold / 78% fold_aggressive / 80% force_summary）
 │   └── fold.ts           # 历史折叠（API 摘要生成，失败回退截断）
 │
 ├── memory/
 │   ├── store.ts          # 记忆存储（YAML frontmatter markdown + 倒排索引扫描）
 │   ├── search.ts         # 记忆搜索（ngram 分词 + 倒排索引 + 权重评分）
 │   ├── dream.ts          # Dream 系统（分析对话 → 人格优化）
 │   ├── summary.ts        # 对话概要（LLM 每 3 天生成结构化概要）
 │   ├── conversation.ts   # 对话缓存（JSONL 按日存储，本地时间，容错损坏行）
 │   └── user-profile.ts   # 用户画像（正则提取特征 + ngram 主题提取）
 │
 ├── persona/
 │   ├── loader.ts         # 五层人格加载器（identity/style/emotion/constraints/background）
 │   └── correct.ts        # 纠正引擎（Flash 意图识别 + Pro 分类/改写 + 冲突检测）
 │
 ├── prefix/
 │   ├── immutable.ts      # ImmutablePrefix（readonly + Object.freeze + SHA256 指纹）
 │   ├── guard.ts          # PrefixGuard（监控所有 system 消息哈希变化）
 │   └── compose.ts        # 前缀组装（人格内容 + 工具定义 → system message）
 │
 ├── world/
 │   └── engine.ts         # 世界书引擎（关键词匹配 + token 预算控制 + 综合排序）
 │
 ├── ui/
 │   ├── adapter.ts        # OutputAdapter 接口
 │   └── tui.ts            # 终端 UI（彩色输出、状态栏、角色名）
 │
 ├── web/
 │   ├── server.ts         # HTTP + WebSocket 服务器（Bun serve，路径遍历防护）
 │   ├── adapter.ts        # Web 输出适配器
 │   └── public/           # 前端（index.html + app.js + style.css，暗色主题，文件拖拽导入）
 │
 └── utils/
     ├── token.ts          # Token 估算（CJK=2, ASCII=0.3 启发式）
     ├── format.ts         # 状态栏格式化
     ├── stopwords.ts      # 共享停用词表（38 词，3 个模块共用）
     ├── fs.ts             # ensureDir() 工具函数
     └── readline.ts       # question() readline 封装
```

## 数据目录

```
data/
 ├── persona/              # 五层人格文件
 │   ├── identity.md       # 身份标签 + 硬规则
 │   ├── style.md          # 表达风格
 │   ├── emotion.md        # 情感逻辑
 │   ├── constraints.md    # 硬约束（/correct 追加）
 │   └── background.md     # 外貌 + 经历 + 世界观
 ├── memory/
 │   ├── facts/            # 长期记忆（*.md + YAML frontmatter）
 │   └── summaries/        # 对话概要（YYYY-MM-DD.md，每 3 天 LLM 生成）
 ├── conversations/        # 对话缓存（YYYY-MM-DD.jsonl）
 ├── world/entries.json    # 世界书条目
 ├── USER.md               # 用户画像
 ├── MEMORY.md             # 记忆索引
 └── config.yaml           # 配置（.gitignore，支持环境变量）
```

## 核心接口

```typescript
// 人格层
interface IPersona {
  compose(): string;
  reload(): void;
  exists(): boolean;
  addConstraint(text: string): void;
  removeConstraint(text: string): void;
  getConstraints(): string;
  readFile(filename: string): string;
  writeFile(filename: string, content: string): void;
  getCharacterName(): string;
}

// 记忆层
interface IMemory {
  getIndex(): string;
  scanContext(messages: ChatMessage[], tokenBudget?: number): string;
  save(memory: MemoryEntry): string;
  get(name: string): MemoryEntry | null;
  list(): MemoryEntry[];
  delete(name: string): void;
  reindex(): void;
}

// 世界书层
interface IWorld {
  scanContext(messages: ChatMessage[], scanDepth?: number): string;
  addEntry(entry: Omit<WorldEntry, "uid">): string;
  removeEntry(uid: string): void;
  listEntries(): WorldEntry[];
  reload(): void;
}

// 输出适配（终端 / Web 统一）
interface OutputAdapter {
  writeChunk(content: string): void;
  startAssistant(): void;
  endAssistant(): void;
  printSystem(text: string): void;
  printStatus(usage: ChatUsage, model: string): void;
  printError(text: string): void;
  readInput(): Promise<string>;
  close(): void;
  setCharacterName(name: string): void;
}
```

## 命令系统

命令在 `src/chat/commands.ts` 中注册，分两种匹配模式：

- **精确匹配**：`/quit`、`/memory`、`/dream`、`/whoami`、`/constraints`、`/world`、`/reload-persona`、`/reload-memory`、`/reload-world`、`/history`、`/help`、`/summarize`
- **前缀匹配**（按注册顺序）：`/persona-file` → `/persona-save` → `/persona` → `/model` → `/correct` → `/world-add` → `/world-del`

新增命令只需在 `commands.ts` 中 `exact("/cmd", handler)` 或 `prefix("/cmd", handler)` 一行注册。

## 设计决策

**前缀缓存稳定**：ImmutablePrefix 组装后 freeze，SHA256 指纹验证。PrefixGuard 监控所有 system 消息的哈希变化，确保 DeepSeek prompt caching 高命中率。

**三层上下文压缩**：75% fold（保留尾部 + API 摘要）→ 78% fold_aggressive（更激进）→ 80% force_summary（API 摘要，失败回退截断）。

**记忆系统**：
- 对话缓存（ConversationStore）：JSONL 全量保存，是所有记忆的数据源
- Dream（DreamSystem）：分析对话 → 完善人格（style/emotion/background）
- 对话概要（SummaryMemory）：每 3 天 LLM 生成结构化概要，记录聊了什么、发生了什么
- 用户画像（UserProfileManager）：记住用户是谁（偏好/性格/习惯）

**纠正系统**：Flash 做意图识别（简单 yes/no），Pro 做分类和改写（需要推理）。纠正后立即重建 prefix 生效。

**scanContext vs MemorySearch**：两套搜索机制互补。`scanContext` 是轻量关键词匹配（每轮调用），`MemorySearch` 是 ngram 倒排索引（recall 工具触发）。不合并。

**五层人格**：identity（身份+硬规则）→ style（表达）→ emotion（情感逻辑）→ constraints（硬约束）→ background（外貌+经历+世界观）。维度边界清晰，不交叉。

## 依赖

```json
{
  "dependencies": {
    "chalk": "^5.6.2",      // 终端着色
    "js-yaml": "^4.2.0",    // YAML 解析
    "openai": "^6.42.0"     // API SDK（兼容 DeepSeek）
  },
  "devDependencies": {
    "@types/bun": "^1.3.14",
    "@types/js-yaml": "^4.0.9"
  }
}
```
