import { describe, expect, it } from "vitest";

describe("protected Spirecut check probe", () => {
  it("temporarily fails so merge blocking can be observed in isolation", () => {
    expect("required check").toBe("successful check");
  });
});