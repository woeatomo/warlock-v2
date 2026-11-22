"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const td = require("./tvl-drop"), cal = require("./paper-pnl-calendar");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("usd format and HOLD SL reason text matches the card example", () => {
  assert.strictEqual(td.usd(30194.248517380132), "$30.2k");
  assert.strictEqual(td.usd(15646.8516959708), "$15.6k");
  const ev = td.evaluate(15646.8516959708, 30194.248517380132, 45);
  assert.strictEqual(ev.ok, false);
  assert.strictEqual(ev.why, "TVL turun 48.2% sejak entry terakhir ($30.2k → $15.6k) ≥ maks 45%");
  assert.ok(ev.dropPct >= 45);
});

t("increase or shallow drop or missing prev TVL does not skip", () => {
  assert.strictEqual(td.evaluate(40000, 30000, 45).ok, true);
  assert.strictEqual(td.evaluate(20000, 30000, 45).ok, true); // 33.3%
  assert.strictEqual(td.evaluate(20000, null, 45).ok, true);
  assert.strictEqual(td.evaluate(null, 30000, 45).ok, true);
  assert.strictEqual(td.evaluate(20000, 0, 45).ok, true);
  assert.strictEqual(td.evaluate(15646, 30194, 50).ok, true);
});

t("entryTvl prefers tvlUsd, falls back to snapshot", () => {
  assert.strictEqual(td.entryTvl({ tvlUsd: 10, openContext: { snapshot: { tvlUsd: 99 } } }), 10);
  assert.strictEqual(td.entryTvl({ openContext: { snapshot: { tvlUsd: 99 } } }), 99);
  assert.strictEqual(td.entryTvl({}), null);
});

t("previousEntry is most recent earlier same mint (name fallback)", () => {
  const rows = [
    { name: "HOLD-SOL", mintX: "m1", openedAt: "2026-11-11T01:00:00.000Z", tvlUsd: 100 },
    { name: "HOLD-SOL", mintX: "m1", openedAt: "2026-11-11T03:00:00.000Z", tvlUsd: 80 },
    { name: "X-SOL", mintX: "m2", openedAt: "2026-11-11T04:00:00.000Z", tvlUsd: 70 },
    { name: "HOLD-SOL", mintX: "m1", openedAt: "2026-11-11T05:00:00.000Z", tvlUsd: 20 },
  ];
  const prev = td.previousEntry(rows, { name: "HOLD-SOL", token_x: { address: "m1" } }, "2026-11-11T05:00:00.000Z");
  assert.strictEqual(prev.openedAt, "2026-11-11T03:00:00.000Z");
  const ev = td.evaluatePool({ name: "HOLD-SOL", token_x: { address: "m1" }, tvl: 20 }, rows, 45, "2026-11-11T05:00:00.000Z");
  assert.strictEqual(ev.ok, false);
  assert.strictEqual(ev.prev.tvlUsd, 80);
});

t("hitsInHistory: drop vs the previous entry of the SAME token, threshold inclusive, first entries never hit (synthetic history)", () => {
  const td = require("./tvl-drop");
  const H = [
    { name: "A", mintX: "mA", openedAt: "2026-11-10T00:00:00Z", tvlUsd: 100000 }, { name: "A", mintX: "mA", openedAt: "2026-11-10T05:00:00Z", tvlUsd: 40000 },   // -60% -> hit
    { name: "B", mintX: "mB", openedAt: "2026-11-10T01:00:00Z", tvlUsd: 100000 }, { name: "B", mintX: "mB", openedAt: "2026-11-10T06:00:00Z", tvlUsd: 56000 },   // -44% -> no
    { name: "C", mintX: "mC", openedAt: "2026-11-10T02:00:00Z", tvlUsd: 100000 }, { name: "C", mintX: "mC", openedAt: "2026-11-10T07:00:00Z", tvlUsd: 54000 },   // -46% -> hit
    { name: "D", mintX: "mD", openedAt: "2026-11-10T03:00:00Z", tvlUsd: 50000 },                                                                                  // first entry -> never
    { name: "A", mintX: "mA", openedAt: "2026-11-11T00:00:00Z", tvlUsd: 30000 },                                                                                  // vs previous A (40k): -25% -> no
    { name: "E", mintX: "mE", openedAt: "2026-11-10T04:00:00Z", tvlUsd: 100000 }, { name: "E2", mintX: "mOther", openedAt: "2026-11-10T08:00:00Z", tvlUsd: 10000 }, // different token -> not compared
  ];
  const hits = td.hitsInHistory(H, 45);
  assert.deepStrictEqual(hits.map((h) => h.row.name + "@" + h.row.openedAt), ["A@2026-11-10T05:00:00Z", "C@2026-11-10T07:00:00Z"]);
  for (const h of hits) assert.ok(h.dropPct >= 45, h.row.name + " " + h.dropPct);
  assert.deepStrictEqual(td.hitsInHistory(H, 70), []);   // a looser limit finds nothing
});

t("settings appear in defaults and screen-refresh policy keys", () => {
  const ps = require("./paper-settings");
  const refresh = require("./paper-screen-refresh");
  assert.strictEqual(ps.DEFAULTS.TVL_DROP_FILTER_ENABLED, true);
  assert.strictEqual(ps.DEFAULTS.TVL_DROP_MAX_PCT, 45);
  assert(ps.ALLOWED_KEYS.includes("TVL_DROP_FILTER_ENABLED"));
  assert(ps.ALLOWED_KEYS.includes("TVL_DROP_MAX_PCT"));
  assert(refresh.KEYS.includes("TVL_DROP_FILTER_ENABLED") && refresh.KEYS.includes("TVL_DROP_MAX_PCT"));
  const pol = refresh.policy({});
  assert.strictEqual(pol.TVL_DROP_FILTER_ENABLED, true);
  assert.strictEqual(pol.TVL_DROP_MAX_PCT, 45);
});

console.log("test-tvl-drop: " + n + " passed");
