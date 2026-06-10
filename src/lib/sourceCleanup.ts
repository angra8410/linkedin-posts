/**
 * Cleans up output text from the Ollama model to remove typical markdown commentary
 */
export function cleanupSourceAdaptation(source: string, generatedText: string): string {
  let cleaned = generatedText.trim();
  
  // Remove markdown codeblock wrapper if model wrapped the output
  cleaned = cleaned.replace(/^```[a-zA-Z]*\n/i, '');
  cleaned = cleaned.replace(/\n```$/, '');
  
  // Remove intros like "Here is the rewritten post:" or "Here is the LinkedIn post:"
  cleaned = cleaned.replace(/^(here is|here's|this is) (your|the) (rewritten|adapted|linkedin|generated)?\s*(post|draft|content|commentary)[:\-]?\s*/i, '');
  
  return cleaned.trim();
}

export function cleanupTopicExpansion(topic: string, generatedText: string): string {
  return cleanupSourceAdaptation(topic, generatedText);
}
