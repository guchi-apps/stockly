import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STALE_EXTRACTION_MS,
  isRetryableBatch,
  isRetryableScan,
  releasedKey,
} from "./retry.ts";

const now = new Date("2026-01-01T12:00:00Z");
const fresh = new Date(now.getTime() - 60_000);
const stale = new Date(now.getTime() - STALE_EXTRACTION_MS);

test("失敗した取り込みは再読み取りできる", () => {
  assert.equal(isRetryableBatch({ status: "FAILED", createdAt: fresh, hasAppliedCandidate: false }, now), true);
});

test("読み取り中は、放置とみなす時間までは重複のまま", () => {
  assert.equal(isRetryableBatch({ status: "EXTRACTING", createdAt: fresh, hasAppliedCandidate: false }, now), false);
  assert.equal(isRetryableBatch({ status: "EXTRACTING", createdAt: stale, hasAppliedCandidate: false }, now), true);
});

test("確認待ち・反映済みは重複として案内する", () => {
  for (const status of ["REVIEWING", "APPLIED"] as const) {
    assert.equal(isRetryableBatch({ status, createdAt: stale, hasAppliedCandidate: true }, now), false);
  }
});

test("破棄した取り込みは、反映済みの候補が無いときだけ再読み取りできる", () => {
  assert.equal(isRetryableBatch({ status: "DISCARDED", createdAt: fresh, hasAppliedCandidate: false }, now), true);
  assert.equal(isRetryableBatch({ status: "DISCARDED", createdAt: fresh, hasAppliedCandidate: true }, now), false);
});

test("減算の解析: 失敗は再読み取りでき、応答を受けた0件の解析は重複のまま", () => {
  assert.equal(isRetryableScan({ status: "FAILED", createdAt: fresh, itemCount: 0, inputTokens: 0 }, now), true);
  assert.equal(isRetryableScan({ status: "READY", createdAt: stale, itemCount: 0, inputTokens: 500 }, now), false);
  assert.equal(isRetryableScan({ status: "READY", createdAt: stale, itemCount: 2, inputTokens: 0 }, now), false);
  assert.equal(isRetryableScan({ status: "READY", createdAt: fresh, itemCount: 0, inputTokens: 0 }, now), false);
  assert.equal(isRetryableScan({ status: "READY", createdAt: stale, itemCount: 0, inputTokens: 0 }, now), true);
});

test("手放したキーは元と別の64文字で、行ごとに変わる", () => {
  const original = "a".repeat(64);
  const key = releasedKey(original, "row1");
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.notEqual(key, original);
  assert.notEqual(key, releasedKey(original, "row2"));
});
