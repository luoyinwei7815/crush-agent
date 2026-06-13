import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import type { IWorld, WorldEntry as IWorldEntry } from "../core/types";
import { estimateTokens } from "../utils/token";
import { ensureDir } from "../utils/fs";

interface WorldBook {
  entries: Record<string, IWorldEntry>;
  name: string;
}

export class WorldEngine implements IWorld {
  private bookPath: string;
  private book: WorldBook;
  private tokenBudget: number;

  constructor(bookPath: string, tokenBudget = 2000) {
    this.bookPath = resolve(process.cwd(), bookPath);
    this.tokenBudget = tokenBudget;
    this.book = { entries: {}, name: "default" };
    this.load();
  }

  load(): void {
    if (!existsSync(this.bookPath)) {
      ensureDir(dirname(this.bookPath));
      this.save();
      return;
    }

    try {
      const content = readFileSync(this.bookPath, "utf-8");
      this.book = JSON.parse(content);
    } catch {
      this.book = { entries: {}, name: "default" };
    }
  }

  private save(): void {
    writeFileSync(this.bookPath, JSON.stringify(this.book, null, 2), "utf-8");
  }

  private scan(messages: { role: string; content: string }[], scanDepth = 6): IWorldEntry[] {
    const recentMessages = messages.slice(-scanDepth);
    const scanText = recentMessages.map((m) => m.content).join(" ");
    const scanTextLower = scanText.toLowerCase();

    const allEntries = Object.values(this.book.entries);
    const matched: IWorldEntry[] = [];

    for (const entry of allEntries) {
      if (entry.constant) {
        matched.push(entry);
        continue;
      }

      const hit = entry.key.some((k) => scanTextLower.includes(k.toLowerCase()));
      if (hit) {
        matched.push(entry);
      }
    }

    matched.sort((a, b) => {
      const scoreA = a.order * 0.7 + a.weight * 0.3;
      const scoreB = b.order * 0.7 + b.weight * 0.3;
      return scoreB - scoreA;
    });

    const result: IWorldEntry[] = [];
    let totalTokens = 0;

    for (const entry of matched) {
      const entryTokens = estimateTokens(entry.content);
      if (totalTokens + entryTokens > this.tokenBudget) break;
      result.push(entry);
      totalTokens += entryTokens;
    }

    return result;
  }

  private formatEntries(entries: IWorldEntry[]): string {
    if (entries.length === 0) return "";
    const parts = entries.map((e) => e.content);
    return `\n# 世界设定\n\n${parts.join("\n\n")}`;
  }

  addEntry(entry: Omit<IWorldEntry, "uid">): string {
    const uid = crypto.randomUUID().slice(0, 8);
    this.book.entries[uid] = { ...entry, uid };
    this.save();
    return uid;
  }

  removeEntry(uid: string): void {
    delete this.book.entries[uid];
    this.save();
  }

  listEntries(): IWorldEntry[] {
    return Object.values(this.book.entries);
  }

  reload(): void {
    this.load();
  }

  scanContext(messages: { role: string; content: string }[], scanDepth = 6): string {
    const entries = this.scan(messages, scanDepth);
    return this.formatEntries(entries);
  }
}
