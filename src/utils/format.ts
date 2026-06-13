import type { ChatUsage } from "../api/deepseek";

export function calculateHitRate(usage: ChatUsage): string {
  return usage.prompt_tokens > 0
    ? ((usage.cache_hit_tokens / usage.prompt_tokens) * 100).toFixed(1)
    : "0.0";
}

export function formatStatusText(usage: ChatUsage, model: string): string {
  const hitRate = calculateHitRate(usage);
  return `[缓存: ${hitRate}% | 费用: ¥${usage.total_cost_estimate.toFixed(3)} | 模型: ${model}]`;
}
