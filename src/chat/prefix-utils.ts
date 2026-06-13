import { composePrefix } from "../prefix/compose";
import { TOOL_DEFINITIONS } from "./tools";
import type { ImmutablePrefix } from "../prefix/immutable";
import type { PrefixGuard } from "../prefix/guard";
import type { IPersona, IUserProfile } from "../core/types";

export function rebuildPrefix(
  persona: IPersona,
  userProfile: IUserProfile | undefined,
  guard: PrefixGuard
): ImmutablePrefix {
  const userContent = userProfile?.toMarkdown() ?? "";
  const newPrefix = composePrefix(
    persona.compose() + (userContent ? "\n\n" + userContent : ""),
    TOOL_DEFINITIONS
  );
  newPrefix.freeze();
  guard.reset();
  return newPrefix;
}
