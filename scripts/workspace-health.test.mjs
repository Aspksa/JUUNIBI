import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { missingWorkspaceLinks } from "./workspace-health.mjs";

test("detects incomplete npm workspace installation before typecheck", () => {
  const root = mkdtempSync(path.join(tmpdir(), "juunibi-workspaces-"));
  try {
    assert.deepEqual(missingWorkspaceLinks(root), ["@juunibi/core", "@juunibi/assistant", "@juunibi/server", "@juunibi/web"]);
    for (const name of ["core", "assistant", "server", "web"]) {
      const target = path.join(root, "node_modules", "@juunibi", name);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "package.json"), JSON.stringify({name:"@juunibi/" + name}));
    }
    assert.deepEqual(missingWorkspaceLinks(root), []);
    rmSync(path.join(root, "node_modules", "@juunibi", "core", "package.json"));
    assert.deepEqual(missingWorkspaceLinks(root), ["@juunibi/core"]);
  } finally { rmSync(root, {recursive:true,force:true}); }
});
