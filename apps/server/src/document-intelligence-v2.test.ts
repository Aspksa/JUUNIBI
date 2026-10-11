import { describe, expect, it } from "vitest";
import { metadata, buildGraph } from "./document-intelligence-v2";
describe("Document Intelligence v2",()=>{
  it("extracts headings dates and unique links",()=>{
    expect(metadata("# План\nСрок 11.10.2026 и https://example.org/a https://example.org/a")).toEqual({
      headings:["# План"],dates:["11.10.2026"],urls:["https://example.org/a"]
    });
  });
  it("links related documents but not unrelated ones",()=>{
    const mk=(id:string,words:string[])=>({id,sha256:id,name:id+".txt",folder:"",text:"",words,headings:[],dates:[],urls:[],updatedAt:""});
    const result=buildGraph([mk("a",["alpha","bravo","charlie","delta","echo","foxtrot"]),mk("b",["alpha","bravo","charlie","delta","echo","golf"]),mk("c",["orange","kiwi","lime"])]);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]?.from).toBe("a");
    expect(result.clusters).toEqual([["a","b"]]);
  });
  it("does not treat exact copies as distinct related files",()=>{
    const make=(id:string)=>({id,sha256:"same",name:id,folder:"",text:"",words:["alpha","bravo","charlie","delta","echo"],headings:[],dates:[],urls:[],updatedAt:""});
    expect(buildGraph([make("x"),make("y")]).links).toHaveLength(0);
  });
});