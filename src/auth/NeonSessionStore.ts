/**
 * Neon-backed persistent session store for production authentication.
 *
 * - Cryptographically random opaque tokens (never stored in plaintext)
 * - SHA-256 digests only in the database
 * - Expiration + revocation
 * - Membership revalidation on every lookup
 * - Multi-instance compatible (no process memory required for correctness)
 *
 * Fail-closed: any database error or missing membership returns null / throws BLOCKED.
 * This store is only used when AUTH_MODE=production and readiness validation has passed.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { UserContext, SovereignRole } from './AuthService';

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  tenantId: string;
  email: string;
  role: SovereignRole;
  oidcSub: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface SessionStore {
  createSession(user: UserContext, ttlMs: number): Promise<{ token: string; record: SessionRecord }>;
  findSessionByToken(token: string): Promise<SessionRecord | null>;
  revokeSession(token: string): Promise<boolean>;
  revalidateMembership(userId: string, tenantId: string): Promise<{ active: boolean; role: SovereignRole } | null>;
  probeConnectivity(): Promise<{ ok: boolean; reason?: string }>;
}

export interface QueryResult<Row> {
  rows: Row[];
  rowCount?: number | null;
}

export interface Queryable {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
}

export interface PoolClientLike extends Queryable {
  release(): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
}

const VALID_ROLES = new Set<SovereignRole>(['OWNER', 'ADMIN', 'VERIFIER', 'CUSTOMER']);

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export class NeonSessionStore implements SessionStore {
  constructor(
    private readonly pool: PoolLike,
    private readonly options: {
      appRole?: string;
      now?: () => number;
    } = {},
  ) {}

  static fromEnvironment(): NeonSessionStore | null {
    const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
    if (!url) return null;
    const { Pool } = require('@neondatabase/serverless') as { Pool: new (opts: { connectionString: string }) => PoolLike };
    const pool = new Pool({ connectionString: url });
    return new NeonSessionStore(pool, {
      appRole: process.env.SOVEREIGN_APP_ROLE || 'solvex_app_runtime',
    });
  }

  private async withClient<T>(fn: (client: PoolClientLike) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (this.options.appRole) {
        await client.query(`SET LOCAL ROLE ${quoteIdent(this.options.appRole)}`);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async createSession(user: UserContext, ttlMs: number): Promise<{ token: string; record: SessionRecord }> {
    if (!user.user_id || !user.tenant_id || !user.email || !VALID_ROLES.has(user.role)) {
      throw new Error('BLOCKED: cannot create session for incomplete identity.');
    }
    const now = (this.options.now ?? Date.now)();
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 7 * 24 * 60 * 60 * 1000) {
      throw new Error('BLOCKED: session TTL out of allowed range.');
    }

    const membership = await this.revalidateMembership(user.user_id, user.tenant_id);
    if (!membership || !membership.active) {
      throw new Error('BLOCKED: tenant membership is missing or inactive.');
    }
    const role = membership.role;

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = now + ttlMs;

    const record: SessionRecord = {
      tokenHash,
      userId: user.user_id,
      tenantId: user.tenant_id,
      email: user.email,
      role,
      oidcSub: user.oidc_sub ?? null,
      createdAt: now,
      expiresAt,
      revokedAt: null,
    };

    await this.withClient(async (client) => {
      try {
        await client.query(
          `SELECT solvex_private.create_auth_session($1, $2, $3, $4, $5, $6)`,
          [tokenHash, user.user_id, user.tenant_id, now, expiresAt, user.oidc_sub ?? null],
        );
      } catch {
        await client.query(
          `INSERT INTO solvex_private.auth_sessions
             (token_hash, user_id, tenant_id, email, role, oidc_sub, created_at, expires_at, revoked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
          [tokenHash, user.user_id, user.tenant_id, user.email, role, user.oidc_sub ?? null, now, expiresAt],
        );
      }
    });

    return { token, record };
  }

  async findSessionByToken(token: string): Promise<SessionRecord | null> {
    if (typeof token !== 'string' || token.length < 32) return null;
    const tokenHash = hashToken(token);
    const now = (this.options.now ?? Date.now)();

    try {
      return await this.withClient(async (client) => {
        let row: {
          token_hash: string;
          user_id: string;
          tenant_id: string;
          email: string;
          role: string;
          oidc_sub: string | null;
          created_at: string | number;
          expires_at: string | number;
          revoked_at: string | number | null;
        } | undefined;

        try {
          const result = await client.query<typeof row & object>(
            `SELECT * FROM solvex_private.find_auth_session($1)`,
            [tokenHash],
          );
          row = result.rows[0];
        } catch {
          const result = await client.query<typeof row & object>(
            `SELECT token_hash, user_id, tenant_id, email, role, oidc_sub, created_at, expires_at, revoked_at
             FROM solvex_private.auth_sessions
             WHERE token_hash = $1`,
            [tokenHash],
          );
          row = result.rows[0];
        }

        if (!row) return null;
        const expiresAt = Number(row.expires_at);
        const revokedAt = row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at);
        if (revokedAt !== null || expiresAt <= now) return null;
        if (!VALID_ROLES.has(row.role as SovereignRole)) return null;

        const membership = await this.revalidateMembershipWithClient(client, row.user_id, row.tenant_id);
        if (!membership || !membership.active) return null;

        return {
          tokenHash: row.token_hash,
          userId: row.user_id,
          tenantId: row.tenant_id,
          email: row.email,
          role: membership.role,
          oidcSub: row.oidc_sub,
          createdAt: Number(row.created_at),
          expiresAt,
          revokedAt,
        };
      });
    } catch {
      return null;
    }
  }

  async revokeSession(token: string): Promise<boolean> {
    if (typeof token !== 'string' || token.length < 32) return false;
    const tokenHash = hashToken(token);
    const now = (this.options.now ?? Date.now)();
    try {
      return await this.withClient(async (client) => {
        try {
          const result = await client.query(
            `SELECT solvex_private.revoke_auth_session($1, $2) AS revoked`,
            [tokenHash, now],
          );
          return Boolean((result.rows[0] as { revoked?: boolean })?.revoked);
        } catch {
          const result = await client.query(
            `UPDATE solvex_private.auth_sessions
             SET revoked_at = $2
             WHERE token_hash = $1 AND revoked_at IS NULL`,
            [tokenHash, now],
          );
          return (result.rowCount ?? 0) > 0;
        }
      });
    } catch {
      return false;
    }
  }

  async revalidateMembership(userId: string, tenantId: string): Promise<{ active: boolean; role: SovereignRole } | null> {
    try {
      return await this.withClient((client) => this.revalidateMembershipWithClient(client, userId, tenantId));
    } catch {
      return null;
    }
  }

  private async revalidateMembershipWithClient(
    client: Queryable,
    userId: string,
    tenantId: string,
  ): Promise<{ active: boolean; role: SovereignRole } | null> {
    try {
      const result = await client.query<{ role: string; active: boolean }>(
        `SELECT role, active FROM solvex_private.find_membership($1, $2)`,
        [userId, tenantId],
      );
      const row = result.rows[0];
      if (!row || !VALID_ROLES.has(row.role as SovereignRole)) return null;
      return { active: Boolean(row.active), role: row.role as SovereignRole };
    } catch {
      try {
        const result = await client.query<{ role: string; active: boolean }>(
          `SELECT role, active FROM solvex_private.tenant_memberships
           WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId],
        );
        const row = result.rows[0];
        if (!row || !VALID_ROLES.has(row.role as SovereignRole)) return null;
        return { active: Boolean(row.active), role: row.role as SovereignRole };
      } catch {
        return null;
      }
    }
  }

  async probeConnectivity(): Promise<{ ok: boolean; reason?: string }> {
    try {
      return await this.withClient(async (client) => {
        await client.query('SELECT 1 AS ok');
        try {
          await client.query(`SELECT 1 FROM solvex_private.auth_sessions WHERE false`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/does not exist|permission denied|relation/i.test(msg)) {
            return { ok: false, reason: 'auth_sessions table or grants missing; migration may not be applied' };
          }
          return { ok: false, reason: msg };
        }
        return { ok: true };
      });
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error('BLOCKED: invalid SQL identifier for SET ROLE.');
  }
  return `"${ident}"`;
}

/** In-memory session store used ONLY for unit tests. Never selected when AUTH_MODE=production. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly memberships = new Map<string, { active: boolean; role: SovereignRole }>();
  private readonly nowFn: () => number;

  constructor(now?: () => number) {
    this.nowFn = now ?? Date.now;
  }

  seedMembership(userId: string, tenantId: string, role: SovereignRole, active = true): void {
    this.memberships.set(`${userId}::${tenantId}`, { active, role });
  }

  async createSession(user: UserContext, ttlMs: number) {
    const membership = await this.revalidateMembership(user.user_id, user.tenant_id);
    if (!membership?.active) throw new Error('BLOCKED: tenant membership is missing or inactive.');
    const token = generateToken();
    const now = this.nowFn();
    const record: SessionRecord = {
      tokenHash: hashToken(token),
      userId: user.user_id,
      tenantId: user.tenant_id,
      email: user.email,
      role: membership.role,
      oidcSub: user.oidc_sub ?? null,
      createdAt: now,
      expiresAt: now + ttlMs,
      revokedAt: null,
    };
    this.sessions.set(record.tokenHash, record);
    return { token, record };
  }

  async findSessionByToken(token: string) {
    if (typeof token !== 'string' || token.length < 32) return null;
    const record = this.sessions.get(hashToken(token));
    if (!record) return null;
    if (record.revokedAt !== null || record.expiresAt <= this.nowFn()) return null;
    const membership = await this.revalidateMembership(record.userId, record.tenantId);
    if (!membership?.active) return null;
    return { ...record, role: membership.role };
  }

  async revokeSession(token: string) {
    const hash = hashToken(token);
    const record = this.sessions.get(hash);
    if (!record || record.revokedAt !== null) return false;
    record.revokedAt = this.nowFn();
    return true;
  }

  async revalidateMembership(userId: string, tenantId: string) {
    return this.memberships.get(`${userId}::${tenantId}`) ?? null;
  }

  async probeConnectivity() {
    return { ok: true };
  }
}
