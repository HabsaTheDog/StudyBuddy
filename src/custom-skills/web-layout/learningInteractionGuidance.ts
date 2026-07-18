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
    "- Mathematics must be typeset as mathematics. Use native semantic MathML (with accessible text where needed) or self-contained inline SVG for expressions; never expose raw TeX, Typst, or ASCII approximations such as sum_, integral_, dot, compose, sqrt(), x_0, or a/b when a real fraction is intended.",
    "- Present worked calculations as aligned, readable transformations with one justified operation per line. On narrow screens, contain wide mathematics in a labelled local scroller without causing document-level overflow.",
    "- Workload must come from independently meaningful cases and deliberate review, not duplicated number variants or padded card counts. Label source-derived extensions and preserve their assumptions.",
    "- Feedback must explain the reasoning, misconception, or consequence. A bare correct/incorrect state is insufficient for substantive tasks.",
    "- Never award exam credit for unrestricted free text through keywords, token overlap, prose length, regex fragments, or the presence of a copied equation. If semantic or algebraic equivalence cannot be validated deterministically, score structured relation/operator choices, ordered steps, classifications, or numeric fields instead; keep free text as unscored reflection or explicit self-review.",
  ].join("\n");
}

export function adaptiveQualityCriteria(): string {
  return [
    "Adaptive quality criteria:",
    "- Reject a flashcard-dominated guide when the supplied source supports calculation, application, diagnosis, decision, causal, or procedural practice.",
    "- Reject inflated workload made from near-duplicate variants, repeated prompts, or tasks whose answers are already visible.",
    "- Require meaningful chapter coverage, answer persistence, actionable explanatory feedback, and a clear distinction between source-backed content and labelled derived practice.",
    "- For quantitative tasks, verify formula applicability, inputs, units, intermediate values, result, and interpretation against the source.",
    "- Reject mathematics-heavy pages that expose raw TeX, Typst, or ASCII formula syntax instead of semantic typesetting, or that compress multi-step derivations into unreadable prose strings.",
    "- For business/economics cases, verify assumptions, direction of effects, trade-offs, and source fidelity rather than rewarding keyword matching alone.",
    "- For biomedical/medical cases, require an educational framing, source fidelity, uncertainty and safety boundaries; reject personalized diagnosis/treatment advice or invented contraindications and thresholds.",
    "- Reject unrestricted free-text auto-grading based on keywords, token coincidence, text length, or copied formula substrings. Scored reasoning must use deterministic task-specific structure; otherwise the prose must remain unscored and clearly labelled for self-review.",
  ].join("\n");
}
