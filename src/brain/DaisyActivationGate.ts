export type DaisyActivationStatus = 'INACTIVE' | 'ACTIVE' | 'BLOCKED';

export interface DaisyActivationAuthorization {
  authorized_by: string;
  issued_at: string;
  source_commit_sha: string;
  verification_root_sha256: string;
  run_evidence_sha256: string;
  signature_base64: string;
}

export interface DaisyActivationGateRecord {
  schema_version: '1.0.0';
  status: DaisyActivationStatus;
  reason: string;
  corpus: {
    total_required: 120;
    dfrl_required: 88;
    dh_required: 32;
    executed: number;
    deterministic_replays: number;
    unknown: number;
    errors: number;
  };
  adversarial_verification: {
    passed: boolean;
    dfrl_mutation: boolean;
    dfrl_failure_injection: boolean;
    dfrl_tamper_alarm: boolean;
    dh_smt_mutation: boolean;
    dh_failure_injection: boolean;
    dh_artifact_tamper: boolean;
    contract_hash_integrity: boolean;
    source_hash_integrity: boolean;
    replay_integrity: boolean;
  };
  mandatory_gates: {
    total: number;
    observed: number;
    passed: number;
    failed: number;
    blocked: number;
    external_provider_required: number;
    non_passed: number;
  };
  verification_root_sha256: string;
  corpus_root_sha256: string;
  run_evidence_sha256: string;
  source_commit_sha: string;
  generated_at: string;
  activation_authorization?: DaisyActivationAuthorization;
}

let inMemoryRecord: DaisyActivationGateRecord | null = null;

export class DaisyActivationGate {
  private static readonly RELATIVE_PATH = 'artifacts/daisy-brain-activation-gate.json';
  private static readonly MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

  public static verifyAuthorization(
    authorization: DaisyActivationAuthorization | undefined,
    sourceCommit: string,
    verificationRoot: string,
    runEvidence: string
  ): boolean {
    const publicKey = typeof process !== 'undefined' ? process.env?.SOLVEX_ACTIVATION_ROOT_PUBLIC_KEY : undefined;
    if (!authorization || !publicKey || !authorization.authorized_by?.trim()) return false;
    if (authorization.source_commit_sha?.toLowerCase() !== sourceCommit.toLowerCase() ||
      authorization.verification_root_sha256 !== verificationRoot ||
      authorization.run_evidence_sha256 !== runEvidence) return false;

    const issuedAt = Date.parse(authorization.issued_at);
    const age = Date.now() - issuedAt;
    if (!Number.isFinite(issuedAt) || age < -30_000 || age > this.MAX_EVIDENCE_AGE_MS) return false;

    try {
      const nodeProcess = process as NodeJS.Process & { getBuiltinModule?: (id: string) => any };
      const crypto = nodeProcess.getBuiltinModule?.('node:crypto') ??
        (typeof require === 'function' ? require('node:crypto') : null);
      if (!crypto || !/^[A-Za-z0-9+/]+={0,2}$/.test(authorization.signature_base64)) return false;
      const payload = JSON.stringify({
        schema: 'SOLVEX_DAISY_ACTIVATION_AUTHORIZATION_V1',
        authorized_by: authorization.authorized_by.trim(),
        issued_at: authorization.issued_at,
        source_commit_sha: sourceCommit.toLowerCase(),
        verification_root_sha256: verificationRoot,
        run_evidence_sha256: runEvidence
      });
      return crypto.verify(
        null,
        Buffer.from(payload, 'utf8'),
        publicKey,
        Buffer.from(authorization.signature_base64, 'base64')
      );
    } catch {
      return false;
    }
  }

  public static setRecord(record: DaisyActivationGateRecord | null) {
    // Test-only injection; production must read a persisted, fresh activation artifact.
    inMemoryRecord = record;
  }

  private static expectedSourceCommit(): string | null {
    const value = (typeof process !== 'undefined'
      ? process.env?.SOLVEX_SOURCE_COMMIT || process.env?.VERCEL_GIT_COMMIT_SHA || process.env?.GITHUB_SHA
      : undefined)?.trim().toLowerCase();
    return value && /^[a-f0-9]{40}$/.test(value) ? value : null;
  }

  private static isFreshAndComplete(record: DaisyActivationGateRecord): boolean {
    if (record.schema_version !== '1.0.0' || record.status !== 'ACTIVE') return false;

    const expectedCommit = this.expectedSourceCommit();
    if (!expectedCommit || record.source_commit_sha?.toLowerCase() !== expectedCommit) return false;

    const generatedAt = Date.parse(record.generated_at);
    const age = Date.now() - generatedAt;
    if (!Number.isFinite(generatedAt) || age < -30_000 || age > this.MAX_EVIDENCE_AGE_MS) return false;

    const corpus = record.corpus;
    if (
      corpus?.total_required !== 120 ||
      corpus?.dfrl_required !== 88 ||
      corpus?.dh_required !== 32 ||
      corpus?.executed !== 120 ||
      corpus?.deterministic_replays !== 120 ||
      corpus?.unknown !== 0 ||
      corpus?.errors !== 0
    ) return false;

    const gates = record.mandatory_gates;
    if (
      gates?.total !== 46 ||
      gates?.observed !== 46 ||
      gates?.passed !== 46 ||
      gates?.failed !== 0 ||
      gates?.blocked !== 0 ||
      gates?.external_provider_required !== 0 ||
      gates?.non_passed !== 0
    ) return false;

    const adversarial = record.adversarial_verification;
    const requiredAdversarialChecks: (keyof DaisyActivationGateRecord['adversarial_verification'])[] = [
      'passed',
      'dfrl_mutation',
      'dfrl_failure_injection',
      'dfrl_tamper_alarm',
      'dh_smt_mutation',
      'dh_failure_injection',
      'dh_artifact_tamper',
      'contract_hash_integrity',
      'source_hash_integrity',
      'replay_integrity'
    ];
    if (!adversarial || requiredAdversarialChecks.some(key => adversarial[key] !== true) ||
      Object.values(adversarial).some(value => value !== true)) return false;

    const isSha256 = (value: string) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
    return isSha256(record.verification_root_sha256)
      && record.corpus_root_sha256 === record.verification_root_sha256
      && isSha256(record.run_evidence_sha256)
      && this.verifyAuthorization(
        record.activation_authorization,
        record.source_commit_sha,
        record.verification_root_sha256,
        record.run_evidence_sha256
      );
  }

  private static blockedCopy(record: DaisyActivationGateRecord, reason: string): DaisyActivationGateRecord {
    return { ...record, status: 'BLOCKED', reason };
  }

  public static read(): DaisyActivationGateRecord | null {
    if (typeof window === 'undefined' && typeof process !== 'undefined' && typeof process.cwd === 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fsMod = typeof require === 'function' ? require('fs') : null;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pathMod = typeof require === 'function' ? require('path') : null;
        if (!fsMod || !pathMod) return null;

        const file = pathMod.resolve(process.cwd(), this.RELATIVE_PATH);
        if (!fsMod.existsSync(file)) return null;

        const data = JSON.parse(fsMod.readFileSync(file, 'utf8')) as DaisyActivationGateRecord;
        if (data?.status === 'ACTIVE' && !this.isFreshAndComplete(data)) {
          const blocked = this.blockedCopy(data, 'Activation evidence is stale, incomplete, or does not match this source revision.');
          inMemoryRecord = blocked;
          return blocked;
        }
        inMemoryRecord = data;
        return data;
      } catch {
        // Corrupt or unreadable disk evidence must never fall back to an older ACTIVE record.
        inMemoryRecord = null;
        return null;
      }
    }

    // In-memory injection is only available in explicit test environments.
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      return inMemoryRecord;
    }
    return null;
  }

  public static assertActive(): DaisyActivationGateRecord {
    const record = this.read();
    if (!record || !this.isFreshAndComplete(record)) {
      throw new Error('DAISY_BRAIN_FAIL_CLOSED: fresh 120-case, adversarial, 46-gate evidence for this source revision is not ACTIVE');
    }
    return record;
  }

  public static isActive(): boolean {
    const record = this.read();
    return !!record && this.isFreshAndComplete(record);
  }
}
