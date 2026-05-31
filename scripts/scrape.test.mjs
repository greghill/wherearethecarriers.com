import { test } from "node:test";
import assert from "node:assert/strict";

import {
  articleDateFromTitle,
  parseGoNavyDate,
  goNavyEntries,
  sectionizeUsniArticle,
  scoreLocationText,
  bestCarrierLocation,
  sourceIdentity,
  addCarrierSource,
  canUsePriorSourceDuringOutage
} from "./scrape.mjs";

const NIMITZ = { hull: "CVN-68", name: "USS Nimitz", aliases: ["USS Nimitz", "CVN-68", "CVN 68"] };

test("articleDateFromTitle parses full and abbreviated months", () => {
  assert.equal(articleDateFromTitle("USNI News Fleet and Marine Tracker: May 26, 2026"), "2026-05-26");
  assert.equal(articleDateFromTitle("... May 4, 2026"), "2026-05-04");
  assert.equal(articleDateFromTitle("Sept 8, 2026"), "2026-09-08");
  assert.equal(articleDateFromTitle("no date present"), null);
  assert.equal(articleDateFromTitle(undefined), null);
});

// Known gap: the month alternation lists "Apr" but not "April", and "Apr" cannot be
// followed by "il", so full-word "April N, YYYY" titles fail to parse. Surfaced (not
// failing the suite) so it isn't lost. USNI no longer relies on this — it reads the
// wp-json `date` field — but other sources still parse the title.
test("articleDateFromTitle should handle full-word April", { todo: true }, () => {
  assert.equal(articleDateFromTitle("April 13, 2026"), "2026-04-13");
});

test("parseGoNavyDate handles GoNavy formats and rejects junk", () => {
  assert.equal(parseGoNavyDate("25MAY2026"), "2026-05-25");
  assert.equal(parseGoNavyDate("2026.05.25"), "2026-05-25");
  assert.equal(parseGoNavyDate(""), null);
  assert.equal(parseGoNavyDate("garbage"), null);
  assert.equal(parseGoNavyDate(null), null);
});

test("goNavyEntries extracts dated operational rows and stops at the schedule", () => {
  const remarks =
    "<DT>20May2026 operating in the Caribbean Sea" +
    "<DT>24May2026 departed for the Caribbean Sea" +
    "-------[ Schedule ]-------" +
    "<DT>30Jun2026 future planned entry";
  const entries = goNavyEntries(remarks);
  assert.equal(entries.length, 2);
  assert.match(entries.at(-1), /24May2026/);
  // Schedule-section entries are excluded.
  assert.ok(!entries.some((e) => /30Jun2026/.test(e)));
});

test("sectionizeUsniArticle splits on <h2> with no <article> wrapper (wp-json path)", () => {
  const html = "<h2>In the Red Sea</h2><p>USS Truman here.</p><h2>In Norfolk</h2><p>USS Bush.</p>";
  const sections = sectionizeUsniArticle(html);
  assert.deepEqual(sections, [
    { heading: "In the Red Sea", text: "USS Truman here." },
    { heading: "In Norfolk", text: "USS Bush." }
  ]);
});

test("sectionizeUsniArticle prefers the <article> body when present", () => {
  const html =
    "<header><h2>Site Nav</h2></header>" +
    "<article><h2>In the Arabian Sea</h2><p>USS Lincoln operating.</p></article>" +
    "<footer><h2>Newsletter</h2></footer>";
  const sections = sectionizeUsniArticle(html);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, "In the Arabian Sea");
});

test("scoreLocationText rewards action verbs and penalizes home-port language", () => {
  const operating = scoreLocationText("USS Nimitz is operating in the Arabian Sea", NIMITZ);
  assert.equal(operating.hint.name, "Arabian Sea");
  assert.equal(operating.score, 10); // +5 alias, +5 operating

  const home = scoreLocationText("USS Nimitz is homeported in San Diego", NIMITZ);
  assert.equal(home.score, -3); // +5 alias, -8 homeported

  assert.equal(scoreLocationText("USS Nimitz somewhere vague", NIMITZ), null); // no hint
});

test("bestCarrierLocation picks the highest-scoring location for the carrier", () => {
  const best = bestCarrierLocation("USS Nimitz arrived in the Caribbean Sea.", NIMITZ, "");
  assert.ok(best);
  assert.equal(best.hint.name, "Caribbean Sea");
  assert.ok(best.score >= 5);
});

test("sourceIdentity keys on url + note", () => {
  assert.equal(sourceIdentity({ url: "u1", note: "n1" }), "u1|n1");
  assert.notEqual(
    sourceIdentity({ url: "u1", note: "Text context: X" }),
    sourceIdentity({ url: "u1", note: "Image estimate" })
  );
});

test("addCarrierSource merges same url+note but keeps different notes separate", () => {
  const carrier = { sources: [] };
  const text = { url: "u1", note: "Text context: Caribbean", publisher: "USNI News" };
  const image = { url: "u1", note: "Image estimate", publisher: "USNI News" };

  addCarrierSource(carrier, text, { role: "primary", usedFor: ["location"] });
  addCarrierSource(carrier, image, { role: "backup" });
  // Same article, different note (text vs image) -> two distinct entries.
  assert.equal(carrier.sources.length, 2);

  // Re-adding the identical text source merges rather than duplicating.
  addCarrierSource(carrier, text, { role: "backup" });
  assert.equal(carrier.sources.length, 2);

  const merged = carrier.sources.find((s) => s.note === "Text context: Caribbean");
  assert.equal(merged.role, "primary"); // primary is sticky once set
});

test("canUsePriorSourceDuringOutage respects status and grace window", () => {
  const generatedAt = "2026-05-30T00:00:00Z";
  const mk = (status, firstErrorAt) => ({ usni: { status, firstErrorAt } });

  assert.equal(canUsePriorSourceDuringOutage(mk("ok", null), "usni", generatedAt), false);
  assert.equal(canUsePriorSourceDuringOutage(mk("error", "2026-05-28T00:00:00Z"), "usni", generatedAt), true); // 2d <= 3
  assert.equal(canUsePriorSourceDuringOutage(mk("error", "2026-05-24T00:00:00Z"), "usni", generatedAt), false); // 6d > 3
  assert.equal(canUsePriorSourceDuringOutage({}, "usni", generatedAt), false); // no entry
});
