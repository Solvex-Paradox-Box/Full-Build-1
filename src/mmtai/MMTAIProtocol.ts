import { computeSha256 } from '../database/DatabaseSchema';

export class MMTAIProtocol {
  private static instance: MMTAIProtocol | null = null;
  private activeTokens: Map<string, { role: string; capability: string; tenantId: string; created: number }> = new Map();
  private consumedTokens: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): MMTAIProtocol {
    if (!MMTAIProtocol.instance) {
      MMTAIProtocol.instance = new MMTAIProtocol();
    }
    return MMTAIProtocol.instance;
  }

  public issueAuthorizationToken(_role: string, _capability: string, _tenantId: string): string {
    // Capability names and caller-supplied role strings are not authority.
    // No human-root approval verifier or signed authority-grant adapter is
    // configured in this build, so token minting must remain disabled.
    throw new Error('BLOCKED: authorization-token issuance requires verified human-root approval and a signed authority grant; no verifier is configured.');
  }

  public authorizeExecution(
    capability: string,
    role: string,
    token: string,
    operation: string,
    tenantId: string
  ): { permitted: boolean; error?: string } {
    if (this.consumedTokens.has(token)) {
      return {
        permitted: false,
        error: `Replay Attack Blocked: Single-use token ${token.substring(0, 12)}... was previously consumed. Invariant [AUTHORITY != AUTHORIZATION] enforced.`
      };
    }
    const record = this.activeTokens.get(token);
    if (!record) {
      return {
        permitted: false,
        error: 'Invalid or expired authorization token'
      };
    }
    if (record.role !== role || record.capability !== capability || record.tenantId !== tenantId) {
      return {
        permitted: false,
        error: 'Token context mismatch'
      };
    }
    // Burn token immediately to guarantee single-use replay protection
    this.activeTokens.delete(token);
    this.consumedTokens.add(token);
    return { permitted: true };
  }
}
