import { existsSync, appendFileSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { ensureDir } from "../utils/fs";

interface ConversationEntry {
  ts: string;
  role: "user" | "assistant";
  content: string;
}

export type { ConversationEntry };

export class ConversationStore {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = resolve(process.cwd(), dataDir, "conversations");
    ensureDir(this.dir);
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private getTodayPath(): string {
    return join(this.dir, `${this.getTodayDate()}.jsonl`);
  }

  append(role: "user" | "assistant", content: string): void {
    const entry: ConversationEntry = {
      ts: new Date().toISOString(),
      role,
      content,
    };
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.getTodayPath(), line, "utf-8");
  }

  getRecent(minutes: number): ConversationEntry[] {
    if (!existsSync(this.dir)) return [];
    const cutoff = Date.now() - minutes * 60 * 1000;
    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();

    const entries: ConversationEntry[] = [];
    for (const file of files) {
      const content = readFileSync(join(this.dir, file), "utf-8");
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry: ConversationEntry = JSON.parse(line);
          const entryTime = new Date(entry.ts).getTime();
          if (entryTime >= cutoff) {
            entries.push(entry);
          }
        } catch {
          continue;
        }
      }
    }
    return entries;
  }

  getToday(): ConversationEntry[] {
    const filePath = this.getTodayPath();
    if (!existsSync(filePath)) {
      return [];
    }
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter(Boolean)
      .reduce<ConversationEntry[]>((acc, line) => {
        try {
          acc.push(JSON.parse(line));
        } catch {
        }
        return acc;
      }, []);
  }
}
