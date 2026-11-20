import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "@/lib/safe-next";

test("keeps same-site paths", () => {
  assert.equal(safeNextPath("/dashboard"), "/dashboard");
  assert.equal(safeNextPath("/join/abc?x=1"), "/join/abc?x=1");
});

test("rejects anything that could leave the site", () => {
  for (const v of ["@evil.com", ".evil.com", "//evil.com", "/\\evil.com", "https://evil.com", "", null, undefined, 5]) {
    assert.equal(safeNextPath(v), null, String(v));
    assert.equal(new URL(`https://app.test${safeNextPath(v) ?? "/dashboard"}`).host, "app.test");
  }
});
