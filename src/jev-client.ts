/**
 * State helpers — pure, no external service, no deps.
 * Expanded for suggestion implementation: trivial bypass, compression, tiering.
 */
export function stateFromToolCall(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}: ${JSON.stringify(input).slice(0, 4000)}`;
}

export function stateFromPrompt(prompt: string, history?: string): string {
  return history ? `${history}\n\nUser: ${prompt}`.slice(0, 8000) : prompt.slice(0, 8000);
}

/** AF-01: heuristic to skip calibration for low-signal prompts */
export function isTrivialPrompt(prompt: string): boolean {
  const s = prompt.trim();
  if (!s) return true;
  // starts with Jev marker already handled in index.ts
  const lower = s.toLowerCase();
  // short + low intent
  if (s.length < 60 && s.split(/\s+/).length < 8) {
    // allow high-signal keywords to bypass trivial shortcut
    if (
      /(refactor|migrate|implement|audit|deploy|delete|remove|rewrite|design|plan|architect)/i.test(
        s,
      )
    )
      return false;
    if (/^(read|list|show|cat|ls|hi|hello|help|status|\?|thanks)\b/i.test(lower)) return true;
    // very short casual messages
    if (s.length < 40) return true;
  }
  // read-only patterns that are clearly not write tasks
  if (
    /^(read|list|show|cat|ls|help)\b/i.test(lower) &&
    !/(write|edit|delete|deploy|migrate|refactor|implement|fix)/i.test(lower)
  ) {
    // if just reading one file
    if (s.length < 200) return true;
  }
  return false;
}

/** CE-01: compress long state for token savings — keeps head+tail + hash middle */
export function compressState(state: string, maxChars = 1200): string {
  if (state.length <= maxChars) return state;
  // remove duplicate repeated file paths run
  const dedup = state.replace(/(\S+\.\w+)(,\s*\1)+/g, "$1");
  if (dedup.length <= maxChars) return dedup;
  // keep first and last segments, hash middle
  const head = 650;
  const tail = 350;
  const middle = dedup.slice(head, dedup.length - tail);
  const midHash = simpleHash(middle).slice(0, 8);
  const truncatedNote = `…[truncated ${middle.length} chars hash:${midHash}]`;
  return dedup.slice(0, head) + truncatedNote + dedup.slice(dedup.length - tail);
}

/** Keep small hash without node:crypto dependency (zero deps) */
export function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Normalize state for semantic cache key (lowercase, collapse whitespace, sort file lists) */
export function normalizeState(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 4000);
}

/** Decide short vs full instruction tier */
export function shouldUseShortInstruction(state: string, lastWasLowRisk: boolean): boolean {
  return state.length < 900 && lastWasLowRisk;
}
