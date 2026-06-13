import { createHash } from "crypto";
import type { ChatMessage } from "../api/deepseek";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export class ImmutablePrefix {
  private readonly system: string;
  private readonly toolSpecs: readonly ToolSpec[];
  private readonly fewShots: readonly ChatMessage[];
  private readonly fingerprint: string;
  private frozen: boolean = false;

  constructor(system: string, tools?: ToolSpec[], fewShots?: ChatMessage[]) {
    this.system = system;
    this.toolSpecs = Object.freeze(tools ? [...tools] : []);
    this.fewShots = Object.freeze(fewShots ? [...fewShots] : []);
    this.fingerprint = this.computeFingerprint();
  }

  private computeFingerprint(): string {
    const data = JSON.stringify({
      system: this.system,
      tools: this.toolSpecs,
      fewShots: this.fewShots,
    });
    return createHash("sha256").update(data).digest("hex").slice(0, 16);
  }

  freeze(): void {
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  getFingerprint(): string {
    return this.fingerprint;
  }

  toMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [
      { role: "system", content: this.system },
    ];

    for (const fewShot of this.fewShots) {
      messages.push(fewShot);
    }

    return messages;
  }
}
