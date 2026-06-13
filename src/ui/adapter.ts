import type { ChatUsage } from "../api/deepseek";

export interface OutputAdapter {
  writeChunk(content: string): void;
  startAssistant(): void;
  endAssistant(): void;
  printSystem(text: string): void;
  printStatus(usage: ChatUsage, model: string): void;
  printError(text: string): void;
  readInput(): Promise<string>;
  close(): void;
  setCharacterName(name: string): void;
}
