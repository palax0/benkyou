import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, EmbeddingModel } from 'ai';

export interface ProviderConfig {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}
export type LLMConfig = ProviderConfig;
export type EmbeddingConfig = ProviderConfig;

// `LanguageModel` in ai v6 is `GlobalProviderModelId | LanguageModelV3 | LanguageModelV2`.
// The string branch (GlobalProviderModelId) has no `.modelId`. All concrete provider
// factories actually return LanguageModelV3, which always carries `readonly modelId: string`.
// We intersect with `{ readonly modelId: string }` so callers can access it without
// importing from the transitive @ai-sdk/provider package.
export type ConcreteLanguageModel = LanguageModel & { readonly modelId: string };

export function resolveLLM(cfg: LLMConfig): ConcreteLanguageModel {
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.model) as ConcreteLanguageModel;
    case 'openai':
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model) as ConcreteLanguageModel;
    case 'openai-compatible':
    case 'ollama':
      if (!cfg.baseUrl) throw new Error(`${cfg.provider} requires baseUrl`);
      // Ollama / local OpenAI-compatible servers often need no key; '' satisfies the required field.
      return createOpenAICompatible({
        name: cfg.provider,
        baseURL: cfg.baseUrl,
        apiKey: cfg.apiKey ?? '',
      })(cfg.model) as ConcreteLanguageModel;
    case 'google':
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey })(cfg.model) as ConcreteLanguageModel;
    default:
      throw new Error(`Unknown LLM provider: ${cfg.provider}`);
  }
}

// Embedding method names differ across providers:
// - @ai-sdk/openai and @ai-sdk/google v3: `.embedding(modelId)` is the preferred non-deprecated form.
// - @ai-sdk/openai-compatible v2: `.embeddingModel(modelId)` is preferred; `.textEmbeddingModel` is deprecated.
// `EmbeddingModel` in ai v6 is `string | EmbeddingModelV3 | EmbeddingModelV2<string>` (not generic).
export function resolveEmbedding(cfg: EmbeddingConfig): EmbeddingModel {
  switch (cfg.provider) {
    case 'openai':
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }).embedding(cfg.model);
    case 'openai-compatible':
    case 'ollama':
      if (!cfg.baseUrl) throw new Error(`${cfg.provider} requires baseUrl`);
      return createOpenAICompatible({
        name: cfg.provider,
        baseURL: cfg.baseUrl,
        apiKey: cfg.apiKey ?? '',
      }).embeddingModel(cfg.model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey }).embedding(cfg.model);
    default:
      throw new Error(`Unknown embedding provider: ${cfg.provider}`);
  }
}
