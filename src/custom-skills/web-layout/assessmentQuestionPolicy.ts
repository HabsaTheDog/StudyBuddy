export interface AssessmentQuestionText {
  prompt: string;
  sourceTask?: string;
}

/**
 * Assessment metadata informs the simulation shell, but asking learners to
 * recall that metadata is not meaningful exam practice.
 */
export function isAssessmentMetaQuestionText(
  question: AssessmentQuestionText,
): boolean {
  const value = `${question.prompt} ${question.sourceTask ?? ""}`;
  return /(?:wie lange|how long).{0,50}(?:prüfung|klausur|exam|test)/i.test(value) ||
    /(?:welche|what|which).{0,80}(?:hilfsmittel|aids).{0,80}(?:prüfung|klausur|exam|test|hinweis)/i.test(value) ||
    /(?:welche|what|which).{0,80}(?:themen|topics|aufbau|structure|aufgaben|tasks).{0,80}(?:prüfung|klausur|exam|musterprüfung)/i.test(value) ||
    /(?:prüfung|klausur|exam|sample exam|musterprüfung).{0,100}(?:themen|topics|aufbau|structure|umfasst|contains|besteht|consists|aufgabenüberschriften|task headings)/i.test(value) ||
    /(?:zuordnung|mapping).{0,100}(?:prüfungsaufgaben|exam tasks|technical focus)/i.test(value) ||
    /(?:welche|what|which).{0,80}(?:werkstoffangaben|material data|größen|quantities).{0,80}(?:aufgabe|task)\s*\d/i.test(value);
}
