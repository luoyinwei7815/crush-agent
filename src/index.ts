import { readFileSync } from "fs";
import { resolve } from "path";
import * as yaml from "js-yaml";
import chalk from "chalk";
import { DeepSeekClient } from "./api/deepseek";
import { composePrefix } from "./prefix/compose";
import { PrefixGuard } from "./prefix/guard";
import { ContextManager } from "./context/manager";
import { MemoryStore } from "./memory/store";
import { DailyNotes } from "./memory/daily";
import { DreamSystem } from "./memory/dream";
import { MemorySearch } from "./memory/search";
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
  let setupResult: { api_key: string; base_url: string; model: string } | undefined;
  if (needsSetup()) {
    setupResult = await runSetup();
  }

  const { web, port } = parseArgs();
  const configPath = resolve(process.cwd(), "config.yaml");
  const config = yaml.load(readFileSync(configPath, "utf-8")) as AppConfig;

  const persona = new PersonaLoader("data");
  const world = new WorldEngine("data/world/entries.json", 2000);

  if (!persona.exists()) {
    const initResult = await runInit(
      config.api.key,
      config.api.base_url
    );
    persona.replaceAll(initResult.persona);

    for (const entry of initResult.worldEntries) {
      world.addEntry(entry);
    }

    console.log(chalk.green("\n初始化完成！开始聊天吧~\n"));
  }

  const api = new DeepSeekClient({
    base_url: config.api.base_url,
    key: config.api.key,
    model: config.api.model,
  });

  const correct = new CorrectEngine(api);

  const personaContent = persona.compose();

  const memory = new MemoryStore("data/memory/facts");
  const daily = new DailyNotes("data/memory/daily");
  const userProfile = new UserProfileManager("data");
  const memorySearch = new MemorySearch(memory);
  memorySearch.buildIndex();
  const dream = new DreamSystem(memory, daily, {
    min_score: config.memory.dream.min_score,
    min_recurrence: config.memory.dream.min_recurrence,
  }, userProfile, api);

  const userContent = userProfile.toMarkdown();
  const prefix = composePrefix(
    personaContent + (userContent ? "\n\n" + userContent : ""),
    TOOL_DEFINITIONS
  );
  prefix.freeze();

  const guard = new PrefixGuard();
  const context = new ContextManager(config.context);
  const contextMax = config.context?.max_tokens ?? 128000;

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
    adapter = new WebAdapter(server);
  } else {
    adapter = new TerminalAdapter();
  }

  const ctx: ChatContext = {
    prefix,
    persona,
    memory,
    world,
    api,
    guard,
    context,
    daily,
    dream,
    search: memorySearch,
    userProfile,
    contextMax,
    adapter,
    correct,
  };
  await chatLoop(ctx);
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
