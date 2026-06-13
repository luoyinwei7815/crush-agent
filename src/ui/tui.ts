import * as readline from "readline";
import chalk from "chalk";
import type { ChatUsage } from "../api/deepseek";
import type { OutputAdapter } from "./adapter";
import { formatStatusText } from "../utils/format";

export class TerminalAdapter implements OutputAdapter {
  private rl: readline.Interface;
  private characterName: string = "AI";

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  writeChunk(content: string): void {
    process.stdout.write(content);
  }

  startAssistant(): void {
    process.stdout.write(chalk.magenta(`${this.characterName}: `));
  }

  setCharacterName(name: string): void {
    this.characterName = name;
  }

  endAssistant(): void {
    console.log();
  }

  printSystem(text: string): void {
    console.log(chalk.yellow(text));
  }

  printStatus(usage: ChatUsage, model: string): void {
    console.log(chalk.gray(formatStatusText(usage, model)));
  }

  printError(text: string): void {
    console.log(chalk.red(`[错误] ${text}`));
  }

  readInput(): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(chalk.cyan("你: "), (answer) => {
        resolve(answer.trim());
      });
    });
  }

  close(): void {
    this.rl.close();
  }
}
