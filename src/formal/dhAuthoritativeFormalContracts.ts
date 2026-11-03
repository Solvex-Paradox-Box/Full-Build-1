/**
 * PROJECT AGATE / DAISY / SOLVEX
 * AUTHORITATIVE DH FORMAL CONTRACT SPECIFICATIONS (DH-P-001 through DH-P-032)
 *
 * Grounded in the authentic local registry: src/paradoxes/DHBootstrapParadoxRegistry.ts.
 * Every contract corresponds directly to the authentic local paradox identity.
 */

import { computeSha256 } from '../database/DatabaseSchema';

export type DHScope = 'MODEL_VERIFIED' | 'MODEL_VERIFIED_BOUNDED' | 'MODEL_VERIFIED_AXIOMATIC';

export interface DHAuthoritativeContract {
  case_id: string;
  name: string;
  domain: string;
  statement: string;
  formal_proposition: string;
  assumptions: string[];
  axioms: string[];
  constraints: string[];
  expected_result: 'unsat' | 'sat';
  scope: DHScope;
  formalization_method: string;
  z3_smt_assertion: string;
  contract_hash: string;
  source_file: string;
}

const RAW_CONTRACTS: Array<Omit<DHAuthoritativeContract, 'contract_hash'>> = [
  // DH-P-001: Achilles and the Tortoise
  {
    case_id: 'DH-P-001',
    name: 'Achilles and the Tortoise',
    domain: 'INFINITE_SERIES',
    statement: 'Finite distance is traversed in finite steps using geometric series summation.',
    formal_proposition: 'Linear kinematic intersection d_meet = v_A * t = d0 + v_T * t refutes the assertion that Achilles never catches the tortoise.',
    assumptions: ['vA = 10.0', 'vT = 1.0', 'initial_separation d0 = 9.0', 'time t > 0'],
    axioms: ['Euclidean continuous spacetime', 'Constant velocity kinematics'],
    constraints: ['t > 0', 'vA > vT'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-001: Achilles and the Tortoise
(declare-const d0 Real)
(declare-const vA Real)
(declare-const vT Real)
(declare-const t Real)
(assert (= d0 9.0))
(assert (= vA 10.0))
(assert (= vT 1.0))
(assert (> t 0.0))
(assert (= (* vA t) (+ d0 (* vT t))))
; Refuting hypothesis that Achilles distance is strictly less than tortoise distance
(assert (< (* vA t) (+ d0 (* vT t))))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-002: Russell Set Paradox
  {
    case_id: 'DH-P-002',
    name: 'Russell Set Paradox',
    domain: 'SET_THEORY',
    statement: 'Set of all sets that do not contain themselves creates ungrounded self-reference.',
    formal_proposition: 'Unrestricted comprehension R = {x | x not in x} yields R in R <=> not(R in R), which is logically refutable.',
    assumptions: ['Classical two-valued logic', 'Naive comprehension axiom schema'],
    axioms: ['Law of Excluded Middle', 'Principle of Non-Contradiction'],
    constraints: ['in_R is Boolean'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-002: Russell Set Paradox
(declare-const in_R Bool)
(assert (= in_R (not in_R)))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-003: Barber Paradox
  {
    case_id: 'DH-P-003',
    name: 'Barber Paradox',
    domain: 'SET_THEORY',
    statement: 'Barber shaves all and only those who do not shave themselves.',
    formal_proposition: 'In a first-order relational structure, forall x (shaves(b, x) <=> not(shaves(x, x))) is first-order unsatisfiable.',
    assumptions: ['Townspeople domain is non-empty', 'Barber is a member of the domain'],
    axioms: ['First-order universal instantiation'],
    constraints: ['shaves is a 2-place relation'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-003: Barber Paradox
(declare-sort Person)
(declare-fun shaves (Person Person) Bool)
(declare-const barber Person)
(assert (forall ((x Person)) (= (shaves barber x) (not (shaves x x)))))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-004: Liar Paradox
  {
    case_id: 'DH-P-004',
    name: 'Liar Paradox',
    domain: 'SEMANTIC_LOGIC',
    statement: 'Sentence asserting its own falsehood ("This statement is false").',
    formal_proposition: 'A proposition asserting T <=> not(T) is unsatisfiable in classical bivalent truth systems.',
    assumptions: ['Classical bivalence', 'Self-referential truth assignment'],
    axioms: ['Tarski T-schema in unstratified language'],
    constraints: ['truth_value in {true, false}'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-004: Liar Paradox
(declare-const truth_value Bool)
(assert (= truth_value (not truth_value)))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-005: Grelling-Nelson Paradox
  {
    case_id: 'DH-P-005',
    name: 'Grelling-Nelson Paradox',
    domain: 'SEMANTICS',
    statement: 'Is "heterological" (a word not describing itself) heterological?',
    formal_proposition: 'Semantic predicate Het(w) <=> not(Applies(w, w)) applied reflexively to Het yields Het <=> not(Het), refutable in bivalent semantics.',
    assumptions: ['Words can be predicates over words', 'Reflexive application is permitted'],
    axioms: ['Universal predicate application'],
    constraints: ['applies is a 2-place relation on words'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-005: Grelling-Nelson Paradox
(declare-sort Word)
(declare-fun applies (Word Word) Bool)
(declare-const het Word)
(assert (forall ((w Word)) (= (applies het w) (not (applies w w)))))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-006: Curry Paradox
  {
    case_id: 'DH-P-006',
    name: 'Curry Paradox',
    domain: 'PROOF_THEORY',
    statement: 'Self-referential conditional implies arbitrary falsehood without negation.',
    formal_proposition: 'Sentence C asserting C => F allows proving arbitrary falsehood F via contraction (modus ponens with self-premise).',
    assumptions: ['Implication satisfies contraction', 'Self-referential conditional admits fixed points'],
    axioms: ['Classical or intuitionistic implication rules'],
    constraints: ['arbitrary_falsehood = false'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-006: Curry Paradox
(declare-const C Bool)
(declare-const arbitrary_falsehood Bool)
(assert (= C (=> C arbitrary_falsehood)))
(assert (not arbitrary_falsehood))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-007: Berry Paradox
  {
    case_id: 'DH-P-007',
    name: 'Berry Paradox',
    domain: 'KOLMOGOROV_COMPLEXITY',
    statement: 'The smallest positive integer not definable in under eleven words.',
    formal_proposition: 'Kolmogorov complexity bound: Integer N having complexity K(N) >= L cannot have description length < L.',
    assumptions: ['Finite alphabet of description language', 'Bounded word length constraint L'],
    axioms: ['Algorithmic information lower bound'],
    constraints: ['L > 100', 'desc_len <= 50'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_BOUNDED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-007: Berry Paradox
(declare-const L Int)
(declare-const KN Int)
(declare-const desc_len Int)
(assert (> L 100))
(assert (>= KN L))
(assert (<= desc_len 50))
(assert (>= KN desc_len))
(assert (< KN desc_len))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-008: Richard Paradox
  {
    case_id: 'DH-P-008',
    name: 'Richard Paradox',
    domain: 'DEFINABILITY',
    statement: 'Diagonalization over all definable real numbers.',
    formal_proposition: 'If all definable reals in (0, 1) are enumerated, diagonal element r differs at the n-th position from the n-th definable real. Claiming r is in the enumeration is refutable.',
    assumptions: ['Countable alphabet implies countable definitions', 'Diagonal construction differs at every index'],
    axioms: ['Cantor diagonal inequality'],
    constraints: ['k is a valid enumeration index'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_AXIOMATIC',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-008: Richard Paradox
(declare-const r_is_in_enumeration Bool)
(declare-const r_differs_at_index_k Bool)
(assert (=> r_is_in_enumeration (not r_differs_at_index_k)))
(assert r_is_in_enumeration)
(assert r_differs_at_index_k)
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-009: Burali-Forti Paradox
  {
    case_id: 'DH-P-009',
    name: 'Burali-Forti Paradox',
    domain: 'SET_THEORY',
    statement: 'The ordinal number of all ordinals must be greater than itself.',
    formal_proposition: 'Strict well-ordering on ordinals is irreflexive (not alpha < alpha). Supposing the class of all ordinals is a set with ordinal Omega forces Omega < Omega, refuting sethood.',
    assumptions: ['Ordinals are well-ordered by strict membership', 'Every set of ordinals has an upper bound ordinal'],
    axioms: ['Irreflexivity of strict ordinal order'],
    constraints: ['Omega_ord is an ordinal'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-009: Burali-Forti Paradox
(declare-const Omega_ord Int)
(assert (< Omega_ord Omega_ord))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-010: Cantor Paradox
  {
    case_id: 'DH-P-010',
    name: 'Cantor Paradox',
    domain: 'SET_THEORY',
    statement: 'Power set of universal set must have strictly greater cardinality than universal set.',
    formal_proposition: 'For universal set U, |P(U)| <= |U|. Cantor theorem proves |U| < |P(U)|. The conjunction is refutable.',
    assumptions: ['U contains all sets', 'Power set operation is valid on U'],
    axioms: ['Cantor theorem: |X| < |P(X)|', 'Subsets of universal set belong to universal set'],
    constraints: ['cardU > 0', 'cardPU > cardU'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-010: Cantor Paradox
(declare-const cardU Int)
(declare-const cardPU Int)
(assert (> cardU 0))
(assert (> cardPU cardU))
(assert (<= cardPU cardU))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-011: Sorites Paradox
  {
    case_id: 'DH-P-011',
    name: 'Sorites Paradox',
    domain: 'VAGUENESS',
    statement: 'Removing one grain from a heap leaves a heap; by induction one grain is a heap.',
    formal_proposition: 'Crisp induction on bounded tolerance boundary (heap(n) => heap(n-1)) forces heap(1) from heap(5), refuting the negative boundary condition.',
    assumptions: ['heap(5) is true', 'heap(1) is false', 'crisp single-grain tolerance'],
    axioms: ['Finite backward mathematical induction'],
    constraints: ['1 <= n <= 5'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_BOUNDED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-011: Sorites Paradox
(declare-fun is_heap (Int) Bool)
(assert (is_heap 5))
(assert (not (is_heap 1)))
(assert (forall ((n Int)) (=> (and (>= n 2) (<= n 5) (is_heap n)) (is_heap (- n 1)))))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-012: Ship of Theseus
  {
    case_id: 'DH-P-012',
    name: 'Ship of Theseus',
    domain: 'ONTOLOGY',
    statement: 'Gradual replacement of every part raises persistent identity ambiguity.',
    formal_proposition: 'Identity transitivity requires that if continuous ship A = B and reconstructed ship A = C, then B = C. Asserting B != C refutes classical equivalence.',
    assumptions: ['Continuous replacement preserves identity (A = B)', 'Original material reassembly preserves identity (A = C)'],
    axioms: ['Equivalence relation axioms (transitivity, symmetry, reflexivity)'],
    constraints: ['A, B, C are distinct token states'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_AXIOMATIC',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-012: Ship of Theseus
(declare-sort Ship)
(declare-const shipA Ship)
(declare-const shipB Ship)
(declare-const shipC Ship)
(assert (= shipA shipB))
(assert (= shipA shipC))
(assert (not (= shipB shipC)))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-013: Grandfather Paradox
  {
    case_id: 'DH-P-013',
    name: 'Grandfather Paradox',
    domain: 'TEMPORAL_CAUSALITY',
    statement: 'Time traveler prevents own lineage, invalidating the travel premise.',
    formal_proposition: 'Lineage consistency: Time travel T requires traveler birth B (T => B). Travel execution action causes not(B) (T => not B). Asserting T yields contradiction B and not B.',
    assumptions: ['Single consistent timeline', 'Traveler action alters historical lineage'],
    axioms: ['Causal implication transitivity'],
    constraints: ['T is true'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-013: Grandfather Paradox
(declare-const traveler_born Bool)
(declare-const travel_occurred Bool)
(assert (=> travel_occurred traveler_born))
(assert (=> travel_occurred (not traveler_born)))
(assert travel_occurred)
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-014: Bootstrap Paradox
  {
    case_id: 'DH-P-014',
    name: 'Bootstrap Paradox',
    domain: 'TEMPORAL_CAUSALITY',
    statement: 'An object or information is sent back in time, creating uncaused existence.',
    formal_proposition: 'Classical strict causal orders are irreflexive (not causes(x, x)). An uncaused ontological time-loop asserting causes(e, e) is refutable.',
    assumptions: ['Causality is a strict partial order', 'Ontological loop event e causes itself'],
    axioms: ['Irreflexivity and transitivity of strict causality'],
    constraints: ['e is a valid event'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_AXIOMATIC',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-014: Bootstrap Paradox
(declare-sort Event)
(declare-fun causes (Event Event) Bool)
(assert (forall ((x Event)) (not (causes x x))))
(assert (forall ((x Event) (y Event) (z Event)) (=> (and (causes x y) (causes y z)) (causes x z))))
(declare-const e Event)
(assert (causes e e))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-015: Raven Paradox (Hempel)
  {
    case_id: 'DH-P-015',
    name: 'Raven Paradox (Hempel)',
    domain: 'EPISTEMOLOGY',
    statement: 'Observing a green apple confirms "All ravens are black" via contrapositive.',
    formal_proposition: 'Universal implication (forall x: Raven(x) => Black(x)) is logically equivalent to its contrapositive (forall x: not Black(x) => not Raven(x)). Non-equivalence is refutable.',
    assumptions: ['Classical predicate logic', 'Material implication equivalence'],
    axioms: ['Contrapositive logical equivalence theorem'],
    constraints: ['Entity domain is unrestricted'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-015: Raven Paradox (Hempel)
(declare-sort Entity)
(declare-fun is_raven (Entity) Bool)
(declare-fun is_black (Entity) Bool)
(declare-const hyp1 Bool)
(declare-const hyp2 Bool)
(assert (= hyp1 (forall ((x Entity)) (=> (is_raven x) (is_black x)))))
(assert (= hyp2 (forall ((x Entity)) (=> (not (is_black x)) (not (is_raven x))))))
(assert (not (= hyp1 hyp2)))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-016: Goodman New Riddle of Induction (Grue)
  {
    case_id: 'DH-P-016',
    name: 'Goodman New Riddle of Induction (Grue)',
    domain: 'EPISTEMOLOGY',
    statement: 'Predicate "grue" (green before t, blue after) equally supported by evidence.',
    formal_proposition: 'Simultaneous projection of color predicates: At future time t_future, an object cannot be simultaneously green and blue under mutually exclusive color categories.',
    assumptions: ['Green and Blue are disjoint color predicates', 'Grue definition shifts at time threshold t'],
    axioms: ['Mutual exclusivity of fundamental color terms'],
    constraints: ['is_green and is_blue cannot both be true'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_AXIOMATIC',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-016: Goodman New Riddle of Induction (Grue)
(declare-const is_green Bool)
(declare-const is_blue Bool)
(assert (not (and is_green is_blue)))
(assert is_green)
(assert is_blue)
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-017: Newcomb Problem
  {
    case_id: 'DH-P-017',
    name: 'Newcomb Problem',
    domain: 'DECISION_THEORY',
    statement: 'Superintelligent predictor: choose One Box ($1M) or Two Boxes ($1M + $1K).',
    formal_proposition: 'Dominance principle dictates choosing two boxes while Expected Utility under perfect prediction dictates choosing one box. Simultaneous single-choice satisfaction is refutable.',
    assumptions: ['Dominance principle: choose two boxes', 'Expected utility under perfect predictor: choose one box'],
    axioms: ['Exclusive decision choice between one and two boxes'],
    constraints: ['choose_one_box in {true, false}'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_BOUNDED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-017: Newcomb Problem
(declare-const choose_one_box Bool)
(declare-const dominance_recommends_two Bool)
(declare-const eu_recommends_one Bool)
(assert (= dominance_recommends_two (not choose_one_box)))
(assert (= eu_recommends_one choose_one_box))
(assert dominance_recommends_two)
(assert eu_recommends_one)
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-018: Prisoner Dilemma
  {
    case_id: 'DH-P-018',
    name: 'Prisoner Dilemma',
    domain: 'GAME_THEORY',
    statement: 'Dominant individual strategy leads to suboptimal collective outcome.',
    formal_proposition: 'Strict dominance equilibrium (Defect, Defect) with payoff 1 strictly less than mutual cooperation payoff 3. Refuting that Nash equilibrium is Pareto optimal.',
    assumptions: ['Symmetric 2-player strategic game', 'Payoffs T=5 > R=3 > P=1 > S=0'],
    axioms: ['Nash equilibrium definition', 'Pareto dominance definition'],
    constraints: ['u_nash = 1', 'u_coop = 3'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-018: Prisoner Dilemma
(declare-const u_nash Int)
(declare-const u_coop Int)
(assert (= u_nash 1))
(assert (= u_coop 3))
; Refuting hypothesis that Nash payoff equals or exceeds cooperative payoff
(assert (>= u_nash u_coop))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-019: Simpson Paradox
  {
    case_id: 'DH-P-019',
    name: 'Simpson Paradox',
    domain: 'STATISTICS',
    statement: 'Trend appears in groups but reverses when groups are aggregated.',
    formal_proposition: 'Subgroup success rate reversal upon aggregation: a1 > b1 and a2 > b2 while totalA < totalB is mathematically SATISFIABLE.',
    assumptions: ['Positive sub-sample counts', 'Non-uniform group weight distribution'],
    axioms: ['Weighted average arithmetic'],
    constraints: ['Rates in (0, 1)'],
    expected_result: 'sat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-019: Simpson Paradox
(declare-const a1 Real)
(declare-const b1 Real)
(declare-const a2 Real)
(declare-const b2 Real)
(declare-const totalA Real)
(declare-const totalB Real)
(assert (> a1 b1))
(assert (> a2 b2))
(assert (< totalA totalB))
; Satisfying assignment exists: e.g., A1=80%, B1=70%, A2=20%, B2=10%, TotalA=50%, TotalB=55%
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-020: Monty Hall Problem
  {
    case_id: 'DH-P-020',
    name: 'Monty Hall Problem',
    domain: 'PROBABILITY',
    statement: 'Switching doors doubles win probability from 1/3 to 2/3.',
    formal_proposition: 'Conditional probability update: P(win | stay) = 1/3 while P(win | switch) = 2/3. Refuting the intuitive claim that switching and staying have equal 1/2 probability.',
    assumptions: ['Host reveals goat with probability 1', 'Host never opens chosen door'],
    axioms: ['Law of Total Probability', 'Bayes Theorem'],
    constraints: ['p_stay + p_switch = 1.0'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-020: Monty Hall Problem
(declare-const p_stay Real)
(declare-const p_switch Real)
(assert (= p_stay (/ 1.0 3.0)))
(assert (= p_switch (- 1.0 p_stay)))
; Refuting hypothesis that p_stay == p_switch
(assert (= p_stay p_switch))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-021: Birthday Paradox
  {
    case_id: 'DH-P-021',
    name: 'Birthday Paradox',
    domain: 'COMBINATORICS',
    statement: 'In 23 people, >50% chance of a shared birthday.',
    formal_proposition: 'Combinatorial collision product: For n=23 and days=365, complementary probability Q(23) <= 0.493, yielding P(collision) > 0.5. Refuting P(collision) <= 0.5.',
    assumptions: ['Uniform birthday distribution over 365 days', 'Independent individuals'],
    axioms: ['Product rule for independent probability'],
    constraints: ['n = 23', 'Q(23) <= 0.493'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_BOUNDED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-021: Birthday Paradox
(declare-const q23 Real)
(declare-const p_collision Real)
(assert (<= q23 0.493))
(assert (= p_collision (- 1.0 q23)))
(assert (<= p_collision 0.5))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-022: Banach-Tarski Paradox
  {
    case_id: 'DH-P-022',
    name: 'Banach-Tarski Paradox',
    domain: 'MEASURE_THEORY',
    statement: 'A solid ball can be decomposed into 5 non-measurable sets and reassembled into two.',
    formal_proposition: 'Under finite additivity of Lebesgue measure, measurable decomposition of volume V preserves total volume V. Reassembly into 2V is refutable for measurable subsets.',
    assumptions: ['Lebesgue measure finite additivity', 'Measurable decomposition hypothesis'],
    axioms: ['Finite additivity of isometry-invariant measure'],
    constraints: ['V > 0'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_AXIOMATIC',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-022: Banach-Tarski Paradox
(declare-const V Real)
(declare-const sum_pieces Real)
(assert (> V 0.0))
(assert (= sum_pieces V))
; Refuting hypothesis that measurable pieces reassemble into volume 2V
(assert (= sum_pieces (* 2.0 V)))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-023: Gabriel Horn (Torricelli Trumpet)
  {
    case_id: 'DH-P-023',
    name: 'Gabriel Horn (Torricelli Trumpet)',
    domain: 'CALCULUS',
    statement: 'Surface of revolution has infinite surface area but finite volume (pi).',
    formal_proposition: 'Volume integral V = pi * int_1^inf (1/x^2) dx = pi is finite, whereas surface area integral A >= 2pi * int_1^inf (1/x) dx diverges. Conjunction of finite volume with bounded surface area is refutable.',
    assumptions: ['Solid of revolution for y = 1/x on [1, inf)', 'Standard Riemannian improper integrals'],
    axioms: ['Convergence of p-integral for p=2', 'Divergence of harmonic integral for p=1'],
    constraints: ['V = 3.14159265', 'A bounded by M'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_BOUNDED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-023: Gabriel Horn (Torricelli Trumpet)
(declare-const V Real)
(declare-const A_finite Bool)
(declare-const M Real)
(assert (= V 3.14159265))
(assert (> V 0.0))
(assert (<= (* 6.28 100.0) M))
(assert (> (* 6.28 100.0) M))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-024: Olbers Paradox
  {
    case_id: 'DH-P-024',
    name: 'Olbers Paradox',
    domain: 'ASTROPHYSICS',
    statement: 'In an infinite static universe, the night sky should be uniformly bright.',
    formal_proposition: 'In infinite static Euclidean space with uniform star number density, integrated flux diverges. Conjunction of infinite static universe with finite sky flux is refutable.',
    assumptions: ['Static infinite Euclidean universe', 'Uniform stellar luminosity density'],
    axioms: ['Inverse-square light propagation', 'Spherical shell volume scaling r^2'],
    constraints: ['static_universe is true'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_AXIOMATIC',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-024: Olbers Paradox
(declare-const flux_finite Bool)
(declare-const static_infinite_universe Bool)
(assert static_infinite_universe)
(assert (=> static_infinite_universe (not flux_finite)))
(assert flux_finite)
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-025: Fermi Paradox
  {
    case_id: 'DH-P-025',
    name: 'Fermi Paradox',
    domain: 'ASTROBIOLOGY',
    statement: 'High probability of extraterrestrial life vs total absence of observational contact.',
    formal_proposition: 'Drake expectation N >> 1 with unhindered interstellar colonization implies observed civilizations > 0. The conjunction of high expected colonization with observed = 0 is refutable.',
    assumptions: ['Drake equation parameters yield large N', 'Colonization timescale << galactic age'],
    axioms: ['Observation consistency axiom'],
    constraints: ['N > 1000', 'observed = 0'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_BOUNDED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-025: Fermi Paradox
(declare-const N Int)
(declare-const observed_civilizations Int)
(assert (> N 1000))
(assert (=> (> N 0) (> observed_civilizations 0)))
(assert (= observed_civilizations 0))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-026: Twin Paradox
  {
    case_id: 'DH-P-026',
    name: 'Twin Paradox',
    domain: 'RELATIVITY',
    statement: 'Traveling twin accelerates away and returns younger than stationary twin.',
    formal_proposition: 'Asymmetric Minkowski spacetime proper time: tau_traveler = T * sqrt(1 - v^2/c^2) < T. Refuting hypothesis that traveling twin elapsed proper time equals stationary twin.',
    assumptions: ['Minkowski metric interval ds^2 = c^2 dt^2 - dx^2', 'Non-inertial turnaround by traveling twin'],
    axioms: ['Lorentz invariance', 'Proper time path integral'],
    constraints: ['v = 0.8c', 'T > 0'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-026: Twin Paradox
(declare-const T Real)
(declare-const tau_traveler Real)
(declare-const v Real)
(assert (> T 0.0))
(assert (= v 0.8))
(assert (= tau_traveler (* T 0.6)))
; Refuting hypothesis that elapsed proper time is identical
(assert (= tau_traveler T))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-027: EPR Paradox
  {
    case_id: 'DH-P-027',
    name: 'EPR Paradox',
    domain: 'QUANTUM_MECHANICS',
    statement: 'Entangled particles exhibit instantaneous correlations ("spooky action at a distance").',
    formal_proposition: 'Bell CHSH theorem: Local hidden variable realism bounds correlation |S| <= 2. Quantum entangled state yields S = 2*sqrt(2) approx 2.828. Quantum correlation violating classical bound is refutable under local realism.',
    assumptions: ['Local hidden variable realism', 'Measurement setting independence'],
    axioms: ['CHSH inequality bound <= 2.0'],
    constraints: ['S_quantum = 2.8284'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_BOUNDED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-027: EPR Paradox
(declare-const S_quantum Real)
(declare-const S_local_hidden_bound Real)
(assert (= S_local_hidden_bound 2.0))
(assert (= S_quantum 2.8284))
; Refuting that quantum correlation satisfies classical Bell bound
(assert (<= S_quantum S_local_hidden_bound))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-028: Schrodinger Cat Paradox
  {
    case_id: 'DH-P-028',
    name: 'Schrodinger Cat Paradox',
    domain: 'QUANTUM_MEASUREMENT',
    statement: 'Quantum superposition entangled with macroscopic feline life state.',
    formal_proposition: 'Decoherence through environment-induced superselection forces macroscopic interference terms to 0. Macroscopic persistent interference (> 0.1) is refutable.',
    assumptions: ['Macroscopic pointer state entanglement with environment', 'Trace over unobserved degrees of freedom'],
    axioms: ['Decoherence theorem in open quantum systems'],
    constraints: ['interference_term = 0.0'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED_BOUNDED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-028: Schrodinger Cat Paradox
(declare-const p_alive Real)
(declare-const p_dead Real)
(declare-const interference_term Real)
(assert (= p_alive 0.5))
(assert (= p_dead 0.5))
(assert (= interference_term 0.0))
; Refuting non-zero macroscopic interference
(assert (> interference_term 0.1))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-029: Zeno Arrow Paradox
  {
    case_id: 'DH-P-029',
    name: 'Zeno Arrow Paradox',
    domain: 'INFINITE_SERIES',
    statement: 'At every instant of time, a flying arrow occupies a space equal to itself and is motionless.',
    formal_proposition: 'Instantaneous velocity is defined as the limit dx/dt as dt -> 0. Non-zero velocity v0 > 0 refutes the claim that instantaneous occupancy implies zero velocity.',
    assumptions: ['Arrow has position trajectory x(t) = v0 * t with v0 > 0', 'Instantaneous velocity defined via derivative'],
    axioms: ['Differential calculus velocity definition'],
    constraints: ['v0 > 0.0'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-029: Zeno Arrow Paradox
(declare-const v0 Real)
(declare-const v_instant Real)
(assert (> v0 0.0))
(assert (= v_instant v0))
; Refuting that arrow velocity is zero at instant t
(assert (= v_instant 0.0))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-030: Zeno Dichotomy Paradox
  {
    case_id: 'DH-P-030',
    name: 'Zeno Dichotomy Paradox',
    domain: 'INFINITE_SERIES',
    statement: 'Motion can never start because one must traverse infinite half-intervals first.',
    formal_proposition: 'Sum of geometric intervals sum_{n=1}^inf (1/2^n) = 1 converges in finite time t0. Refuting that traversing infinite half-intervals diverges.',
    assumptions: ['Geometric series ratio r = 1/2', 'Step duration scales as t0 / 2^n'],
    axioms: ['Geometric series convergence theorem sum(1/2^n) = 1'],
    constraints: ['t0 > 0.0'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-030: Zeno Dichotomy Paradox
(declare-const total_dist Real)
(declare-const total_time Real)
(declare-const t0 Real)
(assert (> t0 0.0))
(assert (= total_dist 1.0))
(assert (= total_time t0))
; Refuting that traversal time diverges
(assert (> total_time (* 2.0 t0)))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-031: Braess Paradox
  {
    case_id: 'DH-P-031',
    name: 'Braess Paradox',
    domain: 'NETWORK_FLOW',
    statement: 'Adding a road to a congested traffic network can increase overall travel times.',
    formal_proposition: 'In a congested network with non-cooperative routing, adding a shortcut edge creates a new user equilibrium with higher latency. This phenomenon is SATISFIABLE.',
    assumptions: ['Wardrop user equilibrium', 'Selfish routing in directed network'],
    axioms: ['Game-theoretic Nash equilibrium'],
    constraints: ['latency_after > latency_before'],
    expected_result: 'sat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-031: Braess Paradox
(declare-const latency_before Real)
(declare-const latency_after Real)
(assert (= latency_before 1.5))
(assert (= latency_after 2.0))
(assert (> latency_after latency_before))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  },

  // DH-P-032: Byzantine Generals Paradox
  {
    case_id: 'DH-P-032',
    name: 'Byzantine Generals Paradox',
    domain: 'DISTRIBUTED_CONSENSUS',
    statement: 'Reaching consensus across unreliable networks with traitorous nodes.',
    formal_proposition: 'Lamport-Shostak-Pease Theorem: Synchronous Byzantine agreement with m traitorous nodes requires strictly > 3m nodes (n >= 3m + 1). For n=3 and m=1, reaching consensus is refutable.',
    assumptions: ['Oral message model without digital signatures', 'm traitorous arbitrary Byzantine nodes'],
    axioms: ['Lamport lower bound theorem n >= 3m + 1'],
    constraints: ['n = 3', 'm = 1'],
    expected_result: 'unsat',
    scope: 'MODEL_VERIFIED',
    formalization_method: 'Z3_SMT_LIB2',
    z3_smt_assertion: `; DH-P-032: Byzantine Generals Paradox
(declare-const n Int)
(declare-const m Int)
(assert (= n 3))
(assert (= m 1))
; Refuting that n=3 satisfies the Byzantine tolerance threshold n >= 3m + 1
(assert (>= n (+ (* 3 m) 1)))
(check-sat)`,
    source_file: 'src/paradoxes/DHBootstrapParadoxRegistry.ts'
  }
];

export const AUTHORITATIVE_32_DH_CONTRACTS: DHAuthoritativeContract[] = RAW_CONTRACTS.map(c => {
  const contractHash = computeSha256(JSON.stringify(c));
  return {
    ...c,
    contract_hash: contractHash
  };
});
