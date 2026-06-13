import type { ChatMessage, ChatUsage } from "../api/deepseek";
import { estimateTokens } from "../utils/token";

export type CompressionDecision =
  | { action: "none" }
  | { action: "fold"; tailFraction: number }
  | { action: "fold_aggressive"; tailFraction: number }
  | { action: "force_summary" };

export class ContextManager {
  private foldThreshold: number;
  private foldAggressiveThreshold: number;
  private forceSummaryThreshold: number;
  private tailFraction: number;
  private tailFractionAggressive: number;
  private alreadyFoldedThisTurn: boolean = false;

  constructor(config: {
    fold_threshold: number;
    fold_aggressive_threshold: number;
    force_summary_threshold: number;
    tail_fraction: number;
    tail_fraction_aggressive: number;
  }) {
    this.foldThreshold = config.fold_threshold;
    this.foldAggressiveThreshold = config.fold_aggressive_threshold;
    this.forceSummaryThreshold = config.force_summary_threshold;
    this.tailFraction = config.tail_fraction;
    this.tailFractionAggressive = config.tail_fraction_aggressive;
  }

  private estimateTotalTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
  }

  private decide(ratio: number): CompressionDecision {
    if (ratio > this.forceSummaryThreshold) {
      return { action: "force_summary" };
    }
    if (ratio > this.foldAggressiveThreshold) {
      return { action: "fold_aggressive", tailFraction: this.tailFractionAggressive };
    }
    if (ratio > this.foldThreshold) {
      return { action: "fold", tailFraction: this.tailFraction };
    }
    return { action: "none" };
  }

  checkBeforeTurn(messages: ChatMessage[], contextMax: number): CompressionDecision {
    const ratio = this.estimateTotalTokens(messages) / contextMax;
    const decision = this.decide(ratio);
    if (decision.action !== "none") {
      this.alreadyFoldedThisTurn = true;
    }
    return decision;
  }

  checkAfterTurn(usage: ChatUsage, contextMax: number): CompressionDecision {
    if (this.alreadyFoldedThisTurn) {
      return { action: "none" };
    }
    const ratio = usage.prompt_tokens / contextMax;
    const decision = this.decide(ratio);
    if (decision.action !== "none") {
      this.alreadyFoldedThisTurn = true;
    }
    return decision;
  }

  resetTurn(): void {
    this.alreadyFoldedThisTurn = false;
  }
}
