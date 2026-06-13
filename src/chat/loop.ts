import { type ChatMessage, type ChatUsage } from "../api/deepseek";
import type { DeepSeekClient } from "../api/deepseek";
import { foldHistory } from "../context/fold";
import type { CompressionDecision } from "../context/manager";
import type { ImmutablePrefix } from "../prefix/immutable";
import { parseToolCall, executeTool } from "./tools";
import { dispatchCommand } from "./commands";
import type { CommandContext } from "./commands";
import { rebuildPrefix } from "./prefix-utils";
import type { ChatContext, IMemory, IWorld, IPersona, IUserProfile } from "../core/types";
import { estimateTokens } from "../utils/token";
import type { DreamSystem } from "../memory/dream";
import type { SummaryMemory } from "../memory/summary";
import type { PrefixGuard } from "../prefix/guard";
import type { OutputAdapter } from "../ui/adapter";
import { ConversationStore } from "../memory/conversation";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

async function executeCompression(
  decision: CompressionDecision,
  messages: ChatMessage[],
  api: DeepSeekClient,
  adapter: OutputAdapter
): Promise<void> {
  if (decision.action === "fold" || decision.action === "fold_aggressive") {
    const folded = await foldHistory(messages, decision.tailFraction, api);
    messages.length = 0;
    messages.push(...folded);
    adapter.printSystem("[历史已折叠]");
  }

  if (decision.action === "force_summary") {
    adapter.printSystem("[上下文已满，强制总结]");
    try {
      const folded = await foldHistory(messages, 0.1, api);
      messages.length = 0;
      messages.push(...folded);
    } catch {
      const keepCount = Math.min(6, messages.length);
      const kept = messages.slice(-keepCount);
      messages.length = 0;
      messages.push(...kept);
      adapter.printSystem("[摘要生成失败，已截断历史]");
    }
  }
}

async function executeDreamOptimization(
  dream: DreamSystem,
  conversations: ConversationStore,
  persona: IPersona,
  userProfile: IUserProfile | undefined,
  prefix: ImmutablePrefix,
  guard: PrefixGuard,
  adapter: OutputAdapter,
  minuteRange: number
): Promise<ImmutablePrefix> {
  const recentConversations = conversations.getRecent(minuteRange);
  if (recentConversations.length === 0) {
    adapter.printSystem("（无最近对话，跳过人格优化）");
    return prefix;
  }

  const result = await dream.optimizePersonaWithConversations(recentConversations);

  if (result.optimized) {
    persona.reload();
    const newPrefix = rebuildPrefix(persona, userProfile, guard);
    adapter.printSystem("💫 人格已优化");
    return newPrefix;
  }

  adapter.printSystem("✨ 人格无需调整");

  if (result.staleConstraints.length > 0) {
    adapter.printSystem(`⚠ 以下约束可能已过时：${result.staleConstraints.join("、")}`);
  }
  if (result.conflictConstraints.length > 0) {
    adapter.printSystem(`⚠ 以下约束与人格矛盾：${result.conflictConstraints.join("、")}`);
  }

  return prefix;
}

function assembleMessages(
  prefix: ImmutablePrefix,
  messages: ChatMessage[],
  memory: IMemory,
  world: IWorld,
  summary: SummaryMemory
): ChatMessage[] {
  const sendMessages = [...prefix.toMessages()];

  const summaryContext = summary.scanContext(messages);
  if (summaryContext) {
    sendMessages.push({ role: "system", content: summaryContext });
  } else {
    const memoryContext = memory.scanContext(messages);
    if (memoryContext) {
      sendMessages.push({ role: "system", content: memoryContext });
    }
  }

  const worldContext = world.scanContext(messages);
  if (worldContext) {
    sendMessages.push({ role: "system", content: worldContext });
  }

  sendMessages.push(...messages);
  return sendMessages;
}

export async function chatLoop(ctx: ChatContext): Promise<void> {
  const { api, guard, context, memory, summary, dream, world, persona, contextMax, adapter, search, userProfile, correct } = ctx;
  let { prefix } = ctx;

  const characterName = persona.getCharacterName();
  adapter.setCharacterName(characterName);
  adapter.printSystem(`${characterName}上线了~`);

  const messages: ChatMessage[] = [];
  const conversations = new ConversationStore("data");

  if (summary.needsSummary()) {
    adapter.printSystem("📝 距上次概要已超过 3 天，正在生成对话概要...");
    try {
      const recent = conversations.getRecent(3 * 24 * 60);
      await summary.summarize(recent, 3);
      adapter.printSystem("✓ 对话概要已生成");
    } catch (err) {
      console.error("概要生成失败:", err);
      adapter.printError("概要生成失败，将在下次启动时重试");
    }
  }

  let lastActivityTime = Date.now();
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let isDreaming = false;

  const cmdCtx: CommandContext = {
    api, persona, memory, summary, world, dream, conversations, search, userProfile,
    correct, adapter, guard, messages, characterName,
    getPrefix: () => prefix,
    setPrefix(p) { prefix = p; },
    async dreamOptimize(minuteRange: number) {
      prefix = await executeDreamOptimization(dream, conversations, persona, userProfile, prefix, guard, adapter, minuteRange);
    },
  };

  const startIdleTimer = () => {
    if (idleTimer) {
      clearInterval(idleTimer);
    }
    idleTimer = setInterval(async () => {
      const idleTime = Date.now() - lastActivityTime;

      if (idleTime >= IDLE_TIMEOUT_MS && !isDreaming && messages.length > 0) {
        isDreaming = true;
        adapter.printSystem("\n🌙 梦境系统启动...");

        try {
          await cmdCtx.dreamOptimize(10);
        } catch (err) {
          console.error("梦境失败:", err);
        }

        isDreaming = false;
        lastActivityTime = Date.now();
      }
    }, IDLE_CHECK_INTERVAL_MS);
  };

  startIdleTimer();

  while (true) {
    context.resetTurn();

    console.log("[loop] 等待输入...");
    const input = await adapter.readInput();
    console.log(`[loop] 收到: ${input.slice(0, 80)}`);

    lastActivityTime = Date.now();
    if (input === "") continue;

    let result: "handled" | "quit" | null = null;
    try {
      result = await dispatchCommand(input, cmdCtx);
    } catch (err) {
      console.error(`[loop] 命令处理出错:`, err);
      adapter.printError(`命令处理出错: ${(err as Error).message}`);
      continue;
    }
    if (result === "quit") {
      if (idleTimer) clearInterval(idleTimer);
      break;
    }
    if (result === "handled") continue;

    // ===== 普通对话 =====
    conversations.append("user", input);

    messages.push({ role: "user", content: input });

    const beforeDecision = context.checkBeforeTurn(messages, contextMax);
    await executeCompression(beforeDecision, messages, api, adapter);

    const guardResult = guard.check([...prefix.toMessages(), ...messages]);
    if (!guardResult.stable) {
      adapter.printSystem(`[前缀变化: ${guardResult.reason}]`);
    }

    const sendMessages = assembleMessages(prefix, messages, memory, world, summary);
    console.log(`[loop] API 调用，${sendMessages.length} 条消息`);

    adapter.startAssistant();
    let assistantContent = "";
    let lastUsage: ChatUsage | null = null;
    let responseModel = "";

    for await (const chunk of api.chat(sendMessages)) {
      if (chunk.type === "chunk") {
        adapter.writeChunk(chunk.content);
        assistantContent += chunk.content;
      } else if (chunk.type === "done") {
        lastUsage = chunk.usage;
        responseModel = chunk.model;
      }
    }

    adapter.endAssistant();

    const toolCall = parseToolCall(assistantContent);
    if (toolCall) {
      const toolResult = executeTool(
        toolCall.name,
        toolCall.args,
        memory,
        search
      );
      const cleanAssistantContent = assistantContent.replace(/```json\s*[\s\S]*?\s*```/g, "").trim();
      messages.push({ role: "assistant", content: cleanAssistantContent || `[调用工具: ${toolCall.name}]` });
      messages.push({ role: "system", content: `[工具结果: ${toolCall.name}]\n${toolResult}` });
      const followUpMessages = assembleMessages(prefix, messages, memory, world, summary);
      adapter.startAssistant();
      let followUpContent = "";
      for await (const chunk of api.chat(followUpMessages)) {
        if (chunk.type === "chunk") {
          adapter.writeChunk(chunk.content);
          followUpContent += chunk.content;
        } else if (chunk.type === "done") {
          lastUsage = chunk.usage;
          responseModel = chunk.model;
        }
      }
      adapter.endAssistant();
      assistantContent = followUpContent;
    }

    conversations.append("assistant", assistantContent);

    messages.push({ role: "assistant", content: assistantContent });

    const fallbackUsage = lastUsage ?? {
      prompt_tokens: messages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
      completion_tokens: 0,
      cache_hit_tokens: 0,
      cache_miss_tokens: 0,
      total_cost_estimate: 0,
    };
    const afterDecision = context.checkAfterTurn(fallbackUsage, contextMax);
    await executeCompression(afterDecision, messages, api, adapter);

    if (lastUsage) {
      adapter.printStatus(lastUsage, responseModel);
    }
  }
}
