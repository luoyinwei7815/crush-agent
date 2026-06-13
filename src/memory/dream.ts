import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { DeepSeekClient, ChatMessage } from "../api/deepseek";
import type { ConversationEntry } from "./conversation";

export class DreamSystem {
  private api: DeepSeekClient;

  constructor(api: DeepSeekClient) {
    this.api = api;
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
    if (conversations.length === 0) {
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
