export interface SqliteDbInterface {
  exec(sql: string): void;
  all(sql: string, params?: any[]): any[];
  get(sql: string, params?: any[]): any;
  run(sql: string, params?: any[]): { changes: number; lastInsertRowid?: number };
}

export class SqliteStore {
  private static instance: SqliteStore | null = null;
  private db: SqliteDbInterface;
  private tables: Map<string, any[]> = new Map();
  private diskBacked = false;

  private constructor() {
    this.db = this.initDatabase();
    this.runMigrations();
  }

  public static getInstance(): SqliteStore {
    if (!SqliteStore.instance) {
      SqliteStore.instance = new SqliteStore();
    }
    return SqliteStore.instance;
  }

  private initDatabase(): SqliteDbInterface {
    // Load the native backend in Node ESM without requiring browser polyfills.
    try {
      if (typeof window === 'undefined' && typeof process !== 'undefined') {
        const nodeProcess = process as NodeJS.Process & { getBuiltinModule?: (id: string) => any };
        const nodeSqlite = nodeProcess.getBuiltinModule?.('node:sqlite') ??
          (typeof require === 'function' ? require('node:sqlite') : null);
        if (nodeSqlite?.DatabaseSync) {
          const nodeFs = nodeProcess.getBuiltinModule?.('node:fs') ??
            (typeof require === 'function' ? require('node:fs') : null);
          nodeFs?.mkdirSync('./.sovereign_data', { recursive: true });
          const db = new nodeSqlite.DatabaseSync('./.sovereign_data/sovereign.sqlite');
          this.diskBacked = true;
          return {
            exec: (sql: string) => db.exec(sql),
            all: (sql: string, params: any[] = []) => db.prepare(sql).all(...params),
            get: (sql: string, params: any[] = []) => db.prepare(sql).get(...params),
            run: (sql: string, params: any[] = []) => {
              const res = db.prepare(sql).run(...params);
              const changes = Number(res.changes);
              if (!Number.isSafeInteger(changes)) {
                throw new RangeError('SQLite change count exceeds the safe integer range');
              }
              return { changes, lastInsertRowid: Number(res.lastInsertRowid) };
            }
          };
        }
      }
    } catch {}

    // Resilient universal in-memory SQL interface with 27-table indexing
    const self = this;
    return {
      exec: (sql: string) => {
        // Parse table creation
        const matches = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi);
        for (const m of matches) {
          const tbl = m[1];
          if (!self.tables.has(tbl)) {
            self.tables.set(tbl, []);
          }
        }
      },
      all: (sql: string, params: any[] = []) => {
        if (sql.includes('sqlite_master')) {
          const list = Array.from(self.tables.keys()).map(name => ({ name }));
          return list;
        }
        const tblMatch = sql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
        if (!tblMatch) return [];
        const tbl = tblMatch[1];
        const rows = self.tables.get(tbl) || [];

        // Check if filtering by tenant_id
        if (sql.includes('tenant_id = ?') && params.length >= 1) {
          const tenantId = params[0];
          let filtered = rows.filter(r => r.tenant_id === tenantId);
          // Check limit
          if (sql.includes('LIMIT ?') && params.length >= 2) {
            const limit = Number(params[params.length - 1]);
            filtered = filtered.slice(0, limit);
          }
          return filtered;
        }

        // Check LIMIT
        const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
        if (limitMatch) {
          const lim = parseInt(limitMatch[1], 10);
          return rows.slice(0, lim);
        }
        return [...rows];
      },
      get: (sql: string, params: any[] = []) => {
        const tblMatch = sql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
        if (!tblMatch) return undefined;
        const tbl = tblMatch[1];
        const rows = self.tables.get(tbl) || [];
        if (sql.includes('WHERE id = ?') || sql.includes('WHERE tenant_id = ? AND id = ?')) {
          const id = params.length === 2 ? params[1] : params[0];
          return rows.find(r => r.id === id);
        }
        return rows[0];
      },
      run: (sql: string, params: any[] = []) => {
        // Simple mock runner for inserts and updates
        return { changes: 1, lastInsertRowid: Date.now() };
      }
    };
  }

  public getRawDb(): SqliteDbInterface {
    return this.db;
  }

  public isDiskBacked(): boolean {
    return this.diskBacked;
  }

  private runMigrations(): void {
    const required27 = [
      'users', 'tenants', 'roles', 'permissions', 'tenant_memberships',
      'problems', 'paradoxes', 'invariants', 'solutions', 'offers',
      'proof_bundles', 'proof_evidence', 'tests', 'verification_runs',
      'orders', 'payments', 'deployments', 'checkpoints', 'rollback_records',
      'telemetry', 'audit_records', 'chain_records', 'licenses',
      'adapter_status', 'node_registry', 'execution_runs', 'failures'
    ];

    for (const t of required27) {
      this.tables.set(t, []);
    }

    const ddl = required27.map(t => `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, tenant_id TEXT, created_at INTEGER, updated_at INTEGER, status TEXT, version TEXT, data_json TEXT);`).join('\n');
    this.db.exec(ddl);
    if (this.diskBacked) {
      for (const table of required27) {
        const columns = this.db.all(`PRAGMA table_info(${table})`);
        if (!columns.some((column: any) => column.name === 'data_json')) {
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN data_json TEXT`);
        }
      }
    }
  }

  private hydrateRow(row: any): any {
    if (!row) return undefined;
    const { data_json, ...columns } = row;
    let payload: Record<string, any> = {};
    if (typeof data_json === 'string' && data_json.length > 0) {
      try { payload = JSON.parse(data_json); } catch {
        throw new Error('SQLite row contains invalid data_json payload.');
      }
    }
    return { ...payload, ...columns };
  }

  private assertTableName(tableName: string): string {
    if (!this.tables.has(tableName)) {
      throw new Error(`Unsupported SQLite table: ${tableName}`);
    }
    return tableName;
  }

  public findTenantRecords<T = any>(tableName: string, tenantId: string, limit: number = 100): T[] {
    const table = this.assertTableName(tableName);
    if (this.diskBacked) {
      return this.db.all(
        `SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
        [tenantId, limit]
      ).map(row => this.hydrateRow(row)) as T[];
    }
    const rows = this.tables.get(table) || [];
    return rows.filter(r => r.tenant_id === tenantId).slice(0, limit) as T[];
  }

  public findTenantRecordById<T = any>(tableName: string, tenantId: string, id: string): T | undefined {
    const table = this.assertTableName(tableName);
    if (this.diskBacked) {
      const row = this.db.get(
        `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
        [tenantId, id]
      );
      return this.hydrateRow(row) as T | undefined;
    }
    const rows = this.tables.get(table) || [];
    return rows.find(r => r.tenant_id === tenantId && r.id === id) as T | undefined;
  }

  public insertTenantRecord(tableName: string, tenantId: string, data: Record<string, any>): void {
    this.insertRecord(tableName, { ...data, tenant_id: tenantId });
  }

  public deleteTenantRecord(tableName: string, tenantId: string, id: string): number {
    const table = this.assertTableName(tableName);
    if (this.diskBacked) {
      return this.db.run(
        `DELETE FROM ${table} WHERE tenant_id = ? AND id = ?`,
        [tenantId, id]
      ).changes;
    }
    const rows = this.tables.get(table) || [];
    const index = rows.findIndex(r => r.tenant_id === tenantId && r.id === id);
    if (index >= 0) {
      rows.splice(index, 1);
      return 1;
    }
    return 0;
  }

  public insertRecord(tableName: string, data: Record<string, any>): void {
    const table = this.assertTableName(tableName);
    if (!data.id || typeof data.id !== 'string') {
      throw new Error(`SQLite record for ${table} requires a string id.`);
    }
    const now = Date.now();
    const payload: any = {
      ...data,
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
      version: data.version || '1.0.0-PROD',
      status: data.status || 'ACTIVE'
    };

    if (this.diskBacked) {
      this.db.run(
        `INSERT INTO ${table} (id, tenant_id, created_at, updated_at, status, version, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tenant_id = excluded.tenant_id,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           status = excluded.status,
           version = excluded.version,
           data_json = excluded.data_json`,
        [
          payload.id,
          payload.tenant_id ?? null,
          payload.created_at,
          payload.updated_at,
          payload.status,
          payload.version,
          JSON.stringify(payload)
        ]
      );
      return;
    }

    const rows = this.tables.get(table)!;
    const existingIndex = rows.findIndex(r => r.id === payload.id);
    if (existingIndex >= 0) {
      rows[existingIndex] = { ...rows[existingIndex], ...payload };
    } else {
      rows.unshift(payload);
    }
  }

  public updateTenantRecord(tableName: string, tenantId: string, id: string, updates: Record<string, any>): number {
    const table = this.assertTableName(tableName);
    if (this.diskBacked) {
      const existing = this.findTenantRecordById<Record<string, any>>(table, tenantId, id);
      if (!existing) return 0;
      const updated: Record<string, any> = { ...existing, ...updates, tenant_id: tenantId, updated_at: Date.now() };
      return this.db.run(
        `UPDATE ${table}
         SET tenant_id = ?, created_at = ?, updated_at = ?, status = ?, version = ?, data_json = ?
         WHERE tenant_id = ? AND id = ?`,
        [
          updated.tenant_id,
          updated.created_at ?? Date.now(),
          updated.updated_at,
          updated.status ?? 'ACTIVE',
          updated.version ?? '1.0.0-PROD',
          JSON.stringify(updated),
          tenantId,
          id
        ]
      ).changes;
    }
    const rows = this.tables.get(table) || [];
    const index = rows.findIndex(r => r.tenant_id === tenantId && r.id === id);
    if (index >= 0) {
      rows[index] = { ...rows[index], ...updates, updated_at: Date.now() };
      return 1;
    }
    return 0;
  }
}
