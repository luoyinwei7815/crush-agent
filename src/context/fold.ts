import type { ChatMessage } from "../api/deepseek";
import { DeepSeekClient } from "../api/deepseek";
import { estimateTokens } from "../utils/token";

export async function foldHistory(
  messages: ChatMessage[],
  tailFraction: number,
  apiClient: DeepSeekClient
): Promise<ChatMessage[]> {
  const totalTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
  const tailBudget = totalTokens * tailFraction;

  let tailTokens = 0;
  let splitIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;

    const msgTokens = estimateTokens(msg.content);

    if (tailTokens + msgTokens > tailBudget) {
      break;
    }

    if (msg.role === "user") {
      splitIndex = i;
    }

    tailTokens += msgTokens;
  }

  if (splitIndex === 0) {
    splitIndex = Math.max(1, Math.floor(messages.length * 0.3));
  }

  const head = messages.slice(0, splitIndex);
  const tail = messages.slice(splitIndex);

  const headText = head
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n\n");

  const summaryPrompt: ChatMessage[] = [
    {
      role: "system",
      content: "你是一个对话摘要生成器。请将以下对话历史压缩为简洁的摘要，保留关键信息、用户偏好和重要决策。摘要应该在 200-400 字以内。",
    },
    {
      role: "user",
      content: `请为以下对话生成摘要：\n\n${headText}`,
    },
  ];

  let summary = "";

  try {
    for await (const chunk of apiClient.chat(summaryPrompt, {
      reasoning_effort: "low",
      max_tokens: 1000,
    })) {
      if (chunk.type === "chunk") {
        summary += chunk.content;
      }
    }
  } catch (err) {
    console.error("摘要生成失败:", err);
    return messages;
  }

  if (!summary.trim()) {
    return messages;
  }

  const summaryMessage: ChatMessage = {
    role: "system",
    content: `[以下为历史摘要]\n${summary}`,
  };

  return [summaryMessage, ...tail];
}
