import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve } from "path";
import type { IPersona } from "../core/types";
import { ensureDir } from "../utils/fs";

export interface PersonaData {
  identity: string;
  style: string;
  emotion: string;
  constraints: string;
  background: string;
}

export class PersonaLoader implements IPersona {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = resolve(process.cwd(), dataDir, "persona");
    ensureDir(this.dir);
  }

  private readOrDefault(filename: string): string {
    const filePath = resolve(this.dir, filename);
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8").trim();
  }

  load(): PersonaData {
    return {
      identity: this.readOrDefault("identity.md"),
      style: this.readOrDefault("style.md"),
      emotion: this.readOrDefault("emotion.md"),
      constraints: this.readOrDefault("constraints.md"),
      background: this.readOrDefault("background.md"),
    };
  }

  compose(): string {
    const data = this.load();
    const parts: string[] = [];

    if (data.identity) parts.push(data.identity);
    if (data.style) parts.push(data.style);
    if (data.emotion) parts.push(data.emotion);
    if (data.constraints) parts.push(data.constraints);
    if (data.background) parts.push(data.background);

    return parts.join("\n\n");
  }

  addConstraint(text: string): void {
    const filePath = resolve(this.dir, "constraints.md");
    const dateStr = new Date().toISOString().split("T")[0] ?? "";
    const line = `\n- ${dateStr}: ${text}`;

    if (!existsSync(filePath)) {
      writeFileSync(filePath, `# 硬约束\n${line}`, "utf-8");
    } else {
      appendFileSync(filePath, line, "utf-8");
    }
  }

  removeConstraint(text: string): void {
    const filePath = resolve(this.dir, "constraints.md");
    if (!existsSync(filePath)) return;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const target = text.trim();
    const filtered = lines.filter((line) => line.trim() !== `- ${target}` && !line.includes(`: ${target}`));
    writeFileSync(filePath, filtered.join("\n"), "utf-8");
  }

  getConstraints(): string {
    return this.readOrDefault("constraints.md");
  }

  readFile(filename: string): string {
    return this.readOrDefault(filename);
  }

  writeFile(filename: string, content: string): void {
    const filePath = resolve(this.dir, filename);
    writeFileSync(filePath, content, "utf-8");
  }

  replaceAll(data: PersonaData): void {
    const files: [string, string][] = [
      ["identity.md", data.identity],
      ["style.md", data.style],
      ["emotion.md", data.emotion],
      ["constraints.md", data.constraints],
      ["background.md", data.background],
    ];

    for (const [filename, content] of files) {
      const filePath = resolve(this.dir, filename);
      writeFileSync(filePath, content, "utf-8");
    }
  }

  exists(): boolean {
    const identityPath = resolve(this.dir, "identity.md");
    return existsSync(identityPath);
  }

  reload(): void {
    // 无缓存设计：compose() 每次都从磁盘读取，所以 reload 不需要做任何事。
    // 此方法保留是为了满足 IPersona 接口契约，调用者可以安全地调用。
  }

  getCharacterName(): string {
    const identityPath = resolve(this.dir, "identity.md");
    if (!existsSync(identityPath)) {
      return "AI";
    }

    try {
      const content = readFileSync(identityPath, "utf-8");
      const nameMatch = content.match(/名字[：:]\s*([^\n]+)/);
      if (nameMatch?.[1]) {
        return nameMatch[1].trim();
      }

      const identityMatch = content.match(/## 身份\n-\s*([^\n]+)/);
      if (identityMatch?.[1]) {
        const firstWord = identityMatch[1].split(/[，,、\s]/)[0];
        if (firstWord) {
          return firstWord;
        }
      }

      return "AI";
    } catch {
      return "AI";
    }
  }
}
