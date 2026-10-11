import { existsSync } from "node:fs";
import path from "node:path";

/** npm workspaces use links/junctions in the root node_modules on Windows and Unix. */
export function missingWorkspaceLinks(root) {
  return ["@juunibi/core", "@juunibi/assistant", "@juunibi/server", "@juunibi/web"]
    .filter(name => !existsSync(path.join(root, "node_modules", ...name.split("/"), "package.json")));
}
