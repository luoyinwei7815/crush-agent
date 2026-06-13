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

function buildClassifyPrompt(userInput: string, existingConstraints: string, recentMessages: string, personaContent: string): string {
  return `你是纠正分析器。分析用户的反馈，输出 JSON。

用户反馈：${userInput}
现有硬约束：${existingConstraints}
现有对话上下文（最近 3 轮）：${recentMessages}
当前人格设定：
---
${personaContent}
---

分类规则（按优先级）：

1. "人格优化"：描述角色**是什么样的人**或**会做什么事**。
   包括但不限于：
   - "角色会/不会做X"（行为倾向）
   - "角色喜欢/讨厌X"（偏好）
   - "角色的性格是X"（性格特征）
   - "角色跟X有关系"（人物关系）
   - 任何改变角色本质属性、行为模式、情感倾向的反馈
   → 提取优化意图，指定影响维度：
      - "identity"：身份、关系定位、硬规则
      - "style"：表达风格、语气
      - "emotion"：情感逻辑、行为倾向、依恋模式
      - "background"：外貌、经历、人物关系

2. "硬约束"：用户明确要求**对话中不要出现某行为**，且该行为不属于角色本质。
   典型场景：
   - "不要叫我X"（称呼禁忌）
   - "不要用这个词"（用词禁忌）
   - "不要在回复中加括号描述动作"（格式要求）
   - "不要提到X话题"（话题禁忌）
   → 生成精炼约束表述

3. "临时反馈"：针对刚才某次具体回答的反馈，不涉及长期变化。

输出格式（严格 JSON）：
{
  "type": "constraint" | "persona_optimize" | "temporary",
  "constraint": "精炼的约束表述（仅 type=constraint 时）",
  "conflict": false,
  "conflict_with": "冲突的现有约束（仅 conflict=true 时）",
  "intent": "用户原话的忠实转述（仅 type=persona_optimize 时，不要改写、不要软化、不要反转用户的意图）",
  "dimensions": ["emotion", "identity"]（仅 type=persona_optimize 时，影响的维度）
}

重要：intent 字段必须忠实反映用户想要的变化方向。例如用户说"小龙女会跟尹志平偷情"，intent 应该是"小龙女会对尹志平产生感情并愿意与他发生亲密关系"，而不是相反方向的解读。`;
}

function buildOptimizePrompt(userFeedback: string, dimension: string, currentFileContent: string): string {
  return `你是人格文件编辑器。你的唯一任务是：按照用户的纠正指令，修改人格维度文件。

用户的原话："${userFeedback}"
目标维度：${dimension}
当前文件内容：
---
${currentFileContent}
---

铁律（违反任何一条都是错误）：
1. 用户的纠正指令是**绝对命令**，不是建议。你必须忠实地执行它。
2. 如果用户说"角色会做X"，你必须让文件体现"角色会做X"。如果用户说"角色不会做X"，你必须让文件体现"角色不会做X"。
3. 禁止自行判断用户的纠正是否"合理"。禁止用你的价值观替代用户的意图。禁止反向修改。
4. 如果现有内容与用户指令矛盾，**用用户指令覆盖旧内容**。不要调和，不要保留矛盾的描述。
5. 保持原有结构和格式，只修改与用户指令相关的部分。
6. 输出改写后的完整文件内容（直接输出，不要包裹在代码块中）。`;
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

/** 判断约束文本是否描述的是角色行为/属性（而非对话禁忌） */
function isPersonaBehavior(text: string): boolean {
  // 含"会"/"不会"/"喜欢"/"讨厌"/"是"/"有关系"等行为/属性模式
  const behaviorPatterns = /[会不喜讨厌是][^，。]{2,}/;
  // 含角色名+动作的模式
  const charActionPattern = /.{1,4}(会|不会|喜欢|讨厌|是|跟|和).{2,}/;
  return behaviorPatterns.test(text) || charActionPattern.test(text);
}

/** 根据约束文本推断影响的人格维度 */
function inferDimensions(text: string): string[] {
  const dims: string[] = [];
  if (/喜欢|讨厌|忠贞|偷|背叛|感情|爱|恨/.test(text)) dims.push("emotion");
  if (/夫妻|妻子|丈夫|情人|伴侣|师父|徒弟|过儿|小龙女|杨过/.test(text)) dims.push("identity");
  if (/长相|外貌|身高|经历|过去|从前/.test(text)) dims.push("background");
  if (/语气|说话|声音|口头禅|用词|风格/.test(text)) dims.push("style");
  if (dims.length === 0) dims.push("emotion");
  return dims;
}

export class CorrectEngine {
  private flashClient: DeepSeekClient;
  private proClient: DeepSeekClient;

  constructor(flashClient: DeepSeekClient, proClient: DeepSeekClient) {
    this.flashClient = flashClient;
    this.proClient = proClient;
  }

  async confirmIntent(userInput: string): Promise<boolean> {
    // 简单 yes/no 判断，flash 够用
    const messages: ChatMessage[] = [{ role: "user", content: buildIntentPrompt(userInput) }];
    const response = await this.flashClient.collect(messages, 16);
    return response.toLowerCase().includes("yes");
  }

  async classify(
    userInput: string,
    existingConstraints: string,
    recentMessages: string,
    personaContent: string
  ): Promise<ClassifyResult> {
    // 分类需要理解语义和冲突，用 Pro
    const messages: ChatMessage[] = [{ role: "user", content: buildClassifyPrompt(userInput, existingConstraints || "（无）", recentMessages || "（无）", personaContent || "（无）") }];
    const raw = await this.proClient.collect(messages);

    try {
      const jsonStr = extractJson(raw);
      const parsed = JSON.parse(jsonStr) as ClassifyResult;
      if (!parsed.type || !["constraint", "persona_optimize", "temporary"].includes(parsed.type)) {
        return { type: "temporary" };
      }

      // 兜底：如果 LLM 返回 constraint 但内容是行为/属性描述，升级为 persona_optimize
      if (parsed.type === "constraint" && parsed.constraint && isPersonaBehavior(parsed.constraint)) {
        return {
          type: "persona_optimize",
          intent: parsed.constraint,
          dimensions: inferDimensions(parsed.constraint),
        };
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
    // 改写人格文件需要精确理解意图并忠实执行，用 Pro
    const messages: ChatMessage[] = [{ role: "user", content: buildOptimizePrompt(intent, dimension, currentContent || "（空）") }];
    return this.proClient.collect(messages, 4096);
  }
}
