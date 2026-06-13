import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import type { UserProfile, IUserProfile } from "../core/types";
import { STOP_WORDS } from "../utils/stopwords";
import { ensureDir } from "../utils/fs";

export type { UserProfile } from "../core/types";

export class UserProfileManager implements IUserProfile {
  private profilePath: string;
  private profile: UserProfile;

  constructor(dataDir: string) {
    this.profilePath = resolve(process.cwd(), dataDir, "USER.md");
    this.profile = this.load();
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

  analyzeNotes(notes: string[]): Partial<UserProfile> {
    const result: Partial<UserProfile> = {
      preferences: [],
      habits: [],
      emotions: [],
      topics: [],
    };

    const allText = notes.join("\n");

    const namePatterns = [
      /我叫([\u4e00-\u9fa5a-zA-Z]{1,10})/,
      /我是([\u4e00-\u9fa5a-zA-Z]{1,10})/,
      /叫我([\u4e00-\u9fa5a-zA-Z]{1,10})/,
    ];

    for (const pattern of namePatterns) {
      const match = allText.match(pattern);
      if (match?.[1]) {
        result.name = match[1];
        break;
      }
    }

    const preferencePatterns = [
      /喜欢([\u4e00-\u9fa5a-zA-Z0-9]{2,20})/g,
      /爱([\u4e00-\u9fa5a-zA-Z0-9]{2,20})/g,
      /偏好([\u4e00-\u9fa5a-zA-Z0-9]{2,20})/g,
    ];

    for (const pattern of preferencePatterns) {
      let match;
      while ((match = pattern.exec(allText)) !== null) {
        if (match[1] && !result.preferences!.includes(match[1])) {
          result.preferences!.push(match[1]);
        }
      }
    }

    const habitPatterns = [
      /每天([\u4e00-\u9fa5a-zA-Z0-9]{2,20})/g,
      /经常([\u4e00-\u9fa5a-zA-Z0-9]{2,20})/g,
      /总是([\u4e00-\u9fa5a-zA-Z0-9]{2,20})/g,
    ];

    for (const pattern of habitPatterns) {
      let match;
      while ((match = pattern.exec(allText)) !== null) {
        if (match[1] && !result.habits!.includes(match[1])) {
          result.habits!.push(match[1]);
        }
      }
    }

    const emotionKeywords = ["开心", "难过", "累", "烦", "兴奋", "焦虑", "生气", "高兴", "伤心", "紧张", "放松", "无聊", "期待", "失望"];
    for (const keyword of emotionKeywords) {
      if (allText.includes(keyword) && !result.emotions!.includes(keyword)) {
        result.emotions!.push(keyword);
      }
    }

    const wordCounts = new Map<string, number>();
    const segments = allText.split(/[\s,，。！？、；：""''（）()\[\]【】\n\r]+/).filter(Boolean);
    for (const segment of segments) {
      for (let size = 2; size <= 4; size++) {
        for (let i = 0; i <= segment.length - size; i++) {
          const gram = segment.slice(i, i + size);
          if (/[\u4e00-\u9fa5]/.test(gram)) {
            wordCounts.set(gram, (wordCounts.get(gram) ?? 0) + 1);
          }
        }
      }
    }

    for (const [word, count] of wordCounts) {
      if (count >= 3 && !STOP_WORDS.has(word) && word.length >= 2) {
        result.topics!.push(word);
      }
    }

    if (result.preferences!.length === 0) delete result.preferences;
    if (result.habits!.length === 0) delete result.habits;
    if (result.emotions!.length === 0) delete result.emotions;
    if (result.topics!.length === 0) delete result.topics;

    return result;
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