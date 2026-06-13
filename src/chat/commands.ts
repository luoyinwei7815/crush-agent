import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { ChatMessage, DeepSeekClient } from "../api/deepseek";
import { composePrefix } from "../prefix/compose";
import type { ImmutablePrefix } from "../prefix/immutable";
import { TOOL_DEFINITIONS } from "./tools";
import type { IMemory, IWorld, IPersona, IUserProfile } from "../core/types";
import type { DreamSystem } from "../memory/dream";
import type { PrefixGuard } from "../prefix/guard";
import type { OutputAdapter } from "../ui/adapter";
import type { ConversationStore } from "../memory/conversation";
import type { CorrectEngine } from "../persona/correct";
import type { MemorySearch } from "../memory/search";
import { ensureDir } from "../utils/fs";

export interface CommandContext {
  api: DeepSeekClient;
  persona: IPersona;
  memory: IMemory;
  world: IWorld;
  dream: DreamSystem;
  conversations: ConversationStore;
  search?: MemorySearch;
  userProfile?: IUserProfile;
  correct: CorrectEngine;
  adapter: OutputAdapter;
  guard: PrefixGuard;
  messages: ChatMessage[];
  characterName: string;
  getPrefix(): ImmutablePrefix;
  setPrefix(p: ImmutablePrefix): void;
  dreamOptimize(minuteRange: number): Promise<void>;
}

export type CommandResult = "handled" | "quit";
export type CommandHandler = (args: string, ctx: CommandContext) => Promise<CommandResult> | CommandResult;

const exactCmds = new Map<string, CommandHandler>();
const prefixCmds: Array<{ prefix: string; handler: CommandHandler }> = [];

function exact(cmd: string, handler: CommandHandler): void {
  exactCmds.set(cmd, handler);
}

function prefix(cmd: string, handler: CommandHandler): void {
  prefixCmds.push({ prefix: cmd, handler });
}

export async function dispatchCommand(input: string, ctx: CommandContext): Promise<CommandResult | null> {
  const eh = exactCmds.get(input);
  if (eh) return eh("", ctx);

  for (const { prefix: px, handler } of prefixCmds) {
    if (input.startsWith(px + " ") || input === px) {
      return handler(input.slice(px.length).trim(), ctx);
    }
  }

  if (/纠正/.test(input)) {
    const isCorrect = await ctx.correct.confirmIntent(input);
    if (isCorrect) {
      const ch = prefixCmds.find((p) => p.prefix === "/correct")?.handler;
      if (ch) return ch(input, ctx);
    }
  }

  return null;
}

// ==================== 精确命令 ====================

exact("/quit", async (_a, ctx): Promise<CommandResult> => {
  if (ctx.messages.length > 0) {
    ctx.adapter.printSystem("\n🌙 退出前执行梦境...");
    try {
      await ctx.dreamOptimize(30);
    } catch (err) {
      console.error("退出前梦境失败:", err);
    }
  }
  ctx.adapter.printSystem(`${ctx.characterName}下线了~`);
  ctx.adapter.close();
  return "quit";
});

exact("/memory", (_a, ctx): CommandResult => {
  const index = ctx.memory.getIndex();
  ctx.adapter.printSystem("\n=== 长期记忆 ===");
  ctx.adapter.printSystem(index || "(暂无记忆)");
  ctx.adapter.printSystem("===============\n");
  return "handled";
});

exact("/dream", async (_a, ctx): Promise<CommandResult> => {
  ctx.adapter.printSystem("\n正在整理记忆...");
  const report = await ctx.dream.sweep();
  ctx.adapter.printSystem(`\n=== Dream 报告 ===`);
  ctx.adapter.printSystem(`提取候选: ${report.lightProcessed} 条`);
  ctx.adapter.printSystem(`晋升记忆: ${report.deepPromoted} 条`);
  ctx.adapter.printSystem(`发现主题: ${report.remThemes.join(", ") || "无"}`);
  ctx.adapter.printSystem("\n🌙 正在优化人格...");
  try {
    await ctx.dreamOptimize(30);
  } catch (err) {
    console.error("人格优化失败:", err);
    ctx.adapter.printSystem("⚠ 人格优化失败，但记忆提取已完成");
  }
  ctx.adapter.printSystem(`===============\n`);
  return "handled";
});

exact("/constraints", (_a, ctx): CommandResult => {
  const c = ctx.persona.getConstraints();
  ctx.adapter.printSystem("\n=== 硬约束 ===");
  ctx.adapter.printSystem(c || "(暂无硬约束)");
  ctx.adapter.printSystem("=============\n");
  return "handled";
});

exact("/whoami", (_a, ctx): CommandResult => {
  const p = resolve(process.cwd(), "data/USER.md");
  if (existsSync(p)) {
    ctx.adapter.printSystem("\n=== 我认识的你 ===");
    ctx.adapter.printSystem(readFileSync(p, "utf-8"));
    ctx.adapter.printSystem("=================\n");
  } else {
    ctx.adapter.printSystem("还不太了解你，多聊聊吧~");
  }
  return "handled";
});

exact("/world", (_a, ctx): CommandResult => {
  const entries = ctx.world.listEntries();
  if (entries.length === 0) {
    ctx.adapter.printSystem("世界书为空");
  } else {
    ctx.adapter.printSystem("\n=== 世界书 ===");
    for (const e of entries) {
      ctx.adapter.printSystem(`[${e.uid}] ${e.key.join(",")} → ${e.content.slice(0, 50)}...`);
    }
    ctx.adapter.printSystem("=============\n");
  }
  return "handled";
});

exact("/reload-persona", (_a, ctx): CommandResult => {
  ctx.persona.reload();
  const userContent = ctx.userProfile?.toMarkdown() ?? "";
  const newP = composePrefix(
    ctx.persona.compose() + (userContent ? "\n\n" + userContent : ""),
    TOOL_DEFINITIONS
  );
  newP.freeze();
  ctx.setPrefix(newP);
  ctx.guard.reset();
  ctx.adapter.printSystem("人格已重载");
  return "handled";
});

exact("/reload-memory", (_a, ctx): CommandResult => {
  ctx.memory.reindex();
  ctx.adapter.printSystem("记忆索引已重建");
  return "handled";
});

exact("/reload-world", (_a, ctx): CommandResult => {
  ctx.world.reload();
  ctx.adapter.printSystem("世界书已重载");
  return "handled";
});

exact("/history", (_a, ctx): CommandResult => {
  const entries = ctx.conversations.getToday();
  if (entries.length === 0) {
    ctx.adapter.printSystem("今日暂无对话记录");
  } else {
    const lines = entries.map((e) => {
      const time = new Date(e.ts).toLocaleTimeString("zh-CN", { hour12: false });
      const role = e.role === "user" ? "你" : ctx.characterName;
      return `[${time}] ${role}: ${e.content}`;
    });
    ctx.adapter.printSystem("\n=== 今日对话 ===\n" + lines.join("\n") + "\n================\n");
  }
  return "handled";
});

exact("/help", (_a, ctx): CommandResult => {
  ctx.adapter.printSystem(
    [
      "\n=== 可用命令 ===",
      "",
      "【对话】",
      "  /memory            查看长期记忆",
      "  /dream             整理记忆 + 优化人格",
      "  /whoami            查看用户画像",
      "  /constraints       查看硬约束",
      "",
      "【人格】",
      "  /persona <dim> <内容>   更新维度（identity/style/emotion/constraints/background）",
      "  /persona-file <路径> [dim]  导入文件到人格维度",
      "  /correct <反馈>    纠正人格（也支持直接说「纠正...」）",
      "  /reload-persona    重载人格文件",
      "",
      "【世界书】",
      "  /world             查看世界书条目",
      "  /world-add 关键词1,关键词2 | 内容",
      "  /world-del <uid>   删除条目",
      "  /reload-world      重载世界书",
      "",
      "【系统】",
      "  /model <名称>      切换模型（deepseek-v4-flash/pro）",
      "  /reload-memory     重建记忆索引",
      "  /history           查看今日对话记录",
      "  /help              显示此帮助",
      "  /quit              退出",
      "==================\n",
    ].join("\n")
  );
  return "handled";
});

// ==================== 前缀命令（注册顺序：长前缀在前） ====================

prefix("/persona-file", (args, ctx): CommandResult => {
  const VALID_DIMS = ["identity", "style", "emotion", "constraints", "background"];
  const tokens = args.split(/\s+/);
  let filePath: string;
  let dimension = "identity";

  if (tokens.length >= 2) {
    const lastToken = tokens[tokens.length - 1]!;
    if (VALID_DIMS.includes(lastToken)) {
      const candidatePath = tokens.slice(0, -1).join(" ");
      const candidateFullPath = resolve(process.cwd(), candidatePath);
      if (existsSync(candidateFullPath)) {
        filePath = candidatePath;
        dimension = lastToken;
      } else {
        filePath = args;
      }
    } else {
      filePath = args;
    }
  } else {
    filePath = args;
  }

  const fullPath = resolve(process.cwd(), filePath);
  const allowedDirs = [resolve(process.cwd(), "data")];
  const normalizedFull = fullPath.replace(/\\/g, "/");
  const isAllowed = allowedDirs.some((dir) => {
    const normalizedDir = dir.replace(/\\/g, "/");
    return normalizedFull.startsWith(normalizedDir + "/") || normalizedFull === normalizedDir;
  });
  if (!isAllowed) {
    ctx.adapter.printError("只能导入 data 或 src 目录下的文件");
    return "handled";
  }

  try {
    const content = readFileSync(fullPath, "utf-8");
    const dir = resolve(process.cwd(), "data/persona");
    ensureDir(dir);
    writeFileSync(resolve(dir, `${dimension}.md`), content, "utf-8");
    ctx.persona.reload();
    ctx.adapter.printSystem(`已导入 ${filePath} → ${dimension}.md`);
  } catch {
    ctx.adapter.printError(`无法读取文件: ${filePath}`);
  }
  return "handled";
});

prefix("/persona-save", (args, ctx): CommandResult => {
  try {
    const data = JSON.parse(args);
    const dir = resolve(process.cwd(), "data/persona");
    ensureDir(dir);
    for (const dim of ["identity", "style", "emotion", "constraints", "background"]) {
      if (data[dim]) writeFileSync(resolve(dir, `${dim}.md`), data[dim], "utf-8");
    }
    ctx.persona.reload();
    ctx.adapter.printSystem("人格已保存并重载");
  } catch {
    ctx.adapter.printError("人格保存失败：JSON 解析错误");
  }
  return "handled";
});

prefix("/persona", (args, ctx): CommandResult => {
  const dimMatch = args.match(/^(identity|style|emotion|constraints|background)\s+/);
  const dir = resolve(process.cwd(), "data/persona");
  ensureDir(dir);
  if (dimMatch) {
    const dim = dimMatch[1]!;
    const content = args.slice(dimMatch[0]!.length).trim();
    writeFileSync(resolve(dir, `${dim}.md`), content, "utf-8");
    ctx.persona.reload();
    ctx.adapter.printSystem(`${dim}.md 已更新`);
  } else {
    writeFileSync(resolve(dir, "identity.md"), args, "utf-8");
    ctx.persona.reload();
    ctx.adapter.printSystem("identity.md 已更新（无维度参数，默认 identity）");
  }
  return "handled";
});

prefix("/model", (args, ctx): CommandResult => {
  const valid = ["deepseek-v4-flash", "deepseek-v4-pro"];
  if (valid.includes(args) || args.startsWith("deepseek")) {
    ctx.api.setDefaultModel(args);
    ctx.adapter.printSystem(`已切换模型: ${args}`);
  } else {
    ctx.adapter.printSystem(`无效的模型名称。可用: ${valid.join(", ")} 或 deepseek-* 自定义`);
  }
  return "handled";
});

prefix("/correct", async (args, ctx): Promise<CommandResult> => {
  const recent = ctx.messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n");
  const result = await ctx.correct.classify(args, ctx.persona.getConstraints(), recent);
  switch (result.type) {
    case "constraint":
      if (result.conflict && result.conflict_with) {
        ctx.adapter.printSystem(`⚠ 这条与现有约束"${result.conflict_with}"矛盾，要替换还是共存？`);
        ctx.adapter.printSystem("输入 replace 替换，或其他任意键共存：");
        if ((await ctx.adapter.readInput()).toLowerCase() === "replace") {
          ctx.persona.removeConstraint(result.conflict_with);
        }
      }
      ctx.persona.addConstraint(result.constraint!);
      ctx.adapter.printSystem(`✓ 已添加约束："${result.constraint}"`);
      break;
    case "persona_optimize":
      for (const dim of result.dimensions!) {
        const d = dim as "identity" | "style" | "emotion" | "background";
        const currentContent = ctx.persona.readFile(`${d}.md`);
        const optimized = await ctx.correct.optimizeDimension(result.intent!, d, currentContent);
        ctx.persona.writeFile(`${d}.md`, optimized);
      }
      ctx.adapter.printSystem(`✓ 已优化 ${result.dimensions!.join("/")}（${result.intent}）`);
      break;
    case "temporary":
      ctx.adapter.printSystem("✓ 已收到反馈（对话历史中生效）");
      break;
  }
  return "handled";
});

prefix("/world-add", (args, ctx): CommandResult => {
  const parts = args.split("|");
  if (parts.length === 2) {
    const keys = parts[0]!.split(",").map((k) => k.trim());
    const uid = ctx.world.addEntry({ key: keys, content: parts[1]!.trim(), constant: false, order: 100, weight: 100 });
    ctx.adapter.printSystem(`已添加世界书条目: ${uid}`);
  } else {
    ctx.adapter.printSystem("格式：/world-add 关键词1,关键词2 | 内容");
  }
  return "handled";
});

prefix("/world-del", (args, ctx): CommandResult => {
  ctx.world.removeEntry(args);
  ctx.adapter.printSystem(`已删除世界书条目: ${args}`);
  return "handled";
});
