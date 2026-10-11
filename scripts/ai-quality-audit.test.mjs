import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("assistant tool names have no duplicates", () => {
  const main=readFileSync(new URL("../apps/server/src/main.ts",import.meta.url),"utf8");
  const extras=readFileSync(new URL("../apps/server/src/assistant-tools.ts",import.meta.url),"utf8");
  const names=[...main.matchAll(/name:\s*"(brain_[a-z\d_]+)"/g),...extras.matchAll(/name:\s*"([a-z][a-z\d_]+)",\s*risk:/g)].map(m=>m[1]);
  assert.equal(new Set(names).size,names.length,"duplicate assistant tool names");
});

test("agent execution cannot accept arbitrary shell commands",()=>{
  const brain=readFileSync(new URL("../apps/server/src/brain.ts",import.meta.url),"utf8");
  const agent=brain.slice(brain.indexOf("async executeAgentBatch("),brain.indexOf("  updateStep(",brain.indexOf("async executeAgentBatch(")));
  assert.ok(agent.includes('a === "list_modules" || a === "search_memory"'));
  assert.doesNotMatch(agent,/execSync\(|spawn\(|execFile\(/);
});
