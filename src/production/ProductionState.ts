export type ProductionMode = 'local' | 'sandbox' | 'production';
export type ProductionReadiness = 'BLOCKED' | 'READY';
export type ProductionActivation = 'LOCAL' | 'BLOCKED' | 'ACTIVE';

export interface ProductionStateSnapshot {
  status: ProductionActivation;
  environment: ProductionMode;
  readiness: ProductionReadiness;
  authentication_enabled: boolean;
  payments_enabled: boolean;
  neon_configured: boolean;
  blockers: string[];
}

export class ProductionStateService {
  private static normalizeEnvironment(value?: string): ProductionMode {
    const mode = (value || 'local').toLowerCase();
    if (mode === 'production') return 'production';
    if (mode === 'sandbox') return 'sandbox';
    return 'local';
  }

  public static getState(): ProductionStateSnapshot {
    const environment = this.normalizeEnvironment(process.env.SOLVEX_ENV);
    const paymentsEnabled = String(process.env.PAYMENTS_ENABLED || 'false').toLowerCase() === 'true';
    const authConfigured = Boolean(process.env.OIDC_ISSUER || process.env.OIDC_CLIENT_ID || process.env.OIDC_AUTHORITY);
    const neonConfigured = Boolean(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);
    const blockers: string[] = [];

    if (environment !== 'production') {
      blockers.push('SOLVEX_ENV must be set to production before the runtime can claim production readiness.');
    }
    if (!authConfigured) {
      blockers.push('Production OIDC issuer and signed-claim verification are not configured; auth remains fail-closed.');
    }
    blockers.push('First-party OIDC token verification and signed tenant-claim enforcement are not implemented; authentication remains fail-closed.');
    if (!neonConfigured) {
      blockers.push('NEON_DATABASE_URL or DATABASE_URL is not configured; cloud persistence is unavailable.');
    }
    if (paymentsEnabled) {
      blockers.push('Payments are intentionally disabled in this repo; PAYMENTS_ENABLED must remain false until the production gate is complete.');
    }

    const readiness: ProductionReadiness = blockers.length === 0 ? 'READY' : 'BLOCKED';
    const status: ProductionActivation = blockers.length === 0 ? 'ACTIVE' : 'BLOCKED';

    return {
      status,
      environment,
      readiness,
      authentication_enabled: false,
      payments_enabled: false,
      neon_configured: neonConfigured,
      blockers
    };
  }
}
