/**
 * pi-jev-harness — Core System One types (mirrors TypeSafe Jev)
 * Independent, no pi-brain dependency.
 */
export type JevModel = "jev-latest" | string;

export interface NoulQuestion {
  type: "noul";
  instructions: string;
}
export interface ChoiceOption { criteria: string; }
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  choices: Record<string, ChoiceOption>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  levels: string[]; // e.g. ["low","medium","high"]
}
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, JevQuestion>;

export interface NoulAnswer { type: "noul"; noul: number; confidence: number; }
export interface ChoiceAnswer { type: "choice"; choice: string; probs: Record<string, number>; confidence: number; }
export interface ScoreAnswer { type: "score"; score: number; distribution: number[]; confidence: number; }

export interface JevResponse {
  requestId?: string;
  latencyMs: number;
  nouls: Record<string, NoulAnswer>;
  choices: Record<string, ChoiceAnswer>;
  scores: Record<string, ScoreAnswer>;
  raw?: unknown;
}

export interface JevRequest {
  model: JevModel;
  state: string;
  questions: Questions;
}

export interface HarnessConfig {
  model: JevModel;
  apiKey?: string;
  baseUrl?: string;
  thresholds: { risk: number; urgent: number; complexity: number };
  cacheTtlMs: number;
  fallback?: string;
  timeoutMs: number;
}

export const defaultConfig: HarnessConfig = {
  model: "jev-latest",
  baseUrl: "https://api.typesafe.ai/v1/classify",
  thresholds: { risk: 0.85, urgent: 0.9, complexity: 0.6 },
  cacheTtlMs: 30_000,
  fallback: "rules",
  timeoutMs: 3_000,
};

export type Via = "pi-model" | "rules" | "jev"; // pi-model is primary (tool-based, no fallback); rules/jev kept for legacy files
export interface PolicyDecision {
  complexity: { level: "low" | "medium" | "high"; score: number; confidence: number; via: Via };
  isUrgent: { p: number; confidence: number; via: Via };
  needsPlan: { p: number; confidence: number; via: Via };
  needsHuman: { p: number; confidence: number; via: Via };
  latencyMs: number;
}
