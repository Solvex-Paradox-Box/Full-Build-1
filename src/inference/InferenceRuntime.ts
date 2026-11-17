/**
 * First-party inference contracts.
 *
 * Generative model inference is distinct from:
 * - formal verification (Z3 / 120-case corpus)
 * - deterministic application logic
 * - retrieval or scripted responses
 *
 * A runtime that cannot load a real model MUST return BLOCKED.
 * Never fabricate successful intelligence.
 */

export type InferenceStatus =
  | 'OK'
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'RESOURCE_EXHAUSTED'
  | 'MODEL_UNAVAILABLE'
  | 'MALFORMED_INPUT';

export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceRequest {
  messages: InferenceMessage[];
  /** Wall-clock limit for the whole call (ms). */
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
  /** Optional AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;
}

export interface InferenceResult {
  status: InferenceStatus;
  text?: string;
  /** Runtime + model identity for reproducible evidence. */
  runtimeId: string;
  modelId: string | null;
  modelVersion: string | null;
  durationMs: number;
  error?: string;
  code?: string;
}

export interface InferenceRuntimeInfo {
  runtimeId: string;
  modelId: string | null;
  modelVersion: string | null;
  modelPath: string | null;
  enginePath: string | null;
  ready: boolean;
  offlineCapable: boolean;
  notes: string;
}

export interface InferenceRuntime {
  getInfo(): InferenceRuntimeInfo;
  /** True only when configured model/engine paths pass preliminary filesystem checks; not proof of compatibility or successful loading. */
  isReady(): boolean;
  generate(request: InferenceRequest): Promise<InferenceResult>;
}

export const DEFAULT_INFERENCE_TIMEOUT_MS = 60_000;
export const MAX_PROMPT_CHARS = 20_000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 8_000;
