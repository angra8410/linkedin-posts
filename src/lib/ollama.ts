export interface OllamaGenerationOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

/**
 * Standard complete generation (non-streamed)
 */
export async function generate(
  prompt: string,
  system: string,
  model: string,
  url?: string,
  options?: OllamaGenerationOptions
): Promise<string> {
  const response = await fetch('/api/ollama/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      system,
      options,
      stream: false
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama generation failed: ${errText}`);
  }

  const data = await response.json();
  return data.response || '';
}

/**
 * Streamed generation
 */
export async function generateStream(
  prompt: string,
  system: string,
  model: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  url?: string,
  options?: OllamaGenerationOptions
): Promise<void> {
  const response = await fetch('/api/ollama/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      system,
      options,
      stream: true
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama stream failed: ${errText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('ReadableStream not supported by browser.');
  }

  try {
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep the last partial line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            onChunk(parsed.response);
          }
          if (parsed.done) {
            onDone();
          }
        } catch {
          // Ignore partial or malformed lines
        }
      }
    }
    
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        if (parsed.response) {
          onChunk(parsed.response);
        }
      } catch {
        // ignore
      }
    }
  } finally {
    onDone();
  }
}
