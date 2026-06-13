export function estimateTokens(text: string): number {
  let tokens = 0;

  for (const char of text) {
    if (char.charCodeAt(0) > 0x7f) {
      tokens += 2;
    } else {
      tokens += 0.3;
    }
  }

  return Math.max(Math.ceil(tokens), 1);
}
