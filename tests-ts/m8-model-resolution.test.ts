import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxProviderHandle,
} from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";

describe("M8: 模型解析 —— 会话不再固持模型，未显式指定时跟随全局设置", () => {
  let db: AppDatabase;
  let faux: FauxProviderHandle;
  let runtime: MemoriaAgentRuntime;
  /** 每次真实发请求时实际使用的模型 id。 */
  let requested: string[];

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    faux = fauxProvider({
      provider: "faux",
      models: [
        { id: "faux-old", name: "Faux Old", reasoning: true },
        { id: "faux-new", name: "Faux New", reasoning: true },
      ],
    });
    runtime = await MemoriaAgentRuntime.create({ db, customProviders: [faux.provider] });
    db.setSetting("default_provider", "faux");
    db.setSetting("llm_model", "faux-old");

    requested = [];
    faux.setResponses([
      (_context, _options, _state, model) => {
        requested.push(model.id);
        return fauxAssistantMessage("ok");
      },
      (_context, _options, _state, model) => {
        requested.push(model.id);
        return fauxAssistantMessage("ok");
      },
    ]);
  });

  afterEach(async () => {
    await runtime?.close();
  });

  it("改了系统设置里的默认模型后，重发老会话走的是新模型", async () => {
    const first = await runtime.submitMessage({
      content: "查看nas状态",
      modelProvider: "faux",
      modelId: "faux-old",
    });
    await first.submission.wait(BACKGROUND_CONTEXT);

    // 用户在系统设置里把「默认对话模型」改成 faux-new。
    db.setSetting("llm_model", "faux-new");

    // 回到 agent 页面重发这条老对话：不再显式带模型参数。
    const second = await runtime.submitMessage({
      conversationId: first.summary.id,
      content: "查看nas状态",
    });
    await second.submission.wait(BACKGROUND_CONTEXT);

    expect(requested).toEqual(["faux-old", "faux-new"]);
    expect(db.getConversation(first.summary.id)!.modelId).toBe("faux-new");
  });

  it("显式指定的模型仍然优先于全局默认", async () => {
    const { summary, submission } = await runtime.submitMessage({
      content: "用指定模型回答",
      modelProvider: "faux",
      modelId: "faux-old",
    });
    await submission.wait(BACKGROUND_CONTEXT);

    expect(requested).toEqual(["faux-old"]);
    expect(db.getConversation(summary.id)!.modelId).toBe("faux-old");
  });
});
