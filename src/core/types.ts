import type { ChatMessage } from "../api/deepseek";
import type { DeepSeekClient } from "../api/deepseek";
import type { ImmutablePrefix } from "../prefix/immutable";
import type { PrefixGuard } from "../prefix/guard";
import type { ContextManager } from "../context/manager";
import type { DreamSystem } from "../memory/dream";
import type { MemorySearch } from "../memory/search";
import type { OutputAdapter } from "../ui/adapter";
import type { CorrectEngine } from "../persona/correct";

// ========== 记忆条目 ==========
export interface MemoryEntry {
  name: string;
  title: string;
  description: string;
  category: "preference" | "fact" | "emotion" | "plan";
  body: string;
  created: string;
  score: number;
  recurrence: number;
  keywords?: string[];
}

// ========== 人格层接口 ==========
export interface IPersona {
  compose(): string;
  reload(): void;
  exists(): boolean;
  addConstraint(text: string): void;
  removeConstraint(text: string): void;
  getConstraints(): string;
  readFile(filename: string): string;
  writeFile(filename: string, content: string): void;
  getCharacterName(): string;
}

// ========== 记忆层接口 ==========
export interface IMemory {
  getIndex(): string;
  scanContext(messages: ChatMessage[], tokenBudget?: number): string;
  save(memory: MemoryEntry): string;
  get(name: string): MemoryEntry | null;
  list(): MemoryEntry[];
  delete(name: string): void;
  reindex(): void;
}

// ========== 每日笔记接口 ==========
export interface IDailyNotes {
  append(content: string): void;
  today(): string;
  recent(days: number): string[];
  listFiles(): string[];
}

// ========== 用户画像接口 ==========
export interface UserProfile {
  name: string;
  preferences: string[];
  habits: string[];
  emotions: string[];
  topics: string[];
  lastUpdated: string;
}

export interface IUserProfile {
  analyzeNotes(notes: string[]): Partial<UserProfile>;
  update(newData: Partial<UserProfile>): void;
  getProfile(): UserProfile;
  toMarkdown(): string;
  save(): void;
}

// ========== 世界书接口 ==========
export interface WorldEntry {
  uid: string;
  key: string[];
  content: string;
  constant: boolean;
  order: number;
  weight: number;
}

export interface IWorld {
  scanContext(messages: ChatMessage[], scanDepth?: number): string;
  addEntry(entry: Omit<WorldEntry, "uid">): string;
  removeEntry(uid: string): void;
  listEntries(): WorldEntry[];
  reload(): void;
}

// ========== 对话上下文 ==========
export interface ChatContext {
  prefix: ImmutablePrefix;
  persona: IPersona;
  memory: IMemory;
  world: IWorld;
  api: DeepSeekClient;
  guard: PrefixGuard;
  context: ContextManager;
  daily: IDailyNotes;
  dream: DreamSystem;
  search?: MemorySearch;
  userProfile?: IUserProfile;
  contextMax: number;
  adapter: OutputAdapter;
  correct: CorrectEngine;
}
