import { call } from './upstream.ts';

const ollama = { name: 'Ollama', base: process.env.OLLAMA_URL };

// keep_alive 0 unloads now; -1 keeps the model loaded until told otherwise.
export const setQwen = (loaded: boolean) =>
  call(ollama, '/api/generate', {
    method: 'POST',
    body: { model: 'qwen3.5:9b', keep_alive: loaded ? -1 : 0 },
    timeoutMs: 120_000,
  });
