import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import * as yaml from "js-yaml";
import chalk from "chalk";
import { DeepSeekClient } from "./api/deepseek";
import { composePrefix } from "./prefix/compose";
import { PrefixGuard } from "./prefix/guard";
import { ContextManager } from "./context/manager";
import { MemoryStore } from "./memory/store";
import { DreamSystem } from "./memory/dream";
import { MemorySearch } from "./memory/search";
import { SummaryMemory } from "./memory/summary";
import { UserProfileManager } from "./memory/user-profile";
import { PersonaLoader } from "./persona/loader";
import { CorrectEngine } from "./persona/correct";
import { WorldEngine } from "./world/engine";
import { TOOL_DEFINITIONS } from "./chat/tools";
import { chatLoop } from "./chat/loop";
import { TerminalAdapter } from "./ui/tui";
import { WebServer } from "./web/server";
import { WebAdapter } from "./web/adapter";
import type { OutputAdapter } from "./ui/adapter";
import type { AppConfig } from "./core/config";
import type { ChatContext } from "./core/types";
import { needsSetup, runSetup } from "./setup";
import { runInit } from "./init";

function parseArgs(): { web: boolean; port: number } {
  const args = process.argv.slice(2);
  const web = args.includes("--web");
  const portIndex = args.indexOf("--port");
  const portArg = portIndex !== -1 ? args[portIndex + 1] : undefined;
  const port = portArg ? parseInt(portArg, 10) : 3000;
  return { web, port };
}

async function main() {
  if (needsSetup()) {
    await runSetup();
  }

  const { web, port } = parseArgs();
  const configPath = resolve(process.cwd(), "config.yaml");

  let config: AppConfig;
  if (existsSync(configPath)) {
    config = yaml.load(readFileSync(configPath, "utf-8")) as AppConfig;
  } else {
    config = {
      api: {
        base_url: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
        key: process.env.DEEPSEEK_API_KEY || "",
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      },
      context: {
        fold_threshold: 0.75,
        fold_aggressive_threshold: 0.78,
        force_summary_threshold: 0.80,
        tail_fraction: 0.2,
        tail_fraction_aggressive: 0.1,
      },
      memory: {},
    };
  }

  const api = new DeepSeekClient({
    base_url: config.api.base_url,
    key: config.api.key,
    model: config.api.model,
  });

  let adapter: OutputAdapter;
  if (web) {
    const staticDir = resolve(import.meta.dir, "web/public");
    const server = new WebServer({
      port,
      host: "0.0.0.0",
      staticDir,
      onConnect: (id) => console.log(`客户端连接: ${id}`),
      onDisconnect: (id) => console.log(`客户端断开: ${id}`),
    });
    server.start();
    console.log(chalk.green(`Web 服务器已启动: http://localhost:${port}`));
    adapter = new WebAdapter(server);
  } else {
    adapter = new TerminalAdapter();
  }

  const persona = new PersonaLoader("data");
  const world = new WorldEngine("data/world/entries.json", config.world?.token_budget ?? 4000);

  if (!persona.exists()) {
    try {
      const initResult = await runInit(
        config.api.key,
        config.api.base_url,
        adapter
      );
      persona.replaceAll(initResult.persona);
      for (const entry of initResult.worldEntries) {
        world.addEntry(entry);
      }
      console.log(chalk.green("\n初始化完成！开始聊天吧~\n"));
    } catch (err) {
      adapter.printError(`初始化失败: ${(err as Error).message}`);
      adapter.close();
      process.exit(1);
    }
  }

  const proApi = new DeepSeekClient({
    base_url: config.api.base_url,
    key: config.api.key,
    model: "deepseek-v4-pro",
  });
  const correct = new CorrectEngine(api, proApi);

  const personaContent = persona.compose();

  const memory = new MemoryStore("data/memory/facts");
  const summary = new SummaryMemory(api);
  const userProfile = new UserProfileManager("data", proApi);
  const memorySearch = new MemorySearch(memory);
  memorySearch.buildIndex();
  const dream = new DreamSystem(api);

  const userContent = userProfile.toMarkdown();
  const prefix = composePrefix(
    personaContent + (userContent ? "\n\n" + userContent : ""),
    TOOL_DEFINITIONS
  );
  prefix.freeze();

  const guard = new PrefixGuard();
  const context = new ContextManager(config.context);
  const contextMax = config.context?.max_tokens ?? 128000;

  const ctx: ChatContext = {
    prefix,
    persona,
    memory,
    world,
    api,
    guard,
    context,
    summary,
    dream,
    search: memorySearch,
    userProfile,
    contextMax,
    adapter,
    correct,
  };
  await chatLoop(ctx);
}

process.on("unhandledRejection", (reason) => {
  console.error("未捕获的 Promise 错误:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("未捕获的异常:", err);
});

process.on("exit", (code) => {
  console.error(`进程退出，code=${code}`);
});

process.on("SIGTERM", () => {
  console.error("收到 SIGTERM");
  process.exit(0);
});

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
