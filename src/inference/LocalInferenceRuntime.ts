import { access, constants, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  DEFAULT_INFERENCE_TIMEOUT_MS,
  InferenceRequest,
  InferenceResult,
  InferenceRuntime,
  InferenceRuntimeInfo,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_PROMPT_CHARS,
} from './InferenceRuntime';

async function isNonEmptyReadableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size <= 0) return false;
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function validateRequest(request: InferenceRequest): string | null {
  if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {
    return 'Messages are required.';
  }
  if (request.messages.length > MAX_HISTORY_MESSAGES + 2) {
    return 'Message history exceeds the allowed size.';
  }
  let total = 0;
  for (const msg of request.messages) {
    if (!msg || typeof msg.content !== 'string' || !['system', 'user', 'assistant'].includes(msg.role)) {
      return 'Each message must include a valid role and string content.';
    }
    if (msg.content.length > MAX_MESSAGE_CHARS) {
      return 'A message exceeds the allowed size.';
    }
    total += msg.content.length;
  }
  if (total > MAX_PROMPT_CHARS) {
    return 'Combined prompt size exceeds the allowed limit.';
  }
  if (request.timeoutMs !== undefined &&
      (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 600_000)) {
    return 'Timeout must be between 1 and 600000 milliseconds.';
  }
  return null;
}

/**
 * Local first-party inference runtime.
 *
 * Requires:
 * - DAISY_MODEL_PATH: path to model weights (e.g. GGUF)
 * - DAISY_INFERENCE_ENGINE: path to a local CLI engine (e.g. llama-cli) that accepts
 *   --model, --prompt, and prints completion text to stdout
 * - optional DAISY_MODEL_ID / DAISY_MODEL_VERSION for evidence labels
 *
 * Without both model and engine present and readable, every generate() call returns
 * MODEL_UNAVAILABLE / BLOCKED. No mock or third-party fallback is performed here.
 */
export class LocalInferenceRuntime implements InferenceRuntime {
  private readonly modelPath: string | null;
  private readonly enginePath: string | null;
  private readonly modelId: string | null;
  private readonly modelVersion: string | null;
  private ready = false;
  private probed = false;

  constructor(options?: {
    modelPath?: string | null;
    enginePath?: string | null;
    modelId?: string | null;
    modelVersion?: string | null;
  }) {
    this.modelPath = options?.modelPath
      ?? process.env.DAISY_MODEL_PATH
      ?? null;
    this.enginePath = options?.enginePath
      ?? process.env.DAISY_INFERENCE_ENGINE
      ?? null;
    this.modelId = options?.modelId ?? process.env.DAISY_MODEL_ID ?? null;
    this.modelVersion = options?.modelVersion ?? process.env.DAISY_MODEL_VERSION ?? null;
  }

  getInfo(): InferenceRuntimeInfo {
    return {
      runtimeId: 'daisy-local-inference/v1',
      modelId: this.modelId,
      modelVersion: this.modelVersion,
      modelPath: this.modelPath,
      enginePath: this.enginePath,
      ready: this.ready,
      offlineCapable: false,
      notes: this.ready
        ? 'Model and engine paths passed basic filesystem checks only; format compatibility and successful model loading are not attested. Network isolation is not enforced by this runtime.'
        : 'Model weights and/or inference engine are not configured. Generative inference remains BLOCKED. Network isolation is not enforced by this runtime. Formal verification and deterministic logic are separate subsystems.',
    };
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Probe filesystem once (or again after configuration change). */
  async probe(): Promise<InferenceRuntimeInfo> {
    this.probed = true;
    this.ready = false;
    if (!this.modelPath || !this.enginePath) {
      return this.getInfo();
    }
    // Readability alone is not proof of a usable model/engine: directories,
    // empty files, and non-executable engine files must not report READY.
    const modelOk = await isNonEmptyReadableFile(path.resolve(this.modelPath));
    const engineOk = await isExecutableFile(path.resolve(this.enginePath));
    this.ready = modelOk && engineOk;
    return this.getInfo();
  }

  async generate(request: InferenceRequest): Promise<InferenceResult> {
    const started = Date.now();
    if (!this.probed) await this.probe();

    const validationError = validateRequest(request);
    if (validationError) {
      return {
        status: 'MALFORMED_INPUT',
        runtimeId: 'daisy-local-inference/v1',
        modelId: this.modelId,
        modelVersion: this.modelVersion,
        durationMs: Date.now() - started,
        error: validationError,
        code: 'MALFORMED_INPUT',
      };
    }

    if (!this.ready || !this.modelPath || !this.enginePath) {
      return {
        status: 'MODEL_UNAVAILABLE',
        runtimeId: 'daisy-local-inference/v1',
        modelId: this.modelId,
        modelVersion: this.modelVersion,
        durationMs: Date.now() - started,
        error: 'First-party model weights or inference engine are not available. No simulated reply was generated.',
        code: 'FIRST_PARTY_MODEL_UNAVAILABLE',
      };
    }

    if (request.signal?.aborted) {
      return {
        status: 'CANCELLED',
        runtimeId: 'daisy-local-inference/v1',
        modelId: this.modelId,
        modelVersion: this.modelVersion,
        durationMs: Date.now() - started,
        error: 'Inference cancelled before start.',
        code: 'CANCELLED',
      };
    }

    const timeoutMs = request.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
    const prompt = request.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    try {
      const text = await this.runEngine(prompt, timeoutMs, request.signal);
      if (!text.trim()) {
        return {
          status: 'BLOCKED',
          runtimeId: 'daisy-local-inference/v1',
          modelId: this.modelId,
          modelVersion: this.modelVersion,
          durationMs: Date.now() - started,
          error: 'Local engine returned an empty completion.',
          code: 'EMPTY_LOCAL_COMPLETION',
        };
      }
      return {
        status: 'OK',
        text: text.trim(),
        runtimeId: 'daisy-local-inference/v1',
        modelId: this.modelId,
        modelVersion: this.modelVersion,
        durationMs: Date.now() - started,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Local inference failed.';
      const status =
        message.includes('TIMEOUT') ? 'TIMEOUT'
          : message.includes('CANCELLED') ? 'CANCELLED'
            : message.includes('RESOURCE') ? 'RESOURCE_EXHAUSTED'
              : 'BLOCKED';
      return {
        status,
        runtimeId: 'daisy-local-inference/v1',
        modelId: this.modelId,
        modelVersion: this.modelVersion,
        durationMs: Date.now() - started,
        error: message,
        code: status === 'TIMEOUT' ? 'INFERENCE_TIMEOUT' : 'LOCAL_INFERENCE_FAILED',
      };
    }
  }

  private runEngine(prompt: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const engine = path.resolve(this.enginePath!);
      const model = path.resolve(this.modelPath!);
      // Generic CLI contract: engine --model <path> --prompt <text>
      // Operators may wrap llama.cpp / similar behind a thin adapter script.
      const child = spawn(engine, ['--model', model, '--prompt', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          // Do not leak application credentials to a configured model wrapper. This is
          // a reduced child environment, not OS-level network isolation.
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          TMPDIR: process.env.TMPDIR ?? '/tmp',
          LANG: 'C.UTF-8',
          DAISY_INFERENCE_OFFLINE: '1',
        },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error('TIMEOUT: local inference exceeded the configured limit.')));
      }, timeoutMs);

      const onAbort = () => {
        child.kill('SIGKILL');
        finish(() => reject(new Error('CANCELLED: inference aborted by caller.')));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        // Soft memory guard: abort if output grows unbounded.
        if (stdout.length > 2_000_000) {
          child.kill('SIGKILL');
          finish(() => reject(new Error('RESOURCE_EXHAUSTED: completion exceeded size limit.')));
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 8_192) {
          stderr += chunk.toString('utf8').slice(0, 8_192 - stderr.length);
        }
      });
      child.on('error', (err) => {
        finish(() => reject(new Error(`LOCAL_ENGINE_ERROR: ${err.message}`)));
      });
      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (code === 0) {
          finish(() => resolve(stdout));
        } else {
          finish(() => reject(new Error(
            `LOCAL_ENGINE_EXIT_${code ?? 'null'}: ${stderr.trim().slice(0, 500) || 'engine failed'}`,
          )));
        }
      });
    });
  }
}

let singleton: LocalInferenceRuntime | null = null;

export function getLocalInferenceRuntime(): LocalInferenceRuntime {
  if (!singleton) singleton = new LocalInferenceRuntime();
  return singleton;
}
