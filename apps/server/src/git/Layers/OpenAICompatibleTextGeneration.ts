import OpenAI from "openai";
import { Effect, Layer, Option, Schema } from "effect";

import {
  TextGenerationError,
  type OpenAICompatibleTextGenerationModelSelection,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { ServerSettingsService } from "../../serverSettings.ts";
import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "../Prompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "../Utils.ts";

const OPENAI_COMPATIBLE_TIMEOUT_MS = 180_000;

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message.trim();
  }
  return fallback;
}

function normalizeOpenAICompatibleError(
  operation: string,
  cause: unknown,
  fallback: string,
): TextGenerationError {
  return new TextGenerationError({
    operation,
    detail: toErrorMessage(cause, fallback),
    cause,
  });
}

function stripMarkdownCodeFences(value: string): string {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!fencedMatch) {
    return trimmed;
  }
  return fencedMatch[1]!.trim();
}

function extractChatCompletionText(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
): string | null {
  const content = message?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .flatMap((part) =>
      typeof part === "object" && part !== null && "type" in part && part.type === "text"
        ? [part.text]
        : [],
    )
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}

const makeOpenAICompatibleTextGeneration = Effect.gen(function* () {
  const serverSettingsService = yield* Effect.service(ServerSettingsService);

  const resolveEndpoint = Effect.fn("resolveEndpoint")(function* (
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle",
    modelSelection: OpenAICompatibleTextGenerationModelSelection,
  ) {
    const settings = yield* serverSettingsService.getSettings.pipe(
      Effect.mapError((cause) =>
        normalizeOpenAICompatibleError(
          operation,
          cause,
          "Failed to load OpenAI-compatible endpoint settings.",
        ),
      ),
    );
    const endpoint = settings.providers.openaiCompatible.endpoints.find(
      (candidate) => candidate.id === modelSelection.endpointId,
    );

    if (!endpoint) {
      return yield* new TextGenerationError({
        operation,
        detail: `Unknown OpenAI-compatible endpoint '${modelSelection.endpointId}'.`,
      });
    }

    if (!endpoint.enabled) {
      return yield* new TextGenerationError({
        operation,
        detail: `OpenAI-compatible endpoint '${endpoint.label}' is disabled.`,
      });
    }

    return endpoint;
  });

  const runOpenAICompatibleJson = Effect.fn("runOpenAICompatibleJson")(function* <
    S extends Schema.Top,
  >({
    operation,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    prompt: string;
    outputSchemaJson: S;
    modelSelection: OpenAICompatibleTextGenerationModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const endpoint = yield* resolveEndpoint(operation, modelSelection);
    const apiKey =
      endpoint.apiKey.trim() ||
      (endpoint.apiKeyEnvVar.trim().length > 0
        ? (process.env[endpoint.apiKeyEnvVar.trim()] ?? "").trim()
        : "");

    if (apiKey.length === 0) {
      return yield* new TextGenerationError({
        operation,
        detail:
          endpoint.apiKeyEnvVar.trim().length > 0
            ? `Missing API key for '${endpoint.label}'. Set ${endpoint.apiKeyEnvVar.trim()} or save an API key in settings.`
            : `Missing API key for '${endpoint.label}'.`,
      });
    }

    const client = new OpenAI({
      apiKey,
      baseURL: endpoint.baseUrl,
    });
    const schemaJson = JSON.stringify(toJsonSchemaObject(outputSchemaJson));

    const completion = yield* Effect.tryPromise({
      try: () =>
        client.chat.completions.create({
          model: modelSelection.model,
          messages: [
            {
              role: "system",
              content: [
                "You generate structured JSON for an internal coding tool.",
                "Return only one valid JSON object with no markdown fences and no extra explanation.",
                `The JSON must match this schema exactly:\n${schemaJson}`,
              ].join("\n\n"),
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: {
            type: "json_object",
          },
        }),
      catch: (cause) =>
        normalizeOpenAICompatibleError(
          operation,
          cause,
          "OpenAI-compatible endpoint request failed.",
        ),
    }).pipe(
      Effect.timeoutOption(OPENAI_COMPATIBLE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "OpenAI-compatible endpoint request timed out.",
              }),
            ),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

    const content = extractChatCompletionText(completion.choices[0]?.message);
    if (!content) {
      return yield* new TextGenerationError({
        operation,
        detail: "OpenAI-compatible endpoint returned no text response.",
      });
    }

    const normalizedContent = stripMarkdownCodeFences(content);
    return yield* Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))(
      normalizedContent,
    ).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation,
            detail:
              "OpenAI-compatible endpoint returned invalid structured JSON output. Check endpoint compatibility.",
            cause,
          }),
        ),
      ),
    );
  });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "OpenAICompatibleTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });

    if (input.modelSelection.provider !== "openaiCompatible") {
      return yield* new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runOpenAICompatibleJson({
      operation: "generateCommitMessage",
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "OpenAICompatibleTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    if (input.modelSelection.provider !== "openaiCompatible") {
      return yield* new TextGenerationError({
        operation: "generatePrContent",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runOpenAICompatibleJson({
      operation: "generatePrContent",
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "OpenAICompatibleTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    if (input.modelSelection.provider !== "openaiCompatible") {
      return yield* new TextGenerationError({
        operation: "generateBranchName",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runOpenAICompatibleJson({
      operation: "generateBranchName",
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "OpenAICompatibleTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    if (input.modelSelection.provider !== "openaiCompatible") {
      return yield* new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Invalid model selection.",
      });
    }

    const generated = yield* runOpenAICompatibleJson({
      operation: "generateThreadTitle",
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});

export const OpenAICompatibleTextGenerationLive = Layer.effect(
  TextGeneration,
  makeOpenAICompatibleTextGeneration,
);
