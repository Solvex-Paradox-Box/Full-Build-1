import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { InferenceRouter } from '../src/inference/InferenceRouter';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Load the canonical creator-approved instruction. If it is missing, Daisy chat
// fails closed rather than silently running under an incomplete or improvised prompt.
let foundationalSystemInstruction: string | null = null;
const instructionPaths = [
  path.join(process.cwd(), 'DAISY_FOUNDATIONAL_SYSTEM_INSTRUCTION.md'),
  path.join(process.cwd(), '..', 'DAISY_FOUNDATIONAL_SYSTEM_INSTRUCTION.md'),
  path.join(process.cwd(), 'Solvex-core', 'DAISY_FOUNDATIONAL_SYSTEM_INSTRUCTION.md')
];
for (const instructionPath of instructionPaths) {
  try {
    foundationalSystemInstruction = readFileSync(instructionPath, 'utf8').trim();
    if (foundationalSystemInstruction) break;
  } catch {
    // Try the next known repository-root location.
  }
}

// External model providers are disabled by default. Daisy must not send prompts
// to a third party unless the creator explicitly opts in at runtime.
const apiKey = process.env.GEMINI_API_KEY;
const allowExternalModelProvider = process.env.ALLOW_EXTERNAL_MODEL_PROVIDER === 'true';
let ai: GoogleGenAI | null = null;
const inferenceRouter = new InferenceRouter();

if (apiKey && allowExternalModelProvider) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'solvex-sovereign-core' } }
  });
} else {
  console.warn(
    'External model provider is disabled by default. Configure a first-party inference runtime, or explicitly set ALLOW_EXTERNAL_MODEL_PROVIDER=true to authorize the existing Gemini adapter.'
  );
}

// Read-only Paradox Ledger evidence API. Reads persisted artifacts only; no web request
// runs a verifier or upgrades stale records into proof.
app.get('/api/evidence/paradox-ledger', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const runtimeCommit = String(process.env.SOLVEX_SOURCE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').trim().toLowerCase();
  const commitIsKnown = /^[a-f0-9]{40}$/.test(runtimeCommit);
  const artifactNames = ['daisy-brain-activation-gate.json', 'z3-120-formal-verification-summary.json', 'stage-45-readiness.json', 'execution-gates.json'];
  const roots = [path.resolve(process.cwd(), 'artifacts'), path.resolve(process.cwd(), '..', 'artifacts'), path.resolve(process.cwd(), 'Solvex-core', 'artifacts')];
  const artifactRoot = roots.find(root => artifactNames.every(name => existsSync(path.join(root, name))));
  const now = Date.now();
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const sources: Record<string, any> = {};
  const parsed: Record<string, any> = {};

  for (const name of artifactNames) {
    const filePath = artifactRoot ? path.join(artifactRoot, name) : '';
    try {
      if (!filePath || !existsSync(filePath)) { sources[name] = { available: false, status: 'MISSING' }; continue; }
      const stat = statSync(filePath);
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      parsed[name] = data;
      const sourceCommit = String(data.source_commit_sha || data.commit_sha || data.gates?.[0]?.details?.commit_sha || '').toLowerCase();
      const generatedAt = String(data.generated_at || data.timestamp || data.completed_at || '');
      const generatedMs = Date.parse(generatedAt);
      const ageMs = now - generatedMs;
      const fresh = Number.isFinite(generatedMs) && ageMs >= -30_000 && ageMs <= maxAgeMs && stat.size > 0;
      const commitMatch = commitIsKnown && sourceCommit === runtimeCommit;
      sources[name] = {
        available: true,
        status: fresh && commitMatch ? 'CURRENT' : !fresh ? 'STALE_OR_UNDATED' : !commitIsKnown ? 'RUNTIME_COMMIT_UNKNOWN' : 'SOURCE_COMMIT_MISMATCH',
        generated_at: generatedAt || null,
        age_seconds: Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 1000)) : null,
        source_commit_sha: sourceCommit || null,
        runtime_commit_sha: commitIsKnown ? runtimeCommit : null,
        commit_match: commitMatch,
        fresh
      };
    } catch {
      sources[name] = { available: false, status: 'INVALID_OR_UNREADABLE' };
    }
  }

  const activation = parsed['daisy-brain-activation-gate.json'];
  const formal = parsed['z3-120-formal-verification-summary.json'];
  const stage45 = parsed['stage-45-readiness.json'];
  const pipeline = parsed['execution-gates.json'];
  const gateItems = Array.isArray(stage45?.gates) ? stage45.gates : [];
  const nonPassedGates = gateItems.filter((gate: any) => gate?.status !== 'PASSED');
  const sourceFilesCurrent = artifactNames.every(name => sources[name]?.status === 'CURRENT');
  const activationValid = activation?.schema_version === '1.0.0' && activation?.status === 'ACTIVE' &&
    activation?.corpus?.total_required === 120 && activation?.corpus?.dfrl_required === 88 &&
    activation?.corpus?.dh_required === 32 && activation?.corpus?.executed === 120 &&
    activation?.corpus?.deterministic_replays === 120 && activation?.corpus?.unknown === 0 &&
    activation?.corpus?.errors === 0 && activation?.mandatory_gates?.total === 45 &&
    activation?.mandatory_gates?.observed === 45 && activation?.mandatory_gates?.passed === 45 &&
    activation?.mandatory_gates?.failed === 0 && activation?.mandatory_gates?.blocked === 0 &&
    activation?.mandatory_gates?.external_provider_required === 0 && activation?.mandatory_gates?.non_passed === 0 &&
    activation?.adversarial_verification && Object.values(activation.adversarial_verification).every(value => value === true) &&
    /^[a-f0-9]{64}$/i.test(String(activation?.verification_root_sha256 || '')) &&
    activation?.corpus_root_sha256 === activation?.verification_root_sha256 &&
    /^[a-f0-9]{64}$/i.test(String(activation?.run_evidence_sha256 || '')) &&
    String(activation?.source_commit_sha || '').toLowerCase() === runtimeCommit;
  const formalMatches = formal?.total_z3_executions === 120 && formal?.replay_matches === 120 &&
    formal?.distribution?.unknown === 0 && formal?.distribution?.error === 0 &&
    formal?.combined_root_sha256 === activation?.verification_root_sha256 &&
    formal?.run_evidence_sha256 === activation?.run_evidence_sha256 &&
    String(formal?.commit_sha || '').toLowerCase() === String(activation?.source_commit_sha || '').toLowerCase();
  const gatesComplete = stage45?.total_checks === 44 && gateItems.length === 44 &&
    nonPassedGates.length === 0 && stage45?.stage_45?.status === 'PASSED' && stage45?.deployment_authorized === true &&
    stage45?.overall_verdict === 'PRE_PRODUCTION_COMPLETE_AND_DEPLOYMENT_AUTHORIZED';
  // A matching source SHA alone is not proof that the authoritative pipeline passed.
  // Require every pipeline gate and an explicit PASSED verdict with no blockers.
  const pipelineBound = pipeline?.gates_total === 15 && pipeline?.gates_passed === 15 &&
    pipeline?.pre_production_passed === true &&
    Array.isArray(pipeline?.pre_production_blockers) && pipeline.pre_production_blockers.length === 0 &&
    String(pipeline?.commit_sha || '').toLowerCase() === String(activation?.source_commit_sha || '').toLowerCase();
  const active = Boolean(commitIsKnown && sourceFilesCurrent && activationValid && formalMatches && gatesComplete && pipelineBound);
  const reason = active
    ? 'Fresh formal corpus, activation record, Stage 45 report, and authoritative pre-production pipeline all match the runtime source revision.'
    : !commitIsKnown
      ? 'BLOCKED: runtime source commit is unavailable; evidence cannot be bound to this running revision.'
      : !sourceFilesCurrent
        ? 'BLOCKED: one or more evidence artifacts are missing, stale, unreadable, or bound to a different source revision.'
        : !activationValid
          ? 'BLOCKED: activation record does not satisfy the complete 120-case, adversarial, 44-check plus Stage 45, and source-commit contract.'
          : !formalMatches
            ? 'BLOCKED: formal summary roots, run receipt, counts, or source commit do not match the activation record.'
            : !gatesComplete
              ? 'BLOCKED: current Stage 45 report is incomplete or contains a non-passed pre-production check.'
              : 'BLOCKED: the authoritative pipeline has not passed all 15 gates, has production blockers, or is not bound to the same source revision.';

  return res.json({
    success: true, status: active ? 'ACTIVE' : 'BLOCKED', reason,
    runtime_commit_sha: commitIsKnown ? runtimeCommit : null, generated_at: new Date().toISOString(),
    artifacts_directory: artifactRoot || null, sources,
    formal: formal ? {
      total_z3_executions: formal.total_z3_executions ?? null, expected_result_matches: formal.expected_result_matches ?? null,
      replay_matches: formal.replay_matches ?? null, unsat: formal.distribution?.unsat ?? null,
      sat: formal.distribution?.sat ?? null, unknown: formal.distribution?.unknown ?? null,
      errors: formal.distribution?.error ?? null, combined_root_sha256: formal.combined_root_sha256 ?? null,
      run_evidence_sha256: formal.run_evidence_sha256 ?? null, commit_sha: formal.commit_sha ?? null,
      timestamp: formal.timestamp ?? null, activation_gate: formal.activation_gate ?? null
    } : null,
    activation: activation ? {
      status: activation.status ?? 'UNKNOWN', reason: activation.reason ?? null, corpus: activation.corpus ?? null,
      adversarial_verification: activation.adversarial_verification ?? null, mandatory_gates: activation.mandatory_gates ?? null,
      verification_root_sha256: activation.verification_root_sha256 ?? null, run_evidence_sha256: activation.run_evidence_sha256 ?? null,
      source_commit_sha: activation.source_commit_sha ?? null, generated_at: activation.generated_at ?? null,
      gate_exceptions: Array.isArray(activation.gate_exceptions) ? activation.gate_exceptions : []
    } : null,
    stage_45_readiness: stage45 ? {
      timestamp: stage45.timestamp ?? null, total_checks: stage45.total_checks ?? gateItems.length,
      checks_passed: stage45.gates_passed ?? null, blocked_count: stage45.blocked_count ?? null,
      failed_count: stage45.failed_count ?? null, external_provider_required_count: stage45.external_provider_required_count ?? null,
      overall_verdict: stage45.overall_verdict ?? 'UNKNOWN', stage_45: stage45.stage_45 ?? null,
      non_passed: nonPassedGates.slice(0, 44).map((gate: any) => ({ gate_number: gate.gate_number, gate_id: gate.gate_id, name: gate.name, status: gate.status }))
    } : null,
    authoritative_pipeline: pipeline ? {
      completed_at: pipeline.completed_at ?? null, commit_sha: pipeline.commit_sha ?? null,
      gates_total: pipeline.gates_total ?? null, gates_passed: pipeline.gates_passed ?? null,
      production_gate_verdict: pipeline.production_gate_verdict ?? 'UNKNOWN',
      production_blockers: Array.isArray(pipeline.production_blockers) ? pipeline.production_blockers : []
    } : null
  });
});

// Payment creation is deliberately disabled. Never fabricate transaction IDs,
// checkout URLs, provider responses, or a successful payment intent.
app.post('/api/pay/create', (_req, res) => {
  return res.status(410).json({
    success: false,
    code: 'PAYMENTS_DISABLED',
    status: 'BLOCKED',
    message: 'Payment processing is disabled pending a separately reviewed PayPal integration.'
  });
});

// Return only repositories actually received from GitHub. No fabricated fallback dataset.
app.post('/api/github/repos', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!/^[A-Za-z0-9-]{1,39}$/.test(username)) {
    return res.status(400).json({ success: false, error: 'A valid GitHub username is required.' });
  }
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'solvex-sovereign-unifier' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch('https://api.github.com/users/' + encodeURIComponent(username) + '/repos?sort=updated&per_page=30', { headers });
    if (!response.ok) {
      return res.status(502).json({ success: false, code: 'GITHUB_LOOKUP_FAILED', upstreamStatus: response.status, error: 'GitHub did not return a successful repository listing; no substitute data was used.' });
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return res.status(502).json({ success: false, code: 'INVALID_GITHUB_RESPONSE' });
    const result = data.map((repo: any) => ({ id: repo.id, name: repo.name, description: repo.description, url: repo.html_url, stars: repo.stargazers_count, language: repo.language, updatedAt: repo.updated_at }));
    return res.json({ success: true, repos: result, source: 'github_api' });
  } catch {
    return res.status(502).json({ success: false, code: 'GITHUB_LOOKUP_UNAVAILABLE', error: 'GitHub repository lookup failed; no simulated repository data was returned.' });
  }
});

// Repository unification must perform real clone, provenance, dependency, and
// verification work. Until that implementation exists, do not return simulated
// build configurations or suggest an unauthenticated deployment is ready.
app.post('/api/github/unify', (_req, res) => {
  return res.status(501).json({
    success: false,
    code: 'UNIFICATION_NOT_IMPLEMENTED',
    status: 'BLOCKED',
    message: 'Repository unification is not available until real source acquisition, provenance checks, build verification, and deployment authorization are implemented.'
  });
});

// Daisy uses the canonical foundational instruction and fails closed if either
// that instruction or the configured model provider is unavailable. No fake AI
// replies, purchase-intent directives, or simulated operational success are returned.
// Daisy: foundational instruction required. Prefer first-party local inference.
// External Gemini only if explicitly opted in. Never invent successful intelligence.
// Inference status for operators (no secrets).
app.get('/api/inference/status', async (_req, res) => {
  const { getLocalInferenceRuntime } = await import('../src/inference/LocalInferenceRuntime');
  const info = await getLocalInferenceRuntime().probe();
  return res.json({
    first_party: info,
    external_provider_opt_in: allowExternalModelProvider,
    external_provider_configured: Boolean(ai),
    foundational_instruction_loaded: Boolean(foundationalSystemInstruction),
  });
});


app.post('/api/chat', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const rawHistory = Array.isArray(req.body?.messageHistory) ? req.body.messageHistory : [];
  if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required.' });
  if (prompt.length > 20000) return res.status(413).json({ success: false, error: 'Prompt exceeds the allowed size.' });
  if (!foundationalSystemInstruction) {
    return res.status(503).json({
      success: false,
      code: 'FOUNDATIONAL_INSTRUCTION_UNAVAILABLE',
      status: 'BLOCKED',
      error: 'Daisy cannot start because its canonical system instruction could not be loaded.',
    });
  }

  const history = rawHistory
    .filter((msg: any) => msg && (msg.sender === 'user' || msg.sender === 'assistant' || msg.sender === 'model' || msg.sender === 'ai') && typeof msg.text === 'string')
    .slice(-20);

  const messages = [
    { role: 'system' as const, content: foundationalSystemInstruction },
    ...history.map((msg: any) => ({
      role: (msg.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: String(msg.text).slice(0, 8000),
    })),
    { role: 'user' as const, content: prompt },
  ];

  // 1) First-party local runtime
  const localOutcome = await inferenceRouter.resolveChat({ messages, timeoutMs: 60_000 });
  if (localOutcome.result.status === 'OK' && localOutcome.result.text) {
    return res.json({
      success: true,
      text: localOutcome.result.text,
      source: 'first_party_local',
      runtime: localOutcome.result.runtimeId,
      modelId: localOutcome.result.modelId,
      modelVersion: localOutcome.result.modelVersion,
      durationMs: localOutcome.result.durationMs,
    });
  }

  // 2) Optional external provider (explicit opt-in only)
  if (ai) {
    try {
      const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = history.map((msg: any) => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: String(msg.text).slice(0, 8000) }],
      }));
      contents.push({ role: 'user', parts: [{ text: prompt }] });
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents,
        config: { systemInstruction: foundationalSystemInstruction, temperature: 0.1 },
      });
      const replyText = response.text?.trim();
      if (!replyText) {
        return res.status(502).json({
          success: false,
          code: 'EMPTY_MODEL_RESPONSE',
          status: 'BLOCKED',
          error: 'The configured external model returned no response.',
        });
      }
      return res.json({ success: true, text: replyText, source: 'configured_external_model' });
    } catch {
      return res.status(502).json({
        success: false,
        code: 'MODEL_REQUEST_FAILED',
        status: 'BLOCKED',
        error: 'The configured external model request failed. No simulated response was generated.',
      });
    }
  }

  // 3) Fail closed — report the first-party blocker honestly
  return res.status(503).json({
    success: false,
    code: localOutcome.result.code || 'FIRST_PARTY_MODEL_UNAVAILABLE',
    status: 'BLOCKED',
    error: localOutcome.result.error
      || 'External model providers are disabled. No prompt was sent to a third party; no first-party inference runtime is currently connected.',
    runtime: localOutcome.runtime,
  });
});

// Setup Vite and Static files
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SolveX Sovereign Core server running at http://0.0.0.0:${PORT}`);
  });
}

start();
