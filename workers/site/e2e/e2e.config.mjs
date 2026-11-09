import { web } from '@e2e-dev/web';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const llm = createOpenAICompatible({
  name: 'litellm',
  baseURL: process.env.E2E_LLM_BASE_URL,
  apiKey: process.env.E2E_LLM_API_KEY ?? '',
});

export default {
  tests: ['*.e2e.ts'],
  agents: { default: { model: llm.chatModel(process.env.E2E_LLM_MODEL), system: 'You are a meticulous QA agent.' } },
  targets: [{ engine: web({
        // Cloudflare serves a managed challenge to a bare headless Chromium;
        // the owner's real browser is Firefox, so present one.
        headers: {
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0',
          'accept-language': 'en-US,en;q=0.9',
        },
      }), app: { url: process.env.APP_URL ?? 'https://mysweetpea.cc' } }],
};
