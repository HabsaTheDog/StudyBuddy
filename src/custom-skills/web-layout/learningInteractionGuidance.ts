export function adaptiveLearningInteractionGuidance(): string {
  return [
    "Adaptive learning architecture:",
    "- Infer the learning actions, response forms, and progression from the exact original request, evaluated contract, learning objectives, assessment evidence, and source material. Never infer them from a course name or broad subject label.",
    "- Select only interactions that actually exercise an evidenced learning action and have an executable answer, rubric, or explicit self-review contract. The presence of a renderer component never justifies adding that component.",
    "- Preserve the response form demonstrated or required by the evidence. Do not convert explanations, performances, analyses, classifications, procedures, recall, or calculations into a different task type merely because it is easier to score.",
    "- When an item genuinely uses quantities, relations, ordered decisions, causal links, terminology, or extended reasoning, expose and assess the item-specific intermediate structure needed to make feedback useful. Do not impose any of those structures on unrelated items.",
    "- Keep one coherent practice workspace while allowing objective-specific task forms. Do not assemble a dashboard of unrelated mini-apps.",
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
    "- Reject a task mix or learning progression that is not traceable to the exact request, evaluated contract, objectives, and evidence. Do not demand any particular interaction family or type ratio by default.",
    "- Reject inflated workload made from near-duplicate variants, repeated prompts, or tasks whose answers are already visible.",
    "- Require meaningful chapter coverage, answer persistence, actionable explanatory feedback, and a clear distinction between source-backed content and labelled derived practice.",
    "- For each included task, verify the fields and reasoning that its own response contract requires. For a genuine quantitative item this can include applicability, inputs, units, intermediate values, result, and interpretation; it is not a requirement for non-quantitative items.",
    "- Reject mathematics-heavy pages that expose raw TeX, Typst, or ASCII formula syntax instead of semantic typesetting, or that compress multi-step derivations into unreadable prose strings.",
    "- Verify claims, assumptions, uncertainty, safety boundaries, and decision criteria whenever the supplied task and evidence make them applicable. Reject invented domain facts or personalized high-stakes advice rather than relying on a subject template.",
    "- Reject unrestricted free-text auto-grading based on keywords, token coincidence, text length, or copied formula substrings. Scored reasoning must use deterministic task-specific structure; otherwise the prose must remain unscored and clearly labelled for self-review.",
  ].join("\n");
}
