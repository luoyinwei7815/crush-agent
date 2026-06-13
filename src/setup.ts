import * as readline from "readline";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import * as yaml from "js-yaml";
import chalk from "chalk";
import { question } from "./utils/readline";

export interface SetupResult {
  api_key: string;
  base_url: string;
  model: string;
}

export function needsSetup(): boolean {
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== "sk-xxxx") {
    return false;
  }

  const configPath = resolve(process.cwd(), "config.yaml");
  if (!existsSync(configPath)) {
    return true;
  }
  try {
    const content = readFileSync(configPath, "utf-8");
    const config = yaml.load(content) as any;
    return !config?.api?.key || config.api.key === "sk-xxxx";
  } catch {
    return true;
  }
}

function questionHidden(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((res) => {
    const stdin = process.stdin;
    const oldRawMode = stdin.isRaw;

    process.stdout.write(prompt);

    if (stdin.isTTY) {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf-8");

      let input = "";
      const onData = (char: string) => {
        if (char === "\n" || char === "\r") {
          stdin.setRawMode(oldRawMode ?? false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          res(input.trim());
        } else if (char === "\u0003") {
          process.exit();
        } else if (char === "\u007F" || char === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += char;
          process.stdout.write("*");
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question("", (answer) => {
        res(answer.trim());
      });
    }
  });
}

export async function runSetup(): Promise<SetupResult> {
  if (process.env.DEEPSEEK_API_KEY) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

    const configPath = resolve(process.cwd(), "config.yaml");
    const config = {
      api: { base_url: baseUrl, key: apiKey, model },
      context: { fold_threshold: 0.75, fold_aggressive_threshold: 0.78, force_summary_threshold: 0.80, tail_fraction: 0.2, tail_fraction_aggressive: 0.1 },
      memory: { dream: { min_score: 0.6, min_recurrence: 2 } },
      world: { token_budget: 4000, scan_depth: 8 },
    };
    writeFileSync(configPath, yaml.dump(config), "utf-8");

    console.log(chalk.green("已从环境变量加载配置"));
    return { api_key: apiKey, base_url: baseUrl, model };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.magenta("\n=== Crush Agent - API 配置 ===\n"));

  const apiKey = await questionHidden(rl, chalk.cyan("请输入 API Key: "));

  const baseUrlInput = await question(
    rl,
    chalk.cyan(`API Base URL [https://api.deepseek.com/v1]: `)
  );
  const baseUrl = baseUrlInput || "https://api.deepseek.com/v1";

  console.log(chalk.cyan("\n选择模型:"));
  console.log(chalk.gray("  1. deepseek-v4-flash（日常聊天，便宜）"));
  console.log(chalk.gray("  2. deepseek-v4-pro（更强能力，贵 3 倍）"));
  console.log(chalk.gray("  3. 自定义模型名"));

  const modelChoice = await question(rl, chalk.cyan("请选择 [1]: "));
  let model = "deepseek-v4-flash";
  if (modelChoice === "2") {
    model = "deepseek-v4-pro";
  } else if (modelChoice === "3") {
    model = await question(rl, chalk.cyan("输入自定义模型名: "));
  }

  console.log(chalk.magenta("\n=== 配置确认 ==="));
  console.log(chalk.gray(`API Key: ${apiKey.slice(0, 8)}...`));
  console.log(chalk.gray(`Base URL: ${baseUrl}`));
  console.log(chalk.gray(`模型: ${model}`));

  const confirm = await question(rl, chalk.cyan("\n确认保存？[Y/n]: "));
  if (confirm.toLowerCase() === "n") {
    console.log(chalk.yellow("已取消"));
    process.exit(0);
  }

  const configPath = resolve(process.cwd(), "config.yaml");
  if (!existsSync(configPath)) {
    const defaultConfig = {
      api: { base_url: "https://api.deepseek.com/v1", key: "sk-xxxx", model: "deepseek-v4-flash" },
      context: { fold_threshold: 0.75, fold_aggressive_threshold: 0.78, force_summary_threshold: 0.80, tail_fraction: 0.2, tail_fraction_aggressive: 0.1 },
      memory: { dream: { min_score: 0.6, min_recurrence: 2 } },
      world: { token_budget: 4000, scan_depth: 8 },
    };
    writeFileSync(configPath, yaml.dump(defaultConfig), "utf-8");
  }
  const config = yaml.load(readFileSync(configPath, "utf-8")) as any;
  config.api.key = apiKey;
  config.api.base_url = baseUrl;
  config.api.model = model;
  writeFileSync(configPath, yaml.dump(config), "utf-8");

  rl.close();

  return {
    api_key: apiKey,
    base_url: baseUrl,
    model,
  };
}
