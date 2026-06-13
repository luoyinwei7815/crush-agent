import { ImmutablePrefix, type ToolSpec } from "./immutable";

function formatToolSpecs(tools: ToolSpec[]): string {
  if (tools.length === 0) {
    return "";
  }

  const lines = tools.map((tool) => {
    const params = Object.entries(tool.parameters)
      .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
      .join("\n");
    return `- ${tool.name}: ${tool.description}\n  参数:\n${params}`;
  });

  return lines.join("\n\n");
}

export function composePrefix(
  personaContent: string,
  tools: ToolSpec[]
): ImmutablePrefix {
  const toolSection = formatToolSpecs(tools);

  const systemParts = [personaContent];

  if (toolSection) {
    systemParts.push(`\n\n# 可用工具\n\n${toolSection}`);
  }

  const system = systemParts.join("");
  return new ImmutablePrefix(system, tools);
}
