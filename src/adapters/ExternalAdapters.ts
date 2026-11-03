import { PayPalAdapter } from '../payments/PayPalAdapter';

export interface ExternalAdapterInfo {
  adapter_id: string;
  name: string;
  category: string;
  status: 'AVAILABLE' | 'EXTERNAL_PROVIDER_REQUIRED' | 'DEGRADED';
  required_env_vars: string[];
  provided_env_vars: string[];
  live_connected: boolean;
  notes: string;
}

export class ExternalAdapterRegistry {
  public static getInventory(): ExternalAdapterInfo[] {
    const paypalAdapter = PayPalAdapter.getInstance();
    const hasPayPal = paypalAdapter.hasActiveCredentials();
    const hasNeon = Boolean(typeof process !== 'undefined' && process.env?.NEON_DATABASE_URL);

    return [
      {
        adapter_id: 'DN-34',
        name: 'Neon Serverless PostgreSQL',
        category: 'DATABASE',
        status: hasNeon ? 'DEGRADED' : 'EXTERNAL_PROVIDER_REQUIRED',
        required_env_vars: ['NEON_DATABASE_URL'],
        provided_env_vars: hasNeon ? ['NEON_DATABASE_URL'] : [],
        live_connected: false,
        notes: hasNeon
          ? 'Connection, schema, and tenant-isolation checks have not been performed by this inventory.'
          : 'Neon is not configured. Any local persistence fallback must be verified separately; configuration inventory does not establish durable storage.'
      },
      {
        adapter_id: 'DN-35',
        name: 'PayPal Enterprise Gateway',
        category: 'PAYMENTS',
        status: hasPayPal ? 'AVAILABLE' : 'EXTERNAL_PROVIDER_REQUIRED',
        required_env_vars: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
        provided_env_vars: hasPayPal ? ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] : [],
        live_connected: hasPayPal,
        notes: 'Server-authoritative payment capture. Enforces fail-closed: refuses to fabricate synthetic payment receipts.'
      },
      {
        adapter_id: 'DN-36',
        name: 'Fiat Settlement Policy Guard (Stripe Prohibited)',
        category: 'POLICY_INTERLOCK',
        status: 'AVAILABLE',
        required_env_vars: [],
        provided_env_vars: [],
        live_connected: false,
        notes: 'Stripe prohibited per Sovereign Security Directive. Fiat payments and escrow settle exclusively via PayPal DN-35.'
      },
      {
        adapter_id: 'DN-37',
        name: 'Coinbase Commerce',
        category: 'PAYMENTS',
        status: 'EXTERNAL_PROVIDER_REQUIRED',
        required_env_vars: ['COINBASE_API_KEY'],
        provided_env_vars: [],
        live_connected: false,
        notes: 'Crypto commerce webhook handler.'
      }
    ];
  }
}
