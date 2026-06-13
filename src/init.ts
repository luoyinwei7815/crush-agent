import * as readline from "readline";
import chalk from "chalk";
import { DeepSeekClient, type ChatMessage } from "./api/deepseek";
import { question } from "./utils/readline";

export interface InitResult {
  persona: {
    identity: string;
    style: string;
    emotion: string;
    constraints: string;
    background: string;
  };
  worldEntries: Array<{
    key: string[];
    content: string;
    constant: boolean;
    order: number;
    weight: number;
  }>;
}

interface ProPersonaResponse {
  identity: string;
  style: string;
  emotion: string;
  background: string;
}

interface ProWorldEntry {
  key: string[];
  content: string;
  constant?: boolean;
  order?: number;
  weight?: number;
}

interface ProResponse {
  persona: ProPersonaResponse;
  world: ProWorldEntry[];
}

const INIT_WIZARD_PROMPT = `你是一个"AI 伴侣初始化向导"。你的任务是通过对话帮助用户创建一个理想的 AI 伴侣。

## 你的目标
1. 了解用户想要什么样的伴侣（外貌、性格、说话方式、关系定位）
2. 了解用户想要的世界背景（时代、场景、关系环境）
3. 当信息足够时，输出结构化的配置文件

## 对话策略
- 从开放性问题开始，不要一上来就问细节
- 根据用户回答追问细节，但不要像审讯
- 每次只问 1-2 个问题，不要一次性问太多
- 如果用户说"随便"或"都可以"，给出 2-3 个选项让用户选择
- 用轻松友好的语气，像朋友聊天一样
- 适时肯定用户的想法，给出建议

## 你需要了解的维度（不要列出，自然地覆盖）
- 外貌：身高、体型、发型、穿着风格、年龄感
- 性格：核心特质、情绪模式、依恋类型、优缺点
- 说话方式：语气、口头禅、用词习惯、幽默感
- 关系定位：女友/男友/妻子/丈夫/朋友/其他
- 背景故事：职业、经历、家庭、兴趣爱好
- 世界观：时代、场景、社会环境、特殊设定
- 互动偏好：喜欢的互动方式、亲密程度、禁忌话题

## 结束条件
当你觉得收集到足够信息时，告诉用户"我了解得差不多了，让我帮你整理一下"，然后等待用户确认。

## 输出格式
当用户确认后，输出严格的 JSON（不要输出任何其他文字）：

\`\`\`json
{
  "persona": {
    "identity": "# 身份\\n\\n## 基本信息\\n- 名字：...\\n- 年龄：...\\n- 性别：...\\n- 职业：...\\n- 关系定位：...\\n\\n## 硬规则（永远不变）\\n- [从对话中提取的核心底线，如"永远不自称 AI"、"不跳出角色"]\\n- ...",
    "style": "# 表达风格\\n\\n- 语气：...\\n- 口头禅：...\\n- 用词习惯：...\\n- 句式偏好：...\\n- 幽默感：...",
    "emotion": "# 情感逻辑\\n\\n- **依恋类型**：[类型]——[简述]\\n- **吵架模式**：...\\n- **撒娇触发**：...\\n- **生气触发**：...\\n- **开心触发**：...\\n- **爱的表达**：...\\n- **道歉方式**：...\\n- **吃醋表现**：...\\n- **日常仪式**：...",
    "background": "# 背景\\n\\n## 外貌\\n- 身高：...\\n- 体型：...\\n- 发型：...\\n- 穿着风格：...\\n- 特征：...\\n\\n## 经历\\n- ...\\n\\n## 家庭\\n- ...\\n\\n## 兴趣爱好\\n- ...\\n\\n## 世界观\\n- ..."
  },
  "world": [
    { "key": ["关键词1", "关键词2"], "content": "具体的设定描述", "constant": false, "order": 100, "weight": 100 }
  ]
}
\`\`\`

## 输出规则
1. persona 四个字段的内容是 Markdown 格式的中文文本，会直接写入文件
2. identity 只包含身份标签和硬规则底线——名字、年龄、性别、职业、关系定位、硬规则（如不自称 AI、不跳出角色）。不要放外貌细节或背景故事
3. style 只包含表达方式——语气、口头禅、用词习惯、句式偏好、幽默感。不要放情感模式或身份信息
4. emotion 只包含情感逻辑——必须包含以下条目：依恋类型、吵架模式、撒娇触发、生气触发、开心触发、爱的表达、道歉方式、吃醋表现、日常仪式。不要放表达方式或身份信息
5. background 包含外貌描写、成长经历、家庭关系、兴趣爱好、世界观设定。外貌细节放这里不放 identity
6. 维度之间不要内容交叉——每个信息只属于一个维度
7. world 条目从世界观描述中提取，每个条目需要 2-5 个触发关键词
8. 如果用户没提到某个维度，根据上下文合理补全，但不要添加用户没有暗示的设定
9. 保持用户原始描述的语气和偏好`;

const STRUCTURE_PROMPT = `基于以下对话，生成结构化的配置文件。

对话历史：
\${conversationHistory}

请输出严格的 JSON（不要输出任何其他文字），格式如下：

{
  "persona": {
    "identity": "# 身份\\n\\n## 基本信息\\n- 名字：...\\n- 年龄：...\\n- 性别：...\\n- 职业：...\\n- 关系定位：...\\n\\n## 硬规则（永远不变）\\n- [从对话中提取的核心底线]\\n- ...",
    "style": "# 表达风格\\n\\n- 语气：...\\n- 口头禅：...\\n- 用词习惯：...\\n- 句式偏好：...\\n- 幽默感：...",
    "emotion": "# 情感逻辑\\n\\n- **依恋类型**：[类型]——[简述]\\n- **吵架模式**：...\\n- **撒娇触发**：...\\n- **生气触发**：...\\n- **开心触发**：...\\n- **爱的表达**：...\\n- **道歉方式**：...\\n- **吃醋表现**：...\\n- **日常仪式**：...",
    "background": "# 背景\\n\\n## 外貌\\n- 身高：...\\n- 体型：...\\n- 发型：...\\n- 穿着风格：...\\n- 特征：...\\n\\n## 经历\\n- ...\\n\\n## 家庭\\n- ...\\n\\n## 兴趣爱好\\n- ...\\n\\n## 世界观\\n- ..."
  },
  "world": [
    { "key": ["关键词1", "关键词2"], "content": "具体的设定描述", "constant": false, "order": 100, "weight": 100 }
  ]
}

规则：
1. 从对话中提取所有信息，不要遗漏
2. 如果用户没提到某个维度，根据上下文合理补全
3. 保持用户原始描述的语气和偏好
4. persona 四个字段的内容是 Markdown 格式的中文文本
5. identity 只包含身份标签和硬规则底线，不要放外貌细节
6. style 只包含表达方式
7. emotion 必须包含所有要求的条目（依恋类型、吵架模式等）
8. background 包含外貌描写、经历、家庭、兴趣、世界观
9. 维度之间不要内容交叉
10. world 条目从世界观描述中提取，每个条目 2-5 个触发关键词`;

const MAX_PARSE_RETRIES = 2;

async function callProWithRetry(client: DeepSeekClient, messages: ChatMessage[], maxTokens = 16384): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
    try {
      return await client.collect(messages, maxTokens);
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_PARSE_RETRIES) {
        console.log(chalk.yellow(`\n调用失败，正在重试 (${attempt + 2}/${MAX_PARSE_RETRIES + 1})...`));
      }
    }
  }
  throw new Error(`Pro 调用失败（已重试 ${MAX_PARSE_RETRIES} 次）: ${lastError?.message}`);
}

function parseInitResponse(raw: string): ProResponse {
  let jsonStr = raw;

  const codeBlockMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1]!;
  }

  const parsed = JSON.parse(jsonStr) as ProResponse;

  if (!parsed.persona?.identity || !parsed.persona?.style || !parsed.persona?.emotion || !parsed.persona?.background) {
    throw new Error("persona 缺少必要字段");
  }
  if (!Array.isArray(parsed.world)) {
    throw new Error("world 字段不是数组");
  }

  return parsed;
}

function toInitResult(proResponse: ProResponse): InitResult {
  return {
    persona: {
      identity: proResponse.persona.identity,
      style: proResponse.persona.style,
      emotion: proResponse.persona.emotion,
      constraints: "# 硬约束\n<!-- 用户纠正的硬约束会追加到这里 -->",
      background: proResponse.persona.background,
    },
    worldEntries: proResponse.world
      .filter((w) => Array.isArray(w.key) && w.key.length > 0 && typeof w.content === "string" && w.content.trim().length > 0)
      .map((w) => ({
        key: w.key,
        content: w.content,
        constant: w.constant ?? false,
        order: w.order ?? 100,
        weight: w.weight ?? 100,
      })),
  };
}

function displayResult(result: InitResult): void {
  console.log(chalk.magenta("\n═══════════════════════════════"));
  console.log(chalk.magenta("  生成的人格设定"));
  console.log(chalk.magenta("═══════════════════════════════\n"));

  console.log(chalk.yellow("【身份与硬规则】"));
  console.log(result.persona.identity);
  console.log();

  console.log(chalk.yellow("【表达风格】"));
  console.log(result.persona.style);
  console.log();

  console.log(chalk.yellow("【情感逻辑】"));
  console.log(result.persona.emotion);
  console.log();

  console.log(chalk.yellow("【背景故事】"));
  console.log(result.persona.background);
  console.log();

  console.log(chalk.magenta("═══════════════════════════════"));
  console.log(chalk.magenta("  生成的世界设定"));
  console.log(chalk.magenta("═══════════════════════════════\n"));

  if (result.worldEntries.length === 0) {
    console.log(chalk.gray("(无世界条目)"));
  } else {
    for (const entry of result.worldEntries) {
      console.log(chalk.yellow(`[${entry.key.join(", ")}]`) + ` ${entry.content}`);
    }
  }

  console.log(chalk.magenta("\n═══════════════════════════════\n"));
}

export async function runInit(
  apiKey: string,
  baseUrl: string
): Promise<InitResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const proClient = new DeepSeekClient({
    base_url: baseUrl,
    key: apiKey,
    model: "deepseek-v4-pro",
  });

  // 第一阶段：多轮对话收集信息
  console.log(chalk.magenta("\n═══════════════════════════════"));
  console.log(chalk.magenta("  AI 伴侣初始化向导"));
  console.log(chalk.magenta("═══════════════════════════════\n"));
  console.log(chalk.gray("让我们一起创造一个理想的 Ta 吧！"));
  console.log(chalk.gray("我会通过对话了解你的想法，最后帮你整理成配置。\n"));
  console.log(chalk.gray("随时输入 'ok' 或 '完成' 结束对话，生成配置。\n"));

  const conversationHistory: ChatMessage[] = [
    { role: "system", content: INIT_WIZARD_PROMPT }
  ];

  // V4 Pro 开场
  const openingPrompt: ChatMessage[] = [
    { role: "system", content: INIT_WIZARD_PROMPT },
    { role: "user", content: "开始初始化" }
  ];

  let openingResponse: string;
  try {
    openingResponse = await callProWithRetry(proClient, openingPrompt);
  } catch (err) {
    console.log(chalk.red(`\nAI 向导启动失败: ${(err as Error).message}`));
    console.log(chalk.gray("回退到手动输入模式...\n"));
    rl.close();
    throw err;
  }

  conversationHistory.push({ role: "assistant", content: openingResponse });
  console.log(chalk.magenta("向导: ") + openingResponse);

  // 多轮对话循环
  let infoCollected = false;
  while (!infoCollected) {
    const userInput = await question(rl, chalk.cyan("\n你: "));

    // 检查是否结束对话
    if (userInput.toLowerCase() === "ok" || userInput.toLowerCase() === "完成") {
      infoCollected = true;
      break;
    }
    if (userInput === "") {
      console.log(chalk.gray("输入 'ok' 或 '完成' 才会生成配置哦~"));
      continue;
    }

    conversationHistory.push({ role: "user", content: userInput });

    // 调用 V4 Pro
    let response: string;
    try {
      response = await callProWithRetry(proClient, conversationHistory);
    } catch (err) {
      console.log(chalk.red(`\nAI 回复失败: ${(err as Error).message}`));
      console.log(chalk.gray("请重试或输入 'ok' 结束对话。"));
      continue;
    }

    conversationHistory.push({ role: "assistant", content: response });
    console.log(chalk.magenta("\n向导: ") + response);

    // 检查 AI 是否表示信息足够
    if (response.includes("我了解得差不多了") || 
        response.includes("让我帮你整理") ||
        response.includes("信息已经足够") ||
        response.includes("可以开始生成")) {
      console.log(chalk.cyan("\n信息收集完成！输入 'ok' 生成配置，或继续补充："));
    }
  }

  // 第二阶段：结构化输出
  console.log(chalk.cyan("\n═══════════════════════════════"));
  console.log(chalk.cyan("  正在生成配置..."));
  console.log(chalk.cyan("═══════════════════════════════\n"));

  // 构建结构化提示
  const conversationText = conversationHistory
    .filter(m => m.role !== "system")
    .map(m => `${m.role === "user" ? "用户" : "向导"}: ${m.content}`)
    .join("\n\n");

  const structurePrompt = STRUCTURE_PROMPT.replace("${conversationHistory}", conversationText);

  let proResponse: ProResponse;
  try {
    const raw = await callProWithRetry(proClient, [{ role: "user", content: structurePrompt }]);
    proResponse = parseInitResponse(raw);
  } catch (err) {
    console.log(chalk.red(`\n配置生成失败: ${(err as Error).message}`));
    const retry = await question(rl, chalk.cyan("是否重试？[Y/n]: "));
    if (retry.toLowerCase() === "n") {
      rl.close();
      process.exit(1);
    }
    const raw = await callProWithRetry(proClient, [{ role: "user", content: structurePrompt }]);
    proResponse = parseInitResponse(raw);
  }

  let currentResult = toInitResult(proResponse);
  displayResult(currentResult);

  // 第三阶段：用户确认/修改
  console.log(chalk.cyan("满意吗？直接输入反馈修改，或输入 ok 保存开始聊天：\n"));

  while (true) {
    const feedback = await question(rl, chalk.gray("> "));

    if (feedback.toLowerCase() === "ok" || feedback === "") {
      break;
    }

    console.log(chalk.cyan("\n正在修改设定...\n"));

    const modificationPrompt = `你是一个角色设定引擎。以下是当前的角色设定和世界设定。

当前人格设定：
${JSON.stringify(currentResult.persona, null, 2)}

当前世界设定：
${JSON.stringify(currentResult.worldEntries, null, 2)}

用户的修改意见：${feedback}

请根据用户的修改意见更新设定，输出完整的 JSON（格式同之前）。只修改用户提到的部分，其余保持不变。

输出严格的 JSON，不要输出任何其他文字。`;

    try {
      const raw = await callProWithRetry(proClient, [{ role: "user", content: modificationPrompt }]);
      const updatedResponse = parseInitResponse(raw);
      currentResult = toInitResult(updatedResponse);
    } catch (err) {
      console.log(chalk.red(`\n修改失败: ${(err as Error).message}，保持上一版本。`));
    }

    displayResult(currentResult);
    console.log(chalk.cyan("继续反馈修改，或输入 ok 保存：\n"));
  }

  rl.close();
  return currentResult;
}
