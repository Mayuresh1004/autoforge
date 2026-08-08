/**
 * OpenAI-compatible chat-completions substrate shared by the OpenRouter,
 * Groq and Mistral adapters.
 *
 * All three expose the same wire shape (`POST {base}/chat/completions`,
 * `Authorization: Bearer <key>`, `{model,messages,temperature,max_tokens,
 * response_format}`). Keeping the shared HTTP/retry/recording logic in ONE
 * place avoids triplicating it — the public surface remains the domain
 * `LLMProvider` interface; nothing provider-specific escapes this layer.
 *
 * Wire parsing + HTTP error classification live in openai-compatible-parse.ts.
 *
 * Retries: bounded by `maxRetries` (LLM_MAX_RETRIES), exponential backoff,
 * only for transient failures (5xx / 429 / network / timeout). Fallback
 * escalation across providers is handled by the coordinator, never here.
 */

import {
  LLMError,
  LLMTimeoutError,
  LLMUnavailableError,
} from '../../domain/errors/llm.errors';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ModelInfo,
  ProviderHealth,
} from '../../domain/ports/llm-provider';
import type { LLMProviderId } from '../../domain/ports/llm-provider';
import type { LLMUsageRecorder } from '../../application/services/llm-usage-recorder';
import { logger } from '../../../config/logger';
import { classifyHttpError, parseChatResponse, type ParsedChatResponse } from './openai-compatible-parse';

export interface OpenAICompatibleClientOptions {
  readonly provider: LLMProviderId;
  readonly baseUrl: string;
  readonly apiKey?: string;
  /** Configured model for this provider ('openrouter/free' for OpenRouter). */
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly usageRecorder?: LLMUsageRecorder;
}

interface ChatCompletionBody {
  readonly model: string;
  readonly messages: readonly LLMMessage[];
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly response_format?: { readonly type: 'json_object' };
}

const RETRY_BACKOFF_BASE_MS = 350;
const MAX_BACKOFF_MS = 4_000;

/** Estimate tokens when the provider omits a count (4 chars ≈ 1 token).
 *  The estimate is never used to invent MONEY — cost stays 0 unless the
 *  provider reports it. */
function estimateTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 4));
}

export class OpenAICompatibleClient implements LLMProvider {
  private readonly o: OpenAICompatibleClientOptions;

  constructor(options: OpenAICompatibleClientOptions) {
    this.o = options;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const model = request.model ?? this.o.model;
    try {
      const response = await this.withRetries(request, model, 0);
      this.o.usageRecorder?.record({
        provider: this.o.provider,
        model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        estimatedCost: response.usage.estimatedCost,
        durationMs: Date.now() - started,
        status: 'ok',
        attemptedAt: started,
      });
      logger.debug(
        {
          llm: {
            provider: this.o.provider,
            model,
            durationMs: Date.now() - started,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            estimatedCost: response.usage.estimatedCost,
          },
        },
        'llm_generate_ok',
      );
      return response;
    } catch (error) {
      const code = error instanceof LLMError ? error.code : 'UNEXPECTED';
      this.o.usageRecorder?.record({
        provider: this.o.provider,
        model,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        durationMs: Date.now() - started,
        status: 'error',
        errorCode: code,
        attemptedAt: Date.now(),
      });
      throw error;
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const response = await fetch(`${this.o.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.o.apiKey ?? ''}` },
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        return { ok: false, latencyMs, detail: `models endpoint returned ${response.status}` };
      }
      return { ok: true, latencyMs };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  getModelInfo(): ModelInfo {
    return {
      provider: this.o.provider,
      model: this.o.model,
      freeAlias: this.o.model === 'openrouter/free',
      supportsStructuredJson: true,
    };
  }

  // --- internals ---------------------------------------------------------

  private async withRetries(request: LLMRequest, model: string, attempt: number): Promise<LLMResponse> {
    try {
      return await this.sendOnce(request, model);
    } catch (error) {
      if (attempt >= this.o.maxRetries || !(error instanceof LLMError) || !this.retryable(error)) {
        throw error;
      }
      const waitMs = Math.min(RETRY_BACKOFF_BASE_MS * (attempt + 1), MAX_BACKOFF_MS);
      logger.debug(
        { llm: { provider: this.o.provider, model, attempt: attempt + 1, waitMs, code: error.code } },
        'llm_retry',
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.withRetries(request, model, attempt + 1);
    }
  }

  private retryable(error: LLMError): boolean {
    return (
      error.code === 'RATE_LIMIT' ||
      error.code === 'UNAVAILABLE' ||
      error.code === 'TIMEOUT'
    );
  }

  private async sendOnce(request: LLMRequest, model: string): Promise<LLMResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.o.timeoutMs);
    try {
      const responseFormat =
        request.responseFormat === 'json_object' ? ({ type: 'json_object' } as const) : undefined;
      const body: ChatCompletionBody = {
        model,
        messages: request.messages,
        temperature: request.temperature ?? this.o.temperature,
        max_tokens: request.maxTokens ?? this.o.maxTokens,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      };

      let response: Response;
      try {
        response = await fetch(`${this.o.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.o.apiKey ?? ''}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new LLMTimeoutError(this.o.provider, this.o.timeoutMs, error);
        }
        // fetch-level network failure (DNS, refused, reset, …).
        throw new LLMUnavailableError(this.o.provider, 'network failure', error);
      }

      const bodyText = await response.text();
      if (!response.ok) {
        throw classifyHttpError(this.o.provider, response.status, bodyText, model);
      }
      return this.intoResponse(parseChatResponse(this.o.provider, bodyText), model, request);
    } finally {
      clearTimeout(timer);
    }
  }

  private intoResponse(
    parsed: ParsedChatResponse,
    model: string,
    request: LLMRequest,
  ): LLMResponse {
    const inputTokens =
      parsed.inputTokens ?? estimateTokens(JSON.stringify(request.messages).length);
    const outputTokens = parsed.outputTokens ?? estimateTokens(parsed.text.length);
    const estimatedCost = parsed.cost !== undefined && parsed.cost > 0 ? parsed.cost : 0;
    return {
      text: parsed.text,
      finishReason: parsed.finishReason,
      model,
      usage: { inputTokens, outputTokens, estimatedCost },
    };
  }
}