import type { IMemory, MemoryEntry } from "../core/types";
import { STOP_WORDS } from "../utils/stopwords";

interface IndexEntry {
  memoryName: string;
  field: string;
  score: number;
}

const FIELD_WEIGHTS: Record<string, number> = {
  title: 3,
  description: 2,
  body: 1,
};

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const segments = text.split(/[\s,，。！？、；：""''（）()\[\]【】\n\r]+/).filter(Boolean);

  for (const segment of segments) {
    const hasChinese = /[\u4e00-\u9fa5]/.test(segment);

    if (hasChinese) {
      for (let size = 2; size <= 4; size++) {
        for (let i = 0; i <= segment.length - size; i++) {
          const gram = segment.slice(i, i + size);
          if (/[\u4e00-\u9fa5]/.test(gram) && !STOP_WORDS.has(gram)) {
            tokens.push(gram);
          }
        }
      }
    }

    const words = segment.split(/\s+/).filter(Boolean);
    for (const word of words) {
      const lower = word.toLowerCase();
      if (lower.length > 0 && !STOP_WORDS.has(lower) && !tokens.includes(lower)) {
        tokens.push(lower);
      }
    }
  }

  return [...new Set(tokens)];
}

export class MemorySearch {
  private store: IMemory;
  private index: Map<string, IndexEntry[]> = new Map();

  constructor(store: IMemory) {
    this.store = store;
  }

  buildIndex(): void {
    this.index.clear();
    const memories = this.store.list();
    for (const memory of memories) {
      this.addMemory(memory);
    }
  }

  addMemory(memory: MemoryEntry): void {
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const text = memory[field as keyof MemoryEntry];
      if (typeof text !== "string") continue;

      const tokens = tokenize(text);
      for (const token of tokens) {
        const existing = this.index.get(token);
        const entry: IndexEntry = {
          memoryName: memory.name,
          field,
          score: weight,
        };

        if (existing) {
          existing.push(entry);
        } else {
          this.index.set(token, [entry]);
        }
      }
    }
  }

  removeMemory(name: string): void {
    for (const [key, entries] of this.index) {
      const filtered = entries.filter((e) => e.memoryName !== name);
      if (filtered.length === 0) {
        this.index.delete(key);
      } else {
        this.index.set(key, filtered);
      }
    }
  }

  search(query: string, limit = 5): MemoryEntry[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scoreMap = new Map<string, number>();

    for (const token of queryTokens) {
      const entries = this.index.get(token);
      if (!entries) continue;

      for (const entry of entries) {
        const current = scoreMap.get(entry.memoryName) ?? 0;
        scoreMap.set(entry.memoryName, current + entry.score);
      }
    }

    const sorted = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]);

    const results: MemoryEntry[] = [];
    for (const [name] of sorted.slice(0, limit)) {
      const memory = this.store.get(name);
      if (memory) {
        results.push(memory);
      }
    }

    return results;
  }
}
