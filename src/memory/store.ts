import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join, resolve } from "path";
import * as yaml from "js-yaml";
import type { IMemory, MemoryEntry } from "../core/types";
import type { ChatMessage } from "../api/deepseek";
import { estimateTokens } from "../utils/token";
import { ensureDir } from "../utils/fs";

// Memory 类型已统一为 MemoryEntry（来自 core/types.ts）

interface MemoryFrontmatter {
  name: string;
  title: string;
  description: string;
  category: string;
  created: string;
  score: number;
  recurrence: number;
  keywords?: string[];
}

export class MemoryStore implements IMemory {
  private dir: string;
  private indexPath: string;

  constructor(dir: string) {
    this.dir = resolve(process.cwd(), dir);
    this.indexPath = resolve(process.cwd(), "data/MEMORY.md");

    ensureDir(this.dir);
    ensureDir(join(this.dir, ".archive"));
  }

  private parseFrontmatter(content: string): { frontmatter: MemoryFrontmatter; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      throw new Error("Invalid frontmatter format");
    }

    const frontmatter = yaml.load(match[1]!) as MemoryFrontmatter;
    const body = match[2]!.trim();

    return { frontmatter, body };
  }

  private serializeMemory(memory: MemoryEntry): string {
    const frontmatter: MemoryFrontmatter = {
      name: memory.name,
      title: memory.title,
      description: memory.description,
      category: memory.category,
      created: memory.created,
      score: memory.score,
      recurrence: memory.recurrence,
    };

    if (memory.keywords && memory.keywords.length > 0) {
      frontmatter.keywords = memory.keywords;
    }

    return `---\n${yaml.dump(frontmatter)}---\n\n${memory.body}`;
  }

  save(memory: MemoryEntry): string {
    const filePath = join(this.dir, `${memory.name}.md`);
    const content = this.serializeMemory(memory);
    writeFileSync(filePath, content, "utf-8");
    this.reindex();
    return filePath;
  }

  delete(name: string): void {
    const filePath = join(this.dir, `${name}.md`);
    if (!existsSync(filePath)) {
      return;
    }

    const archiveDir = join(this.dir, ".archive");
    const archivePath = join(archiveDir, `${name}.md`);
    renameSync(filePath, archivePath);
    this.reindex();
  }

  list(): MemoryEntry[] {
    if (!existsSync(this.dir)) {
      return [];
    }

    const files = readdirSync(this.dir).filter(
      (f) => f.endsWith(".md") && !f.startsWith(".")
    );

    const memories: MemoryEntry[] = [];

    for (const file of files) {
      try {
        const filePath = join(this.dir, file);
        const content = readFileSync(filePath, "utf-8");
        const { frontmatter, body } = this.parseFrontmatter(content);

        memories.push({
          name: frontmatter.name,
          title: frontmatter.title,
          description: frontmatter.description,
          category: frontmatter.category as MemoryEntry["category"],
          body,
          created: frontmatter.created,
          score: frontmatter.score,
          recurrence: frontmatter.recurrence,
          keywords: frontmatter.keywords ?? [],
        });
      } catch {
        continue;
      }
    }

    return memories;
  }

  get(name: string): MemoryEntry | null {
    const filePath = join(this.dir, `${name}.md`);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const { frontmatter, body } = this.parseFrontmatter(content);

      return {
        name: frontmatter.name,
        title: frontmatter.title,
        description: frontmatter.description,
        category: frontmatter.category as MemoryEntry["category"],
        body,
        created: frontmatter.created,
        score: frontmatter.score,
        recurrence: frontmatter.recurrence,
        keywords: frontmatter.keywords ?? [],
      };
    } catch {
      return null;
    }
  }

  getIndex(): string {
    const memories = this.list();
    if (memories.length === 0) {
      return "";
    }

    const lines = memories.map(
      (m) => `- [${m.title}](${m.name}.md): ${m.description}`
    );

    return lines.join("\n");
  }

  reindex(): string {
    const index = this.getIndex();
    writeFileSync(this.indexPath, `# 长期记忆\n\n${index}`, "utf-8");
    return index;
  }

  /**
   * 轻量级记忆扫描：每轮对话自动注入相关记忆。
   *
   * 与 MemorySearch（倒排索引 + ngram）不同，此方法使用简单的关键词匹配，
   * 专为高频调用场景优化（每轮都执行）。MemorySearch 用于 recall 工具的
   * 主动搜索场景。两者互补，不需要合并。
   */
  scanContext(messages: ChatMessage[], tokenBudget = 1500): string {
    const recentText = messages.slice(-6).map(m => m.content).join(" ").toLowerCase();
    const allMemories = this.list();
    const matched: MemoryEntry[] = [];

    for (const mem of allMemories) {
      if (mem.keywords && mem.keywords.length > 0) {
        const hit = mem.keywords.some(kw => recentText.includes(kw.toLowerCase()));
        if (hit) { matched.push(mem); continue; }
      }
      const titleHit = recentText.includes(mem.title.toLowerCase());
      const descHit = recentText.includes(mem.description.toLowerCase());
      if (titleHit || descHit) { matched.push(mem); }
    }

    if (matched.length === 0) return "";

    matched.sort((a, b) => b.score - a.score);

    let totalTokens = 0;
    const result: string[] = [];
    for (const mem of matched) {
      const text = `- ${mem.title}: ${mem.description}`;
      totalTokens += estimateTokens(text);
      if (totalTokens > tokenBudget) break;
      result.push(text);
    }

    return `# 相关记忆\n\n${result.join("\n")}`;
  }
}
