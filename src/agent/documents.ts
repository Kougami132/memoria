import { defineDoc } from "@earendil-works/pi-durable";
import type { ConversationScope } from "../../shared/types.ts";

export type MemoriaScopeDocState = {
  kbIds: string[];
  hostIds: string[];
  hostSecurityModes: Record<string, "read_only" | "ask_confirmation" | "unrestricted">;
  webSearch: boolean;
  subagentEnabled: boolean;
};

export const MemoriaScopeDoc = defineDoc({
  kind: "memoria.scope",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: (): MemoriaScopeDocState => ({
    kbIds: [],
    hostIds: [],
    hostSecurityModes: {},
    webSearch: false,
    subagentEnabled: true,
  }),
});

export type { ConversationScope };
