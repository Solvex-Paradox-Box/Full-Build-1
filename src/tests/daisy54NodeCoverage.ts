import { DaisySubsystemExecutors, SubsystemExecutionResult } from '../nodes/DaisySubsystemExecutors';

export interface NodeCoverageReport {
  total_nodes: number;
  registered_count: number;
  instantiated_count: number;
  reachable_count: number;
  executed_count: number;
  output_asserted_count: number;
  evidence_generated_count: number;
  unsatisfied_node_ids: string[];
  internal_previously_covered: number;
  internal_newly_covered: number;
  external_gateways: number;
  policy_interlocks: number;
  all_passed: boolean;
  results: SubsystemExecutionResult[];
  breakdown: {
    baseline_internal_18: SubsystemExecutionResult[];
    expanded_internal_34: SubsystemExecutionResult[];
    gateways_2: SubsystemExecutionResult[];
  };
}

export async function runDaisy54NodeCoverage(): Promise<NodeCoverageReport> {
  const executors = DaisySubsystemExecutors.getInstance();
  const rawResults = await executors.executeAll54Nodes();

  // Baseline 18 internal nodes that had prior test coverage
  const baseline18Ids = [
    'DN-01', 'DN-02', 'DN-03', 'DN-04', 'DN-05', 'DN-06', 'DN-07', 'DN-08',
    'DN-09', 'DN-10', 'DN-11', 'DN-12', 'DN-13', 'DN-14', 'DN-15', 'DN-16',
    'DN-17', 'DN-18'
  ];

  // External gateways: DN-34 (Neon), DN-35 (PayPal)
  const gatewayIds = ['DN-34', 'DN-35'];

  // 34 expanded internal subsystems, including the policy interlock DN-36.
  const baselineResults = rawResults.results.filter(r => baseline18Ids.includes(r.node_id));
  const gatewayResults = rawResults.results.filter(r => gatewayIds.includes(r.node_id));
  const expandedResults = rawResults.results.filter(r => !baseline18Ids.includes(r.node_id) && !gatewayIds.includes(r.node_id));

  // Determine any unsatisfied nodes
  const unsatisfied = rawResults.results.filter(
    r => !r.registered || !r.instantiated || !r.reachable || !r.executed || !r.output_asserted || !r.evidence_generated
  );

  // Invocation and fail-closed outcomes are not functional success.
  // Provider-required and prohibited outcomes remain visible, but never count
  // as successful subsystem operation.
  const allFunctionallySuccessful = rawResults.results.every(r => r.status === 'SUCCESS');
  const noExecutionErrors = rawResults.results.every(r => r.status !== 'FAIL');

  return {
    total_nodes: rawResults.total,
    registered_count: rawResults.registered,
    instantiated_count: rawResults.instantiated,
    reachable_count: rawResults.reachable,
    executed_count: rawResults.executed,
    output_asserted_count: rawResults.output_asserted,
    evidence_generated_count: rawResults.evidence_generated,
    unsatisfied_node_ids: unsatisfied.map(u => u.node_id),
    internal_previously_covered: baselineResults.length,
    internal_newly_covered: expandedResults.length,
    external_gateways: gatewayResults.length,
    policy_interlocks: rawResults.results.filter(r => r.status === 'PROHIBITED_BLOCKED').length,
    all_passed: allFunctionallySuccessful && noExecutionErrors && unsatisfied.length === 0,
    results: rawResults.results,
    breakdown: {
      baseline_internal_18: baselineResults,
      expanded_internal_34: expandedResults,
      gateways_2: gatewayResults
    }
  };
}
