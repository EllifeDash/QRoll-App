import { createHmac, timingSafeEqual } from "crypto";

/**
 * Stateless signed token per docs/api.md:
 *   payload = { s: stationId, sh: shiftId, exp: unixSeconds }
 *   token   = base64url(JSON(payload)) + "." + base64url(HMAC-SHA256(payload, HMAC_SECRET))
 */

export interface TokenPayload {
  s: string;
  sh: number;
  exp: number;
}

const TOKEN_TTL_SEC = 60;

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function unb64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", process.env.HMAC_SECRET!)
    .update(payload)
    .digest("base64url");
}

export function mintToken(stationId: string, shiftId: number, now = Date.now()): {
  token: string;
  expiresAt: number;
} {
  const payload: TokenPayload = {
    s: stationId,
    sh: shiftId,
    exp: Math.floor(now / 1000) + TOKEN_TTL_SEC,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return { token: `${payloadB64}.${sign(payloadB64)}`, expiresAt: payload.exp };
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; error: "invalid_token" | "token_expired" };

export function verifyToken(
  token: string,
  now = Date.now()
): VerifyResult {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, error: "invalid_token" };
  }
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: "invalid_token" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(unb64url(payloadB64)) as TokenPayload;
  } catch {
    return { ok: false, error: "invalid_token" };
  }
  if (
    typeof payload.s !== "string" ||
    typeof payload.sh !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, error: "invalid_token" };
  }

  const nowSec = Math.floor(now / 1000);
  if (payload.exp <= nowSec) {
    return { ok: false, error: "token_expired" };
  }
  return { ok: true, payload };
}
