export function adaptiveLearningInteractionGuidance(): string {
  return [
    "Adaptive learning architecture:",
    "- Infer the dominant evidence-backed learning actions from the source, not from a broad subject label. Do not force every course into flashcards or a technical calculation trainer.",
    "- Quantitative or derivation-heavy material: use multi-step problems that require model/formula selection, setup, intermediate results, units where applicable, a final decision, and a plausibility check. Do not reveal downstream values before submission.",
    "- Conceptual or relational material: use compare/contrast, causal-chain reconstruction, concept linking, misconception diagnosis, and explanation prompts rather than isolated fact cards.",
    "- Rules, policy, business, and economics: use source-backed scenarios, classification, trade-off reasoning, consequence prediction, decision matrices, and calculations only where the source supports them.",
    "- Biomedical or medical material: use source-backed educational cases, anatomy/physiology causal chains, evidence selection, differential reasoning, uncertainty, red flags, and contraindication awareness. Never present personalized diagnosis or treatment advice and never invent clinical claims.",
    "- Procedures and workflows: use sequencing, checkpoints, branching decisions, error spotting, and recovery steps.",
    "- Terminology and pure recall: retrieval practice, cloze, or flashcards may be primary only when higher-order application is not supported. Otherwise use them as a small supporting layer.",
    "- Mixed courses: keep one coherent practice workspace while allowing chapter-specific task templates. Do not assemble a dashboard of unrelated mini-apps.",
    "- Workload must come from independently meaningful cases and deliberate review, not duplicated number variants or padded card counts. Label source-derived extensions and preserve their assumptions.",
    "- Feedback must explain the reasoning, misconception, or consequence. A bare correct/incorrect state is insufficient for substantive tasks.",
  ].join("\n");
}

export function adaptiveQualityCriteria(): string {
  return [
    "Adaptive quality criteria:",
    "- Reject a flashcard-dominated guide when the supplied source supports calculation, application, diagnosis, decision, causal, or procedural practice.",
    "- Reject inflated workload made from near-duplicate variants, repeated prompts, or tasks whose answers are already visible.",
    "- Require meaningful chapter coverage, answer persistence, actionable explanatory feedback, and a clear distinction between source-backed content and labelled derived practice.",
    "- For quantitative tasks, verify formula applicability, inputs, units, intermediate values, result, and interpretation against the source.",
    "- For business/economics cases, verify assumptions, direction of effects, trade-offs, and source fidelity rather than rewarding keyword matching alone.",
    "- For biomedical/medical cases, require an educational framing, source fidelity, uncertainty and safety boundaries; reject personalized diagnosis/treatment advice or invented contraindications and thresholds.",
  ].join("\n");
}
