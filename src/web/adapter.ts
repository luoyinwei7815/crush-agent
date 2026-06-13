import type { ChatUsage } from "../api/deepseek";
import type { OutputAdapter } from "../ui/adapter";
import type { WebServer } from "./server";
import { formatStatusText } from "../utils/format";

export class WebAdapter implements OutputAdapter {
  private server: WebServer;
  private characterName: string = "AI";

  constructor(server: WebServer) {
    this.server = server;
  }

  writeChunk(content: string): void {
    this.server.broadcast({ type: "chunk", content });
  }

  startAssistant(): void {
    this.server.broadcast({ type: "start", content: "" });
  }

  endAssistant(): void {
    this.server.broadcast({ type: "end", content: "" });
  }

  printSystem(text: string): void {
    this.server.broadcast({ type: "system", content: text });
  }

  printStatus(usage: ChatUsage, model: string): void {
    this.server.broadcast({ type: "status", content: formatStatusText(usage, model) });
  }

  printError(text: string): void {
    this.server.broadcast({ type: "error", content: text });
  }

  readInput(): Promise<string> {
    return this.server.waitForInput();
  }

  close(): void {
    this.server.stop();
  }

  setCharacterName(name: string): void {
    this.characterName = name;
    this.server.broadcast({ type: "config", content: JSON.stringify({ characterName: name }) });
  }
}
