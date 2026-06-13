import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import type { UserProfile, IUserProfile } from "../core/types";
import type { DeepSeekClient, ChatMessage } from "../api/deepseek";
import { ensureDir } from "../utils/fs";

export type { UserProfile } from "../core/types";

const ANALYZE_PROMPT = `你是用户画像分析师。基于以下对话记录，提取关于**用户本人**的真实特征。

对话记录：
{conversationText}

当前画像（如有）：
{currentProfile}

提取维度：
1. 基本信息：用户的名字/自称（不是角色名）
2. 偏好：用户的审美偏好、内容偏好、交互偏好
3. 习惯：用户的使用习惯、交流模式
4. 情绪模式：用户常见的情绪状态
5. 常聊话题：用户经常讨论的话题（不是角色台词）

关键规则：
- 只提取**用户本人**的特征，忽略角色扮演中的台词
- 如果是角色扮演对话，推断的是"用户喜欢什么样的角色/场景"，不是角色说了什么
- 与当前画像不矛盾的信息不要重复添加
- 每个维度最多 5 条，精炼准确
- 如果某个维度没有新信息，输出空数组

输出严格 JSON：
{
  "name": "用户的名字（如果没提到就留空）",
  "preferences": ["偏1", "偏2"],
  "habits": ["习惯1"],
  "emotions": ["情绪1"],
  "topics": ["话题1", "话题2"]
}`;

export class UserProfileManager implements IUserProfile {
  private profilePath: string;
  private profile: UserProfile;
  private api?: DeepSeekClient;

  constructor(dataDir: string, api?: DeepSeekClient) {
    this.profilePath = resolve(process.cwd(), dataDir, "USER.md");
    this.profile = this.load();
    this.api = api;
  }

  private load(): UserProfile {
    const defaultProfile: UserProfile = {
      name: "",
      preferences: [],
      habits: [],
      emotions: [],
      topics: [],
      lastUpdated: "",
    };

    if (!existsSync(this.profilePath)) {
      return defaultProfile;
    }

    try {
      const content = readFileSync(this.profilePath, "utf-8");
      return this.parseMarkdown(content) ?? defaultProfile;
    } catch {
      return defaultProfile;
    }
  }

  private parseMarkdown(content: string): UserProfile | null {
    const profile: UserProfile = {
      name: "",
      preferences: [],
      habits: [],
      emotions: [],
      topics: [],
      lastUpdated: "",
    };

    let currentSection = "";

    for (const line of content.split("\n")) {
      const trimmed = line.trim();

      if (trimmed.startsWith("# 用户画像")) {
        continue;
      }

      const sectionMatch = trimmed.match(/^## (.+)$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1] ?? "";
        continue;
      }

      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        const item = trimmed.slice(2).trim();
        if (!item) continue;

        switch (currentSection) {
          case "基本信息":
            profile.name = item;
            break;
          case "偏好":
            profile.preferences.push(item);
            break;
          case "习惯":
            profile.habits.push(item);
            break;
          case "情绪模式":
            profile.emotions.push(item);
            break;
          case "常聊话题":
            profile.topics.push(item);
            break;
        }
      }

      const updatedMatch = trimmed.match(/^更新时间:\s*(.+)$/);
      if (updatedMatch) {
        profile.lastUpdated = updatedMatch[1] ?? "";
      }
    }

    return profile;
  }

  async analyzeConversations(conversations: { role: string; content: string }[]): Promise<Partial<UserProfile>> {
    if (!this.api || conversations.length === 0) {
      return {};
    }

    const conversationText = conversations
      .map((e) => `${e.role === "user" ? "用户" : "AI"}: ${e.content}`)
      .join("\n");

    const currentProfile = this.toMarkdown() || "（暂无画像）";
    const prompt = ANALYZE_PROMPT
      .replace("{conversationText}", conversationText)
      .replace("{currentProfile}", currentProfile);

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const raw = await this.api.collect(messages, 2048);

    try {
      const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonStr = codeBlockMatch ? codeBlockMatch[1]!.trim() : raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
      const parsed = JSON.parse(jsonStr) as Partial<UserProfile>;

      // 验证并清理
      const result: Partial<UserProfile> = {};
      if (parsed.name && typeof parsed.name === "string") result.name = parsed.name;
      if (Array.isArray(parsed.preferences)) result.preferences = parsed.preferences.filter((s) => typeof s === "string" && s.trim());
      if (Array.isArray(parsed.habits)) result.habits = parsed.habits.filter((s) => typeof s === "string" && s.trim());
      if (Array.isArray(parsed.emotions)) result.emotions = parsed.emotions.filter((s) => typeof s === "string" && s.trim());
      if (Array.isArray(parsed.topics)) result.topics = parsed.topics.filter((s) => typeof s === "string" && s.trim());

      return result;
    } catch {
      console.error("[UserProfile] LLM 输出解析失败:", raw.slice(0, 200));
      return {};
    }
  }

  update(newData: Partial<UserProfile>): void {
    if (newData.name && !this.profile.name) {
      this.profile.name = newData.name;
    }

    if (newData.preferences) {
      for (const p of newData.preferences) {
        if (!this.profile.preferences.includes(p)) {
          this.profile.preferences.push(p);
        }
      }
    }

    if (newData.habits) {
      for (const h of newData.habits) {
        if (!this.profile.habits.includes(h)) {
          this.profile.habits.push(h);
        }
      }
    }

    if (newData.emotions) {
      for (const e of newData.emotions) {
        if (!this.profile.emotions.includes(e)) {
          this.profile.emotions.push(e);
        }
      }
    }

    if (newData.topics) {
      for (const t of newData.topics) {
        if (!this.profile.topics.includes(t)) {
          this.profile.topics.push(t);
        }
      }
    }

    // 限制每个维度最多 10 条
    this.profile.preferences = this.profile.preferences.slice(-10);
    this.profile.habits = this.profile.habits.slice(-10);
    this.profile.emotions = this.profile.emotions.slice(-10);
    this.profile.topics = this.profile.topics.slice(-10);

    this.profile.lastUpdated = new Date().toISOString();
    this.save();
  }

  getProfile(): UserProfile {
    return { ...this.profile };
  }

  toMarkdown(): string {
    const lines: string[] = ["# 用户画像", ""];

    if (this.profile.name) {
      lines.push("## 基本信息");
      lines.push(`- ${this.profile.name}`);
      lines.push("");
    }

    if (this.profile.preferences.length > 0) {
      lines.push("## 偏好");
      for (const p of this.profile.preferences) {
        lines.push(`- ${p}`);
      }
      lines.push("");
    }

    if (this.profile.habits.length > 0) {
      lines.push("## 习惯");
      for (const h of this.profile.habits) {
        lines.push(`- ${h}`);
      }
      lines.push("");
    }

    if (this.profile.emotions.length > 0) {
      lines.push("## 情绪模式");
      for (const e of this.profile.emotions) {
        lines.push(`- ${e}`);
      }
      lines.push("");
    }

    if (this.profile.topics.length > 0) {
      lines.push("## 常聊话题");
      for (const t of this.profile.topics) {
        lines.push(`- ${t}`);
      }
      lines.push("");
    }

    if (this.profile.lastUpdated) {
      lines.push(`更新时间: ${this.profile.lastUpdated}`);
    }

    const result = lines.join("\n").trim();
    if (result === "# 用户画像" || result === "") return "";
    return result;
  }

  save(): void {
    ensureDir(dirname(this.profilePath));
    writeFileSync(this.profilePath, this.toMarkdown(), "utf-8");
  }
}
