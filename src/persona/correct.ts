import type { DeepSeekClient, ChatMessage } from "../api/deepseek";

export interface ClassifyResult {
  type: "constraint" | "persona_optimize" | "temporary";
  constraint?: string;
  conflict?: boolean;
  conflict_with?: string;
  intent?: string;
  dimensions?: string[];
}

function buildIntentPrompt(userInput: string): string {
  return `判断以下用户输入是否为"对 AI 助手的行为纠正/反馈"。

用户输入：${userInput}

只回答 "yes" 或 "no"。`;
}

function buildClassifyPrompt(userInput: string, existingConstraints: string, recentMessages: string): string {
  return `你是纠正分析器。分析用户的反馈，输出 JSON。

用户反馈：${userInput}
现有硬约束：${existingConstraints}
现有对话上下文（最近 3 轮）：${recentMessages}

分类规则：
1. "硬约束"：用户明确表示不要某行为、不要某称呼、不要某风格。这是长期有效的规则。
   - 如果与现有硬约束矛盾，输出 "conflict": true 和冲突的约束内容
   - 生成一条精炼的约束表述（一句话，命令式）
2. "人格优化"：用户想要的整体方向变化，涉及人格、风格、情感的调整。
   - 提取优化意图（用户想要什么方向）
   - 指定影响的维度（可多选）：
      - "identity"：身份标签（名字、年龄、职业、关系定位）
      - "style"：表达风格（语气、口头禅、用词）
      - "emotion"：情感逻辑（依恋、情绪触发）
      - "background"：背景（外貌、经历、世界观）
3. "临时反馈"：针对刚才某次具体回答的反馈，不涉及长期规则变化。

输出格式（严格 JSON）：
{
  "type": "constraint" | "persona_optimize" | "temporary",
  "constraint": "精炼的约束表述（仅 type=constraint 时）",
  "conflict": false,
  "conflict_with": "冲突的现有约束（仅 conflict=true 时）",
  "intent": "优化意图描述（仅 type=persona_optimize 时）",
  "dimensions": ["style", "emotion"]（仅 type=persona_optimize 时，影响的维度）
}`;
}

function buildOptimizePrompt(intent: string, dimension: string, currentFileContent: string): string {
  return `你是人格文件编辑器。根据用户反馈，改写指定的人格维度文件。

用户意图：${intent}
目标维度：${dimension}
当前文件内容：
---
${currentFileContent}
---

要求：
1. 保持原有结构和格式
2. 只修改与用户意图相关的部分
3. 不要删除用户原有设定中与意图无关的内容
4. 输出改写后的完整文件内容（直接输出，不要包裹在代码块中）`;
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    return braceMatch[0];
  }
  return text.trim();
}

export class CorrectEngine {
  private client: DeepSeekClient;

  constructor(client: DeepSeekClient) {
    this.client = client;
  }

  async confirmIntent(userInput: string): Promise<boolean> {
    const messages: ChatMessage[] = [{ role: "user", content: buildIntentPrompt(userInput) }];
    const response = await this.client.collect(messages, 16);
    return response.toLowerCase().includes("yes");
  }

  async classify(
    userInput: string,
    existingConstraints: string,
    recentMessages: string
  ): Promise<ClassifyResult> {
    const messages: ChatMessage[] = [{ role: "user", content: buildClassifyPrompt(userInput, existingConstraints || "（无）", recentMessages || "（无）") }];
    const raw = await this.client.collect(messages);

    try {
      const jsonStr = extractJson(raw);
      const parsed = JSON.parse(jsonStr) as ClassifyResult;
      if (!parsed.type || !["constraint", "persona_optimize", "temporary"].includes(parsed.type)) {
        return { type: "temporary" };
      }
      return parsed;
    } catch {
      return { type: "temporary" };
    }
  }

  async optimizeDimension(
    intent: string,
    dimension: "identity" | "style" | "emotion" | "background",
    currentContent: string
  ): Promise<string> {
    const messages: ChatMessage[] = [{ role: "user", content: buildOptimizePrompt(intent, dimension, currentContent || "（空）") }];
    return this.client.collect(messages, 4096);
  }
}
