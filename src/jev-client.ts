/**
 * State helpers — pure, no external service, no deps.
 * JevClient removed: harness is pure pi-model via jev_calibrate tool.
 */
export function stateFromToolCall(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}: ${JSON.stringify(input).slice(0, 4000)}`;
}

export function stateFromPrompt(prompt: string, history?: string): string {
  return history ? `${history}\n\nUser: ${prompt}`.slice(0, 8000) : prompt.slice(0, 8000);
}
