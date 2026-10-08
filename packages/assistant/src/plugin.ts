import type { Plugin } from "@juunibi/core";
import { Assistant, type AssistantOptions } from "./assistant";

/**
 * Kernel plugin. Other modules declare `deps: ["assistant"]` and call
 * `ctx.service<ToolRegistry>("assistant:tools").register(...)` to give the assistant tools.
 */
export function assistantPlugin(
  opts: Omit<AssistantOptions, "describeModules">,
  describe: () => unknown,
  onReady?: (a: Assistant) => void,
): Plugin {
  return {
    name: "assistant",
    start(ctx) {
      const assistant = new Assistant({ ...opts, describeModules: describe, log: ctx.log });
      ctx.provide("assistant", assistant);
      ctx.provide("assistant:tools", assistant.tools);
      onReady?.(assistant);
    },
  };
}
