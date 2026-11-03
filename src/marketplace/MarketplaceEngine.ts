import { computeSha256, OfferEntity } from '../database/DatabaseSchema';
import { DurableStore } from '../database/DurableStore';
import { SqliteStore } from '../database/SqliteStore';
import { AuthService, UserContext } from '../auth/AuthService';

export interface DefensiblePriceResult {
  cost_basis_cents: number;
  complexity_factor: number;
  risk_class: 'LOW' | 'MEDIUM' | 'HIGH';
  risk_multiplier: number;
  margin_factor: number;
  final_price_cents: number;
  calculation_hash: string;
}

export class MarketplaceEngine {
  private static instance: MarketplaceEngine | null = null;
  private durableStore: DurableStore;
  private sqlite: SqliteStore;

  private constructor() {
    this.durableStore = DurableStore.getInstance();
    this.sqlite = SqliteStore.getInstance();
  }

  public static getInstance(): MarketplaceEngine {
    if (!MarketplaceEngine.instance) {
      MarketplaceEngine.instance = new MarketplaceEngine();
    }
    return MarketplaceEngine.instance;
  }

  public calculateDefensiblePrice(
    costBasisCents: number,
    complexityFactor: number,
    riskClass: 'LOW' | 'MEDIUM' | 'HIGH'
  ): DefensiblePriceResult {
    const riskMultiplier = riskClass === 'LOW' ? 1.10 : riskClass === 'MEDIUM' ? 1.25 : 1.50;
    const marginFactor = 1.35;
    const raw = costBasisCents * complexityFactor * riskMultiplier * marginFactor;
    const finalPriceCents = Math.round(raw);
    const calculationHash = computeSha256(
      `V1.4:${costBasisCents}:${complexityFactor.toFixed(4)}:${riskClass}:${riskMultiplier}:${marginFactor}:${finalPriceCents}`
    );

    return {
      cost_basis_cents: costBasisCents,
      complexity_factor: complexityFactor,
      risk_class: riskClass,
      risk_multiplier: riskMultiplier,
      margin_factor: marginFactor,
      final_price_cents: finalPriceCents,
      calculation_hash: calculationHash
    };
  }

  public publishOffer(
    solutionId: string,
    proofBundleId: string,
    title: string,
    description: string,
    costBasisCents: number,
    complexityFactor: number,
    riskClass: 'LOW' | 'MEDIUM' | 'HIGH',
    identity?: UserContext
  ): { success: boolean; offer?: OfferEntity; error?: string } {
    const authorization = AuthService.getInstance().authorize(identity, 'PUBLISH_OFFER', 'TENANT_SOVEREIGN_ROOT');
    if (!authorization.authorized) {
      return { success: false, error: authorization.reason };
    }
    const state = this.durableStore.getState();
    const solution = state.solutions[solutionId];
    const bundle = state.proof_bundles[proofBundleId];

    // Fail-Closed Guard (Tests 17 & 24)
    if (!solution || solution.verification_status !== 'VERIFIED') {
      return {
        success: false,
        error: `Fail-closed Publication Blocked: Solution [${solutionId}] is missing or not marked VERIFIED (status=${solution?.verification_status || 'MISSING'}).`
      };
    }
    if (!bundle || bundle.verification_status !== 'VERIFIED') {
      return {
        success: false,
        error: `Fail-closed Publication Blocked: Proof Bundle [${proofBundleId}] is missing or not VERIFIED (status=${bundle?.verification_status || 'MISSING'}).`
      };
    }

    const priceCalc = this.calculateDefensiblePrice(costBasisCents, complexityFactor, riskClass);
    const offerId = `off_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const offer: OfferEntity = {
      id: offerId,
      offer_id: offerId,
      tenant_id: 'TENANT_SOVEREIGN_ROOT',
      solution_id: solutionId,
      proof_bundle_id: proofBundleId,
      title,
      description,
      cost_basis_cents: costBasisCents,
      verification_complexity_factor: complexityFactor,
      risk_class: riskClass,
      price_cents: priceCalc.final_price_cents,
      sla_tier: '99.99%_DETERMINISTIC_SLA',
      published: true,
      verification_status: 'VERIFIED',
      created_at: Date.now()
    };

    try {
      this.sqlite.insertRecord('offers', {
        id: offerId,
        tenant_id: offer.tenant_id,
        solution_id: solutionId,
        proof_bundle_id: proofBundleId,
        title,
        description,
        cost_basis_cents: costBasisCents,
        verification_complexity_factor: complexityFactor,
        risk_class: riskClass,
        price_cents: offer.price_cents,
        sla_tier: offer.sla_tier,
        published: 1,
        verification_status: 'VERIFIED',
        status: 'ACTIVE'
      });
      const persisted = this.sqlite.findTenantRecordById('offers', offer.tenant_id, offerId);
      if (!persisted) throw new Error('Offer persistence read-back failed.');
      state.offers[offerId] = offer;
      this.durableStore.persist();
      return { success: true, offer };
    } catch (error) {
      delete state.offers[offerId];
      this.sqlite.deleteTenantRecord('offers', offer.tenant_id, offerId);
      return {
        success: false,
        error: `Offer persistence failed closed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  public createOrder(tenantId: string, offerId: string, identity?: UserContext): { success: boolean; order?: any; error?: string } {
    const authorization = AuthService.getInstance().authorize(identity, 'CREATE_ORDER', tenantId);
    if (!authorization.authorized) {
      return { success: false, error: authorization.reason };
    }
    const state = this.durableStore.getState();
    const offer = state.offers[offerId];

    // Fail-Closed Guard (Test 25)
    if (!offer || !offer.published || offer.verification_status !== 'VERIFIED') {
      return {
        success: false,
        error: `Fail-closed: Order creation blocked on non-existent or unverified offer [${offerId}].`
      };
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const order = {
      id: orderId,
      tenant_id: tenantId,
      offer_id: offerId,
      solution_id: offer.solution_id,
      proof_bundle_id: offer.proof_bundle_id,
      price_cents: offer.price_cents,
      status: 'OFFER' as const,
      created_at: Date.now()
    };

    try {
      this.sqlite.insertRecord('orders', {
        id: order.id,
        tenant_id: tenantId,
        offer_id: order.offer_id,
        solution_id: order.solution_id,
        proof_bundle_id: order.proof_bundle_id,
        price_cents: order.price_cents,
        status: 'OFFER'
      });
      const persisted = this.sqlite.findTenantRecordById('orders', tenantId, orderId);
      if (!persisted) throw new Error('Order persistence read-back failed.');
      this.durableStore.appendAudit(
        tenantId,
        'MARKETPLACE_ORDER_GATE',
        'CREATE_ORDER',
        'ORDER',
        orderId,
        { offerId, priceCents: order.price_cents }
      );
      return { success: true, order };
    } catch (error) {
      this.sqlite.deleteTenantRecord('orders', tenantId, orderId);
      return {
        success: false,
        error: `Order creation failed closed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
