import { createHash } from "crypto";
import type { ChatMessage } from "../api/deepseek";

export class PrefixGuard {
  private history: string[] = [];
  private totalChecks: number = 0;
  private changeCount: number = 0;

  private hashSystem(messages: ChatMessage[]): string {
    const systemMessages = messages.filter((m) => m.role === "system");
    if (systemMessages.length === 0) {
      return "";
    }
    const combined = systemMessages.map((m) => m.content).join("\n---\n");
    return createHash("sha256")
      .update(combined)
      .digest("hex")
      .slice(0, 16);
  }

  check(messages: ChatMessage[]): { stable: boolean; reason?: string } {
    const currentHash = this.hashSystem(messages);
    this.totalChecks++;

    if (this.history.length === 0) {
      this.history.push(currentHash);
      return { stable: true };
    }

    const lastHash = this.history[this.history.length - 1];

    if (currentHash === lastHash) {
      return { stable: true };
    }

    this.history.push(currentHash);
    this.changeCount++;
    return {
      stable: false,
      reason: `Prefix changed: ${lastHash} -> ${currentHash}`,
    };
  }

  diagnostics(): { hitRate: number; changes: string[]; totalChecks: number; changeCount: number } {
    const changes: string[] = [];
    for (let i = 1; i < this.history.length; i++) {
      changes.push(`${this.history[i - 1]} -> ${this.history[i]}`);
    }

    const hitRate = this.totalChecks > 0
      ? (this.totalChecks - this.changeCount) / this.totalChecks
      : 1;

    return { hitRate, changes, totalChecks: this.totalChecks, changeCount: this.changeCount };
  }

  reset(): void {
    this.history = [];
    this.totalChecks = 0;
    this.changeCount = 0;
  }
}
