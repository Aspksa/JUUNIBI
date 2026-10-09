import { describe, expect, it, vi } from "vitest";
import { checkPublicEvidence } from "./public-evidence";

describe("Brain 4.1 evidence review", () => {
  it("rejects arbitrary hosts, traversal, short quotes", async () => {
    await expect(checkPublicEvidence("evil", "x", "word ".repeat(10))).rejects.toThrow();
    await expect(checkPublicEvidence("nasa", "../private", "word ".repeat(10))).rejects.toThrow();
    await expect(checkPublicEvidence("nasa", "", "short")).rejects.toThrow();
  });
  it("matches documented text without asserting truth", async () => {
    const fetcher = vi.fn(async () => new Response("<html><p>The solar system contains the Sun and the objects that orbit it.</p></html>", {headers: {"content-type": "text/html"}}));
    const result = await checkPublicEvidence("nasa", "", "The solar system contains the Sun and the objects that orbit it.", fetcher as unknown as typeof fetch);
    expect(result.matched).toBe(true);
    expect(result.source).toBe("https://science.nasa.gov/");
    expect(fetcher).toHaveBeenCalledWith("https://science.nasa.gov/", expect.objectContaining({ redirect: "error" }));
  });
  it("rejects oversized and redirected content", async () => {
    const huge = vi.fn(async () => new Response("a".repeat(350001), { headers: {"content-type":"text/html"} }));
    await expect(checkPublicEvidence("python", "", "a".repeat(50), huge as unknown as typeof fetch)).rejects.toThrow("размер");
    const redirected = vi.fn(async () => { throw new Error("redirect"); });
    await expect(checkPublicEvidence("nasa", "", "x".repeat(50), redirected as unknown as typeof fetch)).rejects.toThrow();
  });
});
