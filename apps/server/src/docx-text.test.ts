import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { docxText } from "./docx-text";

function zipDoc(xml: string): Buffer {
  const name=Buffer.from("word/document.xml"), raw=Buffer.from(xml), packed=deflateRawSync(raw);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);
  const at=local.length+name.length+packed.length;const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(at,16);
  return Buffer.concat([local,name,packed,central,name,end]);
}
describe("DOCX text extraction",()=>{
  it("extracts paragraphs and decodes XML entities",()=>{
    const buffer=zipDoc("<w:document><w:p><w:r><w:t>Лиса &amp; книга</w:t></w:r></w:p><w:p><w:t>Текст</w:t></w:p></w:document>");
    expect(docxText(buffer)).toBe("Лиса & книга\nТекст");
  });
  it("rejects invalid container",()=>expect(()=>docxText(Buffer.from("not docx"))).toThrow());
  it("rejects zip bombs by uncompressed size",()=>{
    const z=zipDoc("<w:p>ok</w:p>");const central=30+"word/document.xml".length+deflateRawSync(Buffer.from("<w:p>ok</w:p>")).length;
    z.writeUInt32LE(9*1024*1024,central+24);
    expect(()=>docxText(z)).toThrow(/Слишком большой/);
  });
});
