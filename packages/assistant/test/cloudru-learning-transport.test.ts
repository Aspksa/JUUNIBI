import { describe, it, expect, vi } from "vitest";
import { CloudRuProvider } from "../src/llm";

describe("Cloud.ru shared learning transport", () => {
 it("sends bounded max_tokens and retries a temporary HTTP 503", async () => {
  const fetcher = vi.fn()
   .mockResolvedValueOnce(new Response("", {status:503}))
   .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:"42"}}]}), {status:200,headers:{"content-type":"application/json"}}));
  const llm=new CloudRuProvider({apiKey:"sample-key",model:"demo",fetch:fetcher,retries:1,timeoutMs:2000});
  const reply=await llm.chat([{role:"user",content:"проверь"}], {maxTokens:250});
  expect(reply.content).toBe("42");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const body=JSON.parse(String(fetcher.mock.calls[0]![1].body));
  expect(body.max_tokens).toBe(250);
  expect(body.model).toBe("demo");
 });
 it("does not retry authentication errors", async () => {
  const fetcher=vi.fn().mockResolvedValue(new Response("",{status:401}));
  const llm=new CloudRuProvider({apiKey:"sample-key",model:"demo",fetch:fetcher,retries:2});
  await expect(llm.chat([{role:"user",content:"привет"}])).rejects.toMatchObject({status:401});
  expect(fetcher).toHaveBeenCalledOnce();
 });
});
