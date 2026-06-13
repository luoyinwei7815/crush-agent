import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { DeepSeekClient, ChatMessage } from "../api/deepseek";
import type { ConversationEntry } from "./conversation";
import { ensureDir } from "../utils/fs";
import { STOP_WORDS } from "../utils/stopwords";

const SUMMARY_INTERVAL_DAYS = 3;

const SUMMARIZE_PROMPT = `你是对话记录员。基于以下对话记录，生成结构化概要。

对话记录：
{conversationText}

概要格式：
1. 主要话题：讨论了什么（3-5 条）
2. 重要事件：发生了什么（按日期）
3. 用户行为模式：观察到的用户习惯/偏好

要求：
- 忠实记录，不添加评价
- 区分"用户说的话"和"角色扮演中的台词"
- 如果是角色扮演对话，记录的是"用户在测试/体验什么功能"，而不是角色台词内容
- 简洁，每条不超过 2 句话`;

export class SummaryMemory {
  private dir: string;
  private api: DeepSeekClient;

  constructor(api: DeepSeekClient) {
    this.dir = resolve(process.cwd(), "data/memory/summaries");
    this.api = api;
    ensureDir(this.dir);
  }

  async summarize(conversations: ConversationEntry[], days: number): Promise<void> {
    if (conversations.length === 0) return;

    const conversationText = conversations
      .map((e) => {
        const date = new Date(e.ts);
        const time = date.toLocaleString("zh-CN", { hour12: false });
        return `[${time}] ${e.role === "user" ? "用户" : "AI"}: ${e.content}`;
      })
      .join("\n");

    const prompt = SUMMARIZE_PROMPT.replace("{conversationText}", conversationText);
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const result = await this.api.collect(messages, 4096);

    const now = new Date();
    const toDate = this.formatDate(now);
    const fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const fromDateStr = this.formatDate(fromDate);
    const displayFrom = `${fromDate.getMonth() + 1}/${fromDate.getDate()}`;
    const displayTo = `${now.getMonth() + 1}/${now.getDate()}`;

    const content = [
      "---",
      `from: ${fromDateStr}`,
      `to: ${toDate}`,
      `created: ${toDate}`,
      "---",
      "",
      `# 对话概要（${displayFrom} ~ ${displayTo}）`,
      "",
      result.trim(),
    ].join("\n");

    const filePath = join(this.dir, `${toDate}.md`);
    writeFileSync(filePath, content, "utf-8");
  }

  getRecent(): string {
    const files = this.listFiles();
    if (files.length === 0) return "";
    try {
      return readFileSync(files[0]!, "utf-8");
    } catch {
      return "";
    }
  }

  getLastSummaryDate(): string | null {
    const files = this.listFiles();
    if (files.length === 0) return null;

    const filename = files[0]!.split(/[\\/]/).pop()!;
    const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    return match?.[1] ?? null;
  }

  needsSummary(): boolean {
    const lastDate = this.getLastSummaryDate();
    if (!lastDate) return true;

    const parts = lastDate.split("-").map(Number);
    const last = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
    const now = new Date();
    const diffDays = (now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000);
    return diffDays >= SUMMARY_INTERVAL_DAYS;
  }

  scanContext(messages: ChatMessage[]): string {
    const files = this.listFiles();
    if (files.length === 0) return "";

    const recentText = messages
      .slice(-6)
      .map((m) => m.content)
      .join(" ")
      .toLowerCase();
    if (!recentText.trim()) return "";

    const segments = recentText
      .split(/[\s,，。！？、；：""''（）()\[\]【】]+/)
      .filter(Boolean);

    const keywords: string[] = [];
    for (const seg of segments) {
      if (/[\u4e00-\u9fa5]/.test(seg)) {
        for (let size = 2; size <= 3; size++) {
          for (let i = 0; i <= seg.length - size; i++) {
            const gram = seg.slice(i, i + size);
            if (/[\u4e00-\u9fa5]/.test(gram) && !STOP_WORDS.has(gram) && !keywords.includes(gram)) {
              keywords.push(gram);
            }
          }
        }
      } else if (seg.length >= 2 && !STOP_WORDS.has(seg)) {
        keywords.push(seg.toLowerCase());
      }
      if (keywords.length >= 15) break;
    }

    if (keywords.length === 0) return "";

    const matched: string[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        const bodyStart = content.indexOf("---", 3);
        if (bodyStart === -1) continue;
        const body = content.slice(bodyStart + 3).trim().toLowerCase();

        const hits = keywords.filter((kw) => body.includes(kw));
        if (hits.length >= 2) {
          matched.push(content);
        }
      } catch {
        continue;
      }
    }

    if (matched.length === 0) return "";

    return `# 历史对话概要\n\n${matched.join("\n\n---\n\n")}`;
  }

  private listFiles(): string[] {
    if (!existsSync(this.dir)) return [];

    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .map((f) => join(this.dir, f));
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
