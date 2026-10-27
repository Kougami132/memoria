import { lazyApi } from "@earendil-works/pi-ai/api/lazy";
import {
  createModels,
  createProvider,
  getSupportedThinkingLevels,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai/models";
import type { Model, ProviderStreams } from "@earendil-works/pi-ai";
import type {
  AvailableModelOption,
  ModelProviderConfig,
  ProviderProtocol,
  ThinkingLevel,
} from "../../shared/types.ts";
import type { AppDatabase } from "../db/database.ts";

const protocolPreloads = new Map<ProviderProtocol, Promise<ProviderStreams>>();

export function preloadProtocol(protocol: ProviderProtocol): Promise<ProviderStreams> {
  const cached = protocolPreloads.get(protocol);
  if (cached) return cached;
  let promise: Promise<ProviderStreams>;
  switch (protocol) {
    case "openai-responses":
      promise = import("@earendil-works/pi-ai/api/openai-responses");
      break;
    case "anthropic-messages":
      promise = import("@earendil-works/pi-ai/api/anthropic-messages");
      break;
    case "google-generative-ai":
      promise = import("@earendil-works/pi-ai/api/google-generative-ai");
      break;
    case "openai-completions":
    default:
      promise = import("@earendil-works/pi-ai/api/openai-completions");
      break;
  }
  protocolPreloads.set(protocol, promise);
  return promise;
}

function buildApiForProtocol(protocol: ProviderProtocol) {
  return lazyApi(() => preloadProtocol(protocol));
}

export class ModelsRegistryManager {
  readonly models: MutableModels;
  private readonly db: AppDatabase;
  private readonly customProviders = new Map<string, Provider>();
  private autoWarmup = false;

  constructor(db: AppDatabase, initialCustomProviders?: Provider[]) {
    this.db = db;
    this.models = createModels();
    if (initialCustomProviders) {
      for (const p of initialCustomProviders) {
        this.customProviders.set(p.id, p);
      }
    }
    this.reloadFromDb();
  }

  registerCustomProvider(provider: Provider): void {
    this.customProviders.set(provider.id, provider);
    this.models.setProvider(provider);
  }

  reloadFromDb(): void {
    this.db.syncDefaultProviderFromSettings();
    const dbProviders = this.db.listProviders(true);

    this.models.clearProviders();

    for (const [, custom] of this.customProviders) {
      this.models.setProvider(custom);
    }

    for (const p of dbProviders) {
      if (!p.enabled) continue;
      const modelDefs: Model<any>[] = p.models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        api: p.protocol,
        baseUrl: p.baseUrl,
        provider: p.id,
        reasoning: m.reasoning ?? true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.contextWindow ?? 128000,
        maxTokens: m.maxTokens ?? 8192,
        type: "chat",
      }));

      const providerInstance = createProvider({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        auth: {
          apiKey: {
            name: `${p.name} API Key`,
            login: async () => ({ type: "api_key", key: p.apiKey || "sk-local" }),
            resolve: async () => ({
              auth: { apiKey: p.apiKey || "sk-local" },
              source: "memoria-db",
            }),
          },
        },
        models: modelDefs,
        api: buildApiForProtocol(p.protocol),
      });

      this.models.setProvider(providerInstance);
      if (this.autoWarmup) {
        void preloadProtocol(p.protocol || "openai-completions").catch(() => {});
      }
    }
  }

  ensureModelRegistered(providerId: string, modelId: string): void {
    if (this.models.getModel(providerId, modelId)) return;
    const providers = this.db.listProviders(true);
    const target = providers.find((p) => p.id === providerId);
    if (!target) return;
    target.models.push({
      id: modelId,
      name: modelId,
      reasoning: true,
      contextWindow: 128000,
      maxTokens: 8192,
    });
    this.db.upsertProvider(target);
    this.reloadFromDb();
  }

  listAvailableModelOptions(): AvailableModelOption[] {
    this.reloadFromDb();
    const out: AvailableModelOption[] = [];
    for (const provider of this.models.getProviders()) {
      for (const m of provider.getModels()) {
        const supported = getSupportedThinkingLevels(m) as ThinkingLevel[];
        out.push({
          provider: provider.id,
          providerName: provider.name,
          modelId: m.id,
          name: m.name || m.id,
          reasoning: Boolean(m.reasoning),
          supportedThinkingLevels: supported.length > 0 ? supported : ["off", "low", "medium", "high"],
        });
      }
    }
    return out;
  }

  async warmup(): Promise<void> {
    this.autoWarmup = true;
    const dbProviders = this.db.listProviders(true);
    const protocols = new Set<ProviderProtocol>();
    for (const p of dbProviders) {
      if (p.enabled) {
        protocols.add(p.protocol || "openai-completions");
      }
    }
    await Promise.all([...protocols].map((protocol) => preloadProtocol(protocol)));
  }
}
