process.env.HMAC_SECRET ??= "test-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import { mintToken, verifyToken } from "@/lib/token";

test("sign → verify roundtrip returns payload", () => {
  const now = Date.UTC(2026, 7, 1, 9, 0, 0);
  const { token } = mintToken("s03", 1, now);
  const result = verifyToken(token, now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.s, "s03");
    assert.equal(result.payload.sh, 1);
    assert.equal(result.payload.exp, Math.floor(now / 1000) + 60);
  }
});

test("expiresAt is now + 60s", () => {
  const now = Date.UTC(2026, 7, 1, 9, 0, 0);
  const { expiresAt } = mintToken("s01", 2, now);
  assert.equal(expiresAt, Math.floor(now / 1000) + 60);
});

test("tampered signature rejected as invalid_token", () => {
  const now = Date.UTC(2026, 7, 1, 9, 0, 0);
  const { token } = mintToken("s03", 1, now);
  const [payload, sig] = token.split(".");
  const flipped = sig[0] === "A" ? "B" : "A";
  const result = verifyToken(`${payload}.${flipped}${sig.slice(1)}`, now);
  assert.deepEqual(result, { ok: false, error: "invalid_token" });
});

test("tampered payload rejected as invalid_token", () => {
  const now = Date.UTC(2026, 7, 1, 9, 0, 0);
  const { token } = mintToken("s03", 1, now);
  const forged = Buffer.from(
    JSON.stringify({ s: "s99", sh: 1, exp: Math.floor(now / 1000) + 60 })
  ).toString("base64url");
  const result = verifyToken(`${forged}.${token.split(".")[1]}`, now);
  assert.deepEqual(result, { ok: false, error: "invalid_token" });
});

test("expired token rejected as token_expired", () => {
  const now = Date.UTC(2026, 7, 1, 9, 0, 0);
  const { token } = mintToken("s03", 1, now);
  const result = verifyToken(token, now + 61_000);
  assert.deepEqual(result, { ok: false, error: "token_expired" });
});

test("valid token just before expiry still verifies", () => {
  const now = Date.UTC(2026, 7, 1, 9, 0, 0);
  const { token } = mintToken("s03", 1, now);
  const result = verifyToken(token, now + 59_999);
  assert.equal(result.ok, true);
});

test("malformed token rejected as invalid_token", () => {
  for (const bad of ["", "abc", "a.b.c.d", "....", "abc."]) {
    assert.deepEqual(verifyToken(bad, Date.now()), {
      ok: false,
      error: "invalid_token",
    });
  }
});

import { createHmac } from "crypto";

test("token with wrong payload shape rejected", () => {
  const now = Date.UTC(2026, 7, 1, 9, 0, 0);
  const payload = Buffer.from(JSON.stringify({ x: 1 })).toString("base64url");
  const sig = createHmac("sha256", "test-secret").update(payload).digest("base64url");
  const result = verifyToken(`${payload}.${sig}`, now);
  assert.deepEqual(result, { ok: false, error: "invalid_token" });
});
