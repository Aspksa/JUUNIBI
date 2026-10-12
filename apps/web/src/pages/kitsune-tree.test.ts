import {describe,it,expect} from "vitest";
import { TREE_NODES,treeConnections } from "./kitsune-tree";
describe("Kitsune Tree data",()=>{
 it("uses unique ids and resolvable relationships",()=>{
   const ids=new Set(TREE_NODES.map(n=>n.id));
   expect(ids.size).toBe(TREE_NODES.length);
   expect(treeConnections().every(e=>ids.has(e.from)&&ids.has(e.to))).toBe(true);
 });
 it("distinguishes shipped and future capabilities",()=>{
   expect(TREE_NODES.find(n=>n.id==="evolution3")?.status).toBe("planned");
   expect(TREE_NODES.find(n=>n.id==="brain")?.evidence).toContain("/269");
 });
});