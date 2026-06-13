import type { ToolSpec } from "../prefix/immutable";
import type { IMemory } from "../core/types";
import type { MemorySearch } from "../memory/search";

export const TOOL_DEFINITIONS: ToolSpec[] = [
  {
    name: "remember",
    description:
      "保存一条重要信息到长期记忆系统。当用户明确说'记住这个'、或对话中出现值得长期保留的信息时调用。",
    parameters: {
      content: {
        type: "string",
        description: "要记住的具体内容",
      },
      title: {
        type: "string",
        description: "一句话标题",
      },
      category: {
        type: "string",
        enum: ["preference", "fact", "emotion", "plan"],
        description: "分类",
      },
      keywords: {
        type: "string",
        description: "触发关键词，逗号分隔。例如：火锅,吃饭,晚餐",
      },
    },
  },
  {
    name: "recall",
    description:
      "搜索过去的记忆。当你需要回忆用户之前说过什么、或需要查找历史信息时调用。",
    parameters: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
    },
  },
  {
    name: "forget",
    description: "删除一条过时或错误的记忆。",
    parameters: {
      name: {
        type: "string",
        description: "记忆的 kebab-case 文件名",
      },
    },
  },
];

export function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function executeTool(
  toolName: string,
  args: Record<string, string>,
  memory: IMemory,
  search?: MemorySearch
): string {
  switch (toolName) {
    case "remember": {
      const content = args.content ?? "";
      const title = args.title ?? content.slice(0, 20);
      const category = (args.category ?? "fact") as "preference" | "fact" | "emotion" | "plan";
      const name = toKebabCase(title);
      const keywords = args.keywords
        ? args.keywords.split(",").map((k: string) => k.trim()).filter(Boolean)
        : [];

      memory.save({
        name,
        title,
        description: content.slice(0, 100),
        category,
        body: content,
        created: new Date().toISOString().split("T")[0] ?? "",
        score: 0.3,
        recurrence: 1,
        keywords,
      });

      if (search) {
        const mem = memory.get(name);
        if (mem) search.addMemory(mem);
      }

      return `已记住: ${title}${keywords.length > 0 ? ` (关键词: ${keywords.join(", ")})` : ""}`;
    }

    case "recall": {
      const query = args.query ?? "";
      if (!query) return "请提供搜索关键词";

      if (search) {
        const results = search.search(query, 5);
        if (results.length === 0) return "没有找到相关记忆";
        return results.map((m) => `- ${m.title}: ${m.description}`).join("\n");
      }

      const lowerQuery = query.toLowerCase();
      const memories = memory.list();
      const matches = memories.filter(
        (m) =>
          m.title.toLowerCase().includes(lowerQuery) ||
          m.description.toLowerCase().includes(lowerQuery) ||
          m.body.toLowerCase().includes(lowerQuery)
      );

      if (matches.length === 0) return "没有找到相关记忆";
      return matches.slice(0, 5).map((m) => `- ${m.title}: ${m.description}`).join("\n");
    }

    case "forget": {
      const name = args.name ?? "";
      if (!name) return "请提供记忆名称";

      memory.delete(name);
      if (search) search.removeMemory(name);
      return `已删除记忆: ${name}`;
    }

    default:
      return `未知工具: ${toolName}`;
  }
}

export function parseToolCall(content: string): { name: string; args: Record<string, string> } | null {
  const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
  const match = content.match(jsonBlockRegex);

  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.tool && typeof parsed.tool === "string" && parsed.args && typeof parsed.args === "object") {
      return {
        name: parsed.tool,
        args: parsed.args as Record<string, string>,
      };
    }
  } catch {
    return null;
  }

  return null;
}
