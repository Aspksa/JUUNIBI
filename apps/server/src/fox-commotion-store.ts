import path from "node:path";
import {runPythonJson} from "./python";

/** SQLite worker for bounded client-observed Fox history. Needs Python 3: without it the call fails with a 503 that says so. */
export function foxSQLite(root:string,payload:unknown):Promise<unknown>{
 return runPythonJson<unknown>(path.join(root,"scripts","fox-commotion-sqlite.py"),path.join(root,"data","fox-commotion.sqlite3"),payload);
}
