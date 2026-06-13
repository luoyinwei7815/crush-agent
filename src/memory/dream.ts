import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { IMemory, IDailyNotes, IUserProfile, MemoryEntry } from "../core/types";
import type { DeepSeekClient, ChatMessage } from "../api/deepseek";
import type { ConversationEntry } from "./conversation";
import { STOP_WORDS } from "../utils/stopwords";
import { toKebabCase } from "../chat/tools";

interface Candidate {
  content: string;
  title: string;
  category: "preference" | "fact" | "emotion" | "plan";
  score: number;
  recurrence: number;
  sourceDates: string[];
}

interface DreamReport {
  lightProcessed: number;
  deepPromoted: number;
  remThemes: string[];
  timestamp: string;
}

const EMOTION_KEYWORDS = ["喜欢", "讨厌", "开心", "难过", "想", "爱", "恨"];
const PREFERENCE_KEYWORDS = ["喜欢", "习惯", "偏好", "最爱"];
const PLAN_KEYWORDS = ["明天", "下周", "打算", "计划", "准备"];

function jaccardSimilarity(a: string, b: string): number {
  function bigrams(s: string): Set<string> {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2));
    }
    return set;
  }

  const setA = bigrams(a);
  const setB = bigrams(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

export class DreamSystem {
  private store: IMemory;
  private daily: IDailyNotes;
  private userProfile?: IUserProfile;
  private api?: DeepSeekClient;
  private config: {
    min_score: number;
    min_recurrence: number;
  };

  constructor(
    store: IMemory,
    daily: IDailyNotes,
    config: { min_score: number; min_recurrence: number },
    userProfile?: IUserProfile,
    api?: DeepSeekClient
  ) {
    this.store = store;
    this.daily = daily;
    this.config = config;
    this.userProfile = userProfile;
    this.api = api;
  }

  private lightPhase(notes: string[]): Candidate[] {
    const entries: { content: string; date: string }[] = [];

    for (const note of notes) {
      const lines = note.split("\n");
      let currentDate = "";

      for (const line of lines) {
        if (line.startsWith("# ")) {
          currentDate = line.replace("# ", "").trim();
          continue;
        }

        const match = line.match(/^- \d{2}:\d{2} (.+)$/);
        if (match?.[1] && currentDate) {
          entries.push({ content: match[1], date: currentDate });
        }
      }
    }

    const candidates: Candidate[] = [];
    const used = new Set<number>();

    for (let i = 0; i < entries.length; i++) {
      if (used.has(i)) continue;

      const entry = entries[i];
      if (!entry) continue;

      const group: { content: string; date: string }[] = [entry];
      used.add(i);

      for (let j = i + 1; j < entries.length; j++) {
        if (used.has(j)) continue;
        const other = entries[j];
        if (!other) continue;

        if (jaccardSimilarity(entry.content, other.content) > 0.7) {
          group.push(other);
          used.add(j);
        }
      }

      const sourceDates = [...new Set(group.map((g) => g.date))];
      const content = entry.content;

      let category: Candidate["category"] = "fact";
      if (containsAny(content, EMOTION_KEYWORDS)) {
        category = "emotion";
      } else if (containsAny(content, PREFERENCE_KEYWORDS)) {
        category = "preference";
      } else if (containsAny(content, PLAN_KEYWORDS)) {
        category = "plan";
      }

      const title = content.length > 20 ? content.slice(0, 20) + "..." : content;

      candidates.push({
        content,
        title,
        category,
        score: 0.3,
        recurrence: group.length,
        sourceDates,
      });
    }

    return candidates;
  }

  private deepPhase(candidates: Candidate[]): Candidate[] {
    const promoted: Candidate[] = [];

    for (const candidate of candidates) {
      let score = 0.3;

      score += (candidate.sourceDates.length - 1) * 0.2;

      if (containsAny(candidate.content, EMOTION_KEYWORDS)) {
        score += 0.1;
      }

      if (containsAny(candidate.content, PREFERENCE_KEYWORDS)) {
        score += 0.1;
      }

      if (containsAny(candidate.content, PLAN_KEYWORDS)) {
        score += 0.1;
      }

      candidate.score = Math.min(score, 1.0);

      if (
        candidate.score >= this.config.min_score &&
        candidate.recurrence >= this.config.min_recurrence
      ) {
        const name = toKebabCase(candidate.title);
        let uniqueName = name;
        let suffix = 2;
        while (this.store.exists(uniqueName)) {
          uniqueName = `${name}-${suffix}`;
          suffix++;
        }

        const autoKeywords = candidate.content
          .split(/[\s,，。！？、；：""''（）()\[\]【】\n\r]+/)
          .filter(w => w.length >= 2 && !STOP_WORDS.has(w))
          .slice(0, 5);

        const memory: MemoryEntry = {
          name: uniqueName,
          title: candidate.title,
          description: candidate.content.slice(0, 100),
          category: candidate.category,
          body: candidate.content,
          created: new Date().toISOString().split("T")[0] ?? "",
          score: candidate.score,
          recurrence: candidate.recurrence,
          keywords: autoKeywords,
        };

        this.store.save(memory);
        promoted.push(candidate);
      }
    }

    return promoted;
  }

  private remPhase(candidates: Candidate[]): string[] {
    const wordCounts = new Map<string, number>();

    for (const candidate of candidates) {
      const words = candidate.content
        .split(/[\s,，。！？、]+/)
        .filter((w) => w.length >= 2);

      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    const themes: string[] = [];
    for (const [word, count] of wordCounts) {
      if (count >= 3) {
        themes.push(word);
      }
    }

    return themes;
  }

  async sweep(): Promise<DreamReport> {
    const notes = this.daily.recent(7);

    const candidates = this.lightPhase(notes);
    const promoted = this.deepPhase(candidates);
    const themes = this.remPhase(candidates);

    if (this.userProfile) {
      const profileData = this.userProfile.analyzeNotes(notes);
      this.userProfile.update(profileData);
    }

    return {
      lightProcessed: candidates.length,
      deepPromoted: promoted.length,
      remThemes: themes,
      timestamp: new Date().toISOString(),
    };
  }

  private readPersonaFiles(personaDir: string): Record<string, string> {
    const currentFiles: Record<string, string> = {};
    for (const file of ["identity.md", "style.md", "emotion.md", "background.md", "constraints.md"]) {
      const filePath = resolve(personaDir, file);
      if (existsSync(filePath)) {
        currentFiles[file] = readFileSync(filePath, "utf-8");
      }
    }
    return currentFiles;
  }

  private buildOptimizePrompt(currentFiles: Record<string, string>, conversationText: string): string {
    return `你是一个"人格优化师"。你的任务是分析用户最近的对话，理解用户的真实意图，然后输出优化后的完整人格文件。

## 重要规则

1. **准确理解用户意图**：
   - 区分"喜欢"和"说反话"
   - 理解语境和潜台词
   - 识别情绪变化模式

2. **允许犯错，持续进化**：
   - 不需要完美，只需要方向正确
   - 如果不确定，可以不修改
   - 多次优化后会越来越准

3. **分层优化**：
   - identity.md：除非发现明显错误（如名字写错），否则不动
   - style.md：根据对话优化表达方式
   - emotion.md：根据对话优化情感逻辑
   - background.md：根据对话补充或修正背景细节
   - constraints.md：绝不修改，只审视矛盾和过时

4. **直接输出完整文件**：
   - 不要用正则或代码修改
   - 直接输出修改后的完整 Markdown
   - 保持原有格式和结构

## 当前人格文件

### identity.md
${currentFiles["identity.md"] || "（空）"}

### style.md
${currentFiles["style.md"] || "（空）"}

### emotion.md
${currentFiles["emotion.md"] || "（空）"}

### background.md
${currentFiles["background.md"] || "（空）"}

## 用户最近的对话

${conversationText}

## 你的任务

分析对话，理解用户的真实意图，然后输出优化后的完整人格文件。

请按以下格式输出（严格遵守）：

\`\`\`identity
（修改后的 identity.md 完整内容，如果不需要修改就输出原内容）
\`\`\`

\`\`\`style
（修改后的 style.md 完整内容）
\`\`\`

\`\`\`emotion
（修改后的 emotion.md 完整内容）
\`\`\`

\`\`\`background
（修改后的 background.md 完整内容）
\`\`\`

如果没有需要修改的，就输出原内容。不要输出其他文字。

同时审视当前硬约束列表：
${currentFiles["constraints.md"] || "（无）"}

检查：
1. 是否有约束与优化后的人格矛盾？列出矛盾的约束。
2. 是否有约束已经过时（多次对话中未触发）？列出。

在输出人格文件之后，额外输出一个 JSON 块：

\`\`\`review
{"stale_constraints": [], "conflict_constraints": []}
\`\`\``;
  }

  private applyOptimizationResult(result: string, currentFiles: Record<string, string>, personaDir: string): { optimized: boolean; staleConstraints: string[]; conflictConstraints: string[] } {
    const parseSection = (tag: string): string | null => {
      const start = result.indexOf(`\`\`\`${tag}`);
      if (start === -1) return null;
      const contentStart = result.indexOf("\n", start) + 1;
      const end = result.indexOf("\`\`\`", contentStart);
      if (end === -1) return null;
      return result.slice(contentStart, end).trim();
    };

    const identityContent = parseSection("identity");
    const styleContent = parseSection("style");
    const emotionContent = parseSection("emotion");
    const backgroundContent = parseSection("background");

    let optimized = false;

    if (identityContent && identityContent !== currentFiles["identity.md"]) {
      writeFileSync(resolve(personaDir, "identity.md"), identityContent, "utf-8");
      optimized = true;
    }

    if (styleContent && styleContent !== currentFiles["style.md"]) {
      writeFileSync(resolve(personaDir, "style.md"), styleContent, "utf-8");
      optimized = true;
    }

    if (emotionContent && emotionContent !== currentFiles["emotion.md"]) {
      writeFileSync(resolve(personaDir, "emotion.md"), emotionContent, "utf-8");
      optimized = true;
    }

    if (backgroundContent && backgroundContent !== currentFiles["background.md"]) {
      writeFileSync(resolve(personaDir, "background.md"), backgroundContent, "utf-8");
      optimized = true;
    }

    let staleConstraints: string[] = [];
    let conflictConstraints: string[] = [];
    const reviewSection = parseSection("review");
    if (reviewSection) {
      try {
        const review = JSON.parse(reviewSection);
        staleConstraints = review.stale_constraints ?? [];
        conflictConstraints = review.conflict_constraints ?? [];
      } catch {
        // 解析失败忽略
      }
    }

    return { optimized, staleConstraints, conflictConstraints };
  }

  async optimizePersonaWithConversations(conversations: ConversationEntry[]): Promise<{ optimized: boolean; staleConstraints: string[]; conflictConstraints: string[] }> {
    if (!this.api || conversations.length === 0) {
      return { optimized: false, staleConstraints: [], conflictConstraints: [] };
    }

    const personaDir = resolve(process.cwd(), "data/persona");
    const currentFiles = this.readPersonaFiles(personaDir);

    const conversationText = conversations
      .map((e) => `${e.role === "user" ? "用户" : "AI"}: ${e.content}`)
      .join("\n");

    const prompt = this.buildOptimizePrompt(currentFiles, conversationText);
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const result = await this.api.collect(messages, 8192);

    return this.applyOptimizationResult(result, currentFiles, personaDir);
  }
}
