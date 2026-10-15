import { describe, expect, it } from "vitest";
import { SessionHistory } from "./session-history";

describe("SessionHistory", () => {
  it("keeps only the configured newest messages", () => {
    const history = new SessionHistory(4);
    history.appendTurn("s", "u1", "a1");
    history.appendTurn("s", "u2", "a2");
    history.appendTurn("s", "u3", "a3");
    expect(history.get("s").map((message) => message.content)).toEqual(["u2", "a2", "u3", "a3"]);
  });

  it("isolates sessions and returns defensive copies", () => {
    const history = new SessionHistory(10);
    history.appendTurn("a", "ua", "aa");
    history.appendTurn("b", "ub", "ab");
    const copy = history.get("a");
    copy.push({ role: "user", content: "mutated" });
    expect(history.get("a").map((message) => message.content)).toEqual(["ua", "aa"]);
    expect(history.get("b").map((message) => message.content)).toEqual(["ub", "ab"]);
  });

  it("clears only the requested session", () => {
    const history = new SessionHistory(10);
    history.appendTurn("a", "u", "a");
    history.appendTurn("b", "u", "b");
    history.clear("a");
    expect(history.get("a")).toEqual([]);
    expect(history.get("b")).toHaveLength(2);
  });
});
