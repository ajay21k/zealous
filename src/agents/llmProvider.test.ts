import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialBusinessState } from '../domain/seedData';
import { languageRegistry } from '../speech/languages';
import { runExternalAiTurn } from './llmProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('external AI language policy', () => {
  it('passes each registry locale as the current response language, regardless of earlier-turn language', async () => {
    const state = createInitialBusinessState();
    for (const language of languageRegistry.list()) {
      const response = {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                intent: 'QUERY',
                replyInUserLanguage: language.nativeName,
                detectedLanguageCode: 'en-IN',
              }),
            },
          }],
        }),
      };
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
      vi.stubGlobal('fetch', fetchMock);
      const result = await runExternalAiTurn(
        {
          mode: 'openai-compatible',
          apiKey: 'test-key',
          model: 'test-model',
          baseUrl: 'https://example.invalid/chat',
        },
        'Current turn',
        [{ id: 'old-turn', role: 'assistant', text: 'Previous English answer', timestamp: '' }],
        null,
        state,
        { code: language.code, autoDetect: false }
      );

      const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      const prompt = request.messages[0].content as string;
      expect(prompt).toContain(`Interaction language code: ${language.code}`);
      expect(prompt).toContain(`exclusively in ${language.name}`);
      expect(prompt).toContain("never copy a previous turn's language");
      expect(result.detectedLanguageCode).toBe(language.code);
    }
  });

  it('rejects generated replies written in a different Indic script', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'QUERY',
              replyInUserLanguage: 'आपके पास पर्याप्त स्टॉक है।',
            }),
          },
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runExternalAiTurn(
      {
        mode: 'openai-compatible',
        apiKey: 'test-key',
        model: 'test-model',
        baseUrl: 'https://example.invalid/chat',
      },
      'Current turn',
      [],
      null,
      createInitialBusinessState(),
      { code: 'ta-IN', autoDetect: false }
    )).rejects.toThrow('did not follow the selected Tamil');
  });
});
