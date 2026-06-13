import { existsSync, readdirSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { IDailyNotes } from "../core/types";
import { ensureDir } from "../utils/fs";

export class DailyNotes implements IDailyNotes {
  private dir: string;

  constructor(dir: string) {
    this.dir = resolve(process.cwd(), dir);

    ensureDir(this.dir);
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private getTodayFilePath(): string {
    return join(this.dir, `${this.getTodayDate()}.md`);
  }

  private getTimestamp(): string {
    return new Date().toLocaleTimeString("zh-CN", { hour12: false });
  }

  append(content: string): void {
    const filePath = this.getTodayFilePath();
    const timestamp = this.getTimestamp();

    if (!existsSync(filePath)) {
      const header = `# ${this.getTodayDate()}\n\n`;
      writeFileSync(filePath, header, "utf-8");
    }

    const line = `- ${timestamp} ${content}\n`;
    appendFileSync(filePath, line, "utf-8");
  }

  today(): string {
    const filePath = this.getTodayFilePath();
    if (!existsSync(filePath)) {
      return "";
    }
    return readFileSync(filePath, "utf-8");
  }

  recent(days: number): string[] {
    const files = this.listFiles();
    const recentFiles = files.slice(0, days);

    return recentFiles.map((file) => {
      try {
        return readFileSync(file, "utf-8");
      } catch {
        return "";
      }
    });
  }

  listFiles(): string[] {
    if (!existsSync(this.dir)) {
      return [];
    }

    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .map((f) => join(this.dir, f));

    return files;
  }
}
