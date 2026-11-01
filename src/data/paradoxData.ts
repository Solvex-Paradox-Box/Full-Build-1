export type ModelClassification = 'AUTHORED_MODEL' | 'GENERATED_GENERALIZED_MODEL';
export type ModelScope = 'MODEL_ONLY' | 'IMPLEMENTATION_BACKED';

export interface DFRLParadoxItem {
  code: string;
  name: string;
  domain: string;
  category: string;
  model_classification: ModelClassification;
  model_scope: ModelScope;
  classical_antinomy: string;
  formal_invariant: string;
  machine_checked_status: 'VERIFIED' | 'EQUIVALENT_FAMILY' | 'SMT_CERTIFIED';
  z3_smt_assertion: string;
  proof_bundle_ref: string;
  expected_solver_result: 'sat' | 'unsat';
}
