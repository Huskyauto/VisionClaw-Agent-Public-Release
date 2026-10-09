// Keep the composer preference and its chat request semantics together.
export function chatRequestPreferenceFields(suggestionsEnabled: boolean): {
  preferDirectExecution: boolean;
  suggestQuestions?: true;
} {
  return suggestionsEnabled
    ? { preferDirectExecution: false, suggestQuestions: true }
    : { preferDirectExecution: true };
}