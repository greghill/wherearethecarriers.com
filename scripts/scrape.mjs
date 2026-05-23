import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const DATA_PATH = new URL("../docs/data/carriers.json", import.meta.url);
const IMAGE_POINTS_PATH = new URL("./image-points.json", import.meta.url);

const SOURCE_URLS = {
  gonavy: "http://www.gonavy.jp/CVLocation.html",
  usniIndex: "https://news.usni.org/category/fleet-tracker",
  stratforIndex: "https://worldview.stratfor.com/topic/tracking-us-naval-power"
};

const CARRIERS = [
  { hull: "CVN-68", name: "USS Nimitz", aliases: ["USS Nimitz", "CVN-68", "CVN 68"] },
  { hull: "CVN-69", name: "USS Dwight D. Eisenhower", aliases: ["USS Dwight D. Eisenhower", "Dwight D. Eisenhower", "Eisenhower", "CVN-69", "CVN 69"] },
  { hull: "CVN-70", name: "USS Carl Vinson", aliases: ["USS Carl Vinson", "Carl Vinson", "CVN-70", "CVN 70"] },
  { hull: "CVN-71", name: "USS Theodore Roosevelt", aliases: ["USS Theodore Roosevelt", "Theodore Roosevelt", "CVN-71", "CVN 71"] },
  { hull: "CVN-72", name: "USS Abraham Lincoln", aliases: ["USS Abraham Lincoln", "Abraham Lincoln", "CVN-72", "CVN 72"] },
  { hull: "CVN-73", name: "USS George Washington", aliases: ["USS George Washington", "George Washington", "CVN-73", "CVN 73"] },
  { hull: "CVN-74", name: "USS John C. Stennis", aliases: ["USS John C. Stennis", "John C. Stennis", "Stennis", "CVN-74", "CVN 74"] },
  { hull: "CVN-75", name: "USS Harry S. Truman", aliases: ["USS Harry S. Truman", "Harry S. Truman", "Truman", "CVN-75", "CVN 75"] },
  { hull: "CVN-76", name: "USS Ronald Reagan", aliases: ["USS Ronald Reagan", "Ronald Reagan", "CVN-76", "CVN 76"] },
  { hull: "CVN-77", name: "USS George H.W. Bush", aliases: ["USS George H.W. Bush", "USS George H. W. Bush", "George H.W. Bush", "George H. W. Bush", "CVN-77", "CVN 77"] },
  { hull: "CVN-78", name: "USS Gerald R. Ford", aliases: ["USS Gerald R. Ford", "Gerald R. Ford", "CVN-78", "CVN 78"] }
];

const LOCATION_HINTS = [
  { match: /north arabian sea|arabian sea|centcom/i, name: "Arabian Sea", lat: 18.0, lon: 63.0, status: "deployed" },
  { match: /newport news shipyard|newport news shipbuilding|outfitting berth/i, name: "Newport News, Virginia", lat: 36.986, lon: -76.432, status: "maintenance" },
  { match: /puget sound naval shipyard|psns|dry dock/i, name: "Bremerton, Washington", lat: 47.561, lon: -122.648, status: "maintenance" },
  { match: /yokosuka/i, name: "Yokosuka, Japan", lat: 35.281, lon: 139.672, status: "port" },
  { match: /sasebo/i, name: "Sasebo, Japan", lat: 33.159, lon: 129.715, status: "port" },
  { match: /san diego|north island/i, name: "San Diego, California", lat: 32.715, lon: -117.173, status: "port" },
  { match: /norfolk/i, name: "Norfolk, Virginia", lat: 36.946, lon: -76.322, status: "port" },
  { match: /bremerton|kitsap/i, name: "Bremerton, Washington", lat: 47.561, lon: -122.648, status: "port" },
  { match: /pearl harbor/i, name: "Pearl Harbor, Hawaii", lat: 21.354, lon: -157.950, status: "port" },
  { match: /red sea/i, name: "Red Sea", lat: 19.5, lon: 38.0, status: "deployed" },
  { match: /eastern mediterranean/i, name: "Eastern Mediterranean Sea", lat: 34.5, lon: 29.5, status: "deployed" },
  { match: /mediterranean/i, name: "Mediterranean Sea", lat: 36.0, lon: 18.0, status: "deployed" },
  { match: /south atlantic|eastern coast of brazil|coast of brazil|guanabara bay|rio de janeiro/i, name: "South Atlantic", lat: -24.0, lon: -35.0, status: "deployed" },
  { match: /western atlantic/i, name: "Western Atlantic", lat: 33.0, lon: -68.0, status: "deployed" },
  { match: /virginia capes|east coast of the united states/i, name: "Western Atlantic", lat: 33.0, lon: -68.0, status: "deployed" },
  { match: /eastern pacific/i, name: "Eastern Pacific", lat: 24.0, lon: -128.0, status: "deployed" },
  { match: /southern california operating areas/i, name: "Eastern Pacific", lat: 31.0, lon: -121.0, status: "deployed" },
  { match: /western pacific/i, name: "Western Pacific", lat: 18.0, lon: 145.0, status: "deployed" },
  { match: /philippine sea|south china sea|sulu sea/i, name: "Western Pacific", lat: 18.0, lon: 145.0, status: "deployed" },
  { match: /indo-pacific/i, name: "Indo-Pacific", lat: 8.0, lon: 126.0, status: "deployed" }
];

const textDecoder = new TextDecoder("utf-8");

function decodeEntities(value = "") {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&ldquo;/g, "\"")
    .replace(/&#8221;|&rdquo;/g, "\"")
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return decodeEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
}

function cleanUrl(url) {
  if (!url) return null;
  return decodeEntities(url).replace(/\\\//g, "/");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "wherearethecarriers.com public-source tracker (+https://github.com/)"
    },
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return textDecoder.decode(buffer);
}

function extractMeta(html, property) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  return cleanUrl(html.match(pattern)?.[1]);
}

function absoluteUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function articleDateFromTitle(title) {
  const match = title?.match(/(?:May|Apr|March|Mar|June|Jun|July|Jul|August|Aug|September|Sept|October|Oct|November|Nov|December|Dec|January|Jan|February|Feb)\.?\s+\d{1,2},?\s+\d{4}/i);
  if (!match) return null;
  const parsed = new Date(match[0].replace(/,\s*/, " "));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function sourceFromArticle({ publisher, title, url, publishedAt, note, imageUrl }) {
  return { publisher, title, url, publishedAt, note, imageUrl };
}

function findLocationHint(text) {
  return LOCATION_HINTS.find((hint) => hint.match.test(text));
}

function containsAlias(text, record) {
  const lower = text.toLowerCase();
  return record.aliases.some((alias) => lower.includes(alias.toLowerCase()));
}

function matchingAlias(text, record) {
  return record.aliases.find((alias) => text.toLowerCase().includes(alias.toLowerCase()));
}

function contextAround(text, alias, radius = 220) {
  const index = text.toLowerCase().indexOf(alias.toLowerCase());
  if (index === -1) return "";
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|(?=\b[A-Z][a-z]+craft carrier USS\b)|(?=\bCarrier USS\b)|(?=\bUSS\b)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreLocationText(text, record) {
  const hint = findLocationHint(text);
  if (!hint) return null;

  let score = containsAlias(text, record) ? 5 : 0;
  if (/\boperating\b|\bunderway\b|\bin support of\b|\bconducting\b/i.test(text)) score += 5;
  if (/\breturned\b|\barrived\b|\banchored\b|\bin port\b/i.test(text)) score += 4;
  if (/\bdeparted\b/i.test(text)) score += 1;
  if (/\bhomeported\b|\bhome port\b|from Naval Air Station|from Naval Station/i.test(text)) score -= 8;
  return { hint, score, text };
}

function bestCarrierLocation(text, record, fallbackHeading = "") {
  const candidates = [];
  for (const sentence of splitSentences(text)) {
    if (!containsAlias(sentence, record) && !matchingAlias(text, record)) continue;
    const candidate = scoreLocationText(sentence, record);
    if (candidate) candidates.push(candidate);
  }

  const alias = matchingAlias(text, record);
  if (alias) {
    const nearby = contextAround(text, alias, 260);
    const nearbyCandidate = scoreLocationText(nearby, record);
    if (nearbyCandidate) candidates.push(nearbyCandidate);
  }

  const headingCandidate = scoreLocationText(fallbackHeading, record);
  if (headingCandidate) candidates.push({ ...headingCandidate, score: headingCandidate.score + 1 });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function sectionizeUsniArticle(html) {
  const body = (html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html).replace(/\r/g, "");
  const parts = body.split(/<h2[^>]*>/i).slice(1);
  return parts.map((part) => {
    const [headingRaw, ...rest] = part.split(/<\/h2>/i);
    const content = rest.join("</h2>").split(/<h2[^>]*>/i)[0];
    return {
      heading: stripTags(headingRaw),
      text: stripTags(content)
    };
  });
}

function extractTableCells(row) {
  return [...row.matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map((match) => match[1]);
}

function parseGoNavyDate(value) {
  if (!value) return null;
  const cleaned = value.replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function goNavyEntries(remarksHtml) {
  const operationalHtml = remarksHtml.split(/-------\[\s*Schedule\s*\]/i)[0];
  return operationalHtml
    .split(/<DT>/i)
    .slice(1)
    .map(stripTags)
    .map((entry) => entry.replace(/^Back log\s*/i, "").trim())
    .filter((entry) => /\d{2}[A-Za-z]{3}\d{4}/.test(entry));
}

function rowForCarrier(html, record) {
  return [...html.matchAll(/<TR>([\s\S]*?)<\/TR>/gi)]
    .map((match) => match[1])
    .map((row) => {
      const rawCells = extractTableCells(row);
      const cells = rawCells.length === 3 ? [rawCells[0], "", rawCells[1], rawCells[2]] : rawCells;
      return { row, cells };
    })
    .filter(({ cells }) => {
      const ship = stripTags(cells[0] || "");
      return new RegExp(`${record.hull.replace("-", "\\s*")}|${record.hull}`, "i").test(ship);
    })
    .at(-1);
}

function blankCarrier(record) {
  return {
    hull: record.hull,
    name: record.name,
    status: "unknown",
    locationName: "Unknown",
    position: null,
    confidence: "unknown",
    lastSeen: null,
    summary: "No current public-source assessment has been attached yet.",
    sources: []
  };
}

function applyAssessment(carrier, assessment) {
  const currentWeight = confidenceWeight(carrier.confidence);
  const nextWeight = confidenceWeight(assessment.confidence);
  const nextNewer = !carrier.lastSeen || (assessment.lastSeen && assessment.lastSeen >= carrier.lastSeen);
  if (carrier.confidence === "unknown" || nextWeight > currentWeight || (nextWeight === currentWeight && nextNewer)) {
    carrier.status = assessment.status || carrier.status;
    carrier.locationName = assessment.locationName || carrier.locationName;
    carrier.position = assessment.position || carrier.position;
    carrier.confidence = assessment.confidence || carrier.confidence;
    carrier.lastSeen = assessment.lastSeen || carrier.lastSeen;
    carrier.summary = assessment.summary || carrier.summary;
  }

  for (const source of assessment.sources || []) {
    if (!carrier.sources.some((item) => item.url === source.url && item.note === source.note)) {
      carrier.sources.push(source);
    }
  }
}

function confidenceWeight(value) {
  return { unknown: 0, low: 1, medium: 2, high: 3 }[value || "unknown"] ?? 0;
}

async function scrapeUsni() {
  const indexHtml = await fetchText(SOURCE_URLS.usniIndex);
  const linkMatch = indexHtml.match(/href=["']([^"']+)["'][^>]*>\s*USNI News Fleet and Marine Tracker:\s*([^<]+)</i);
  const articleUrl = absoluteUrl(linkMatch?.[1] || "/2026/05/18/usni-news-fleet-and-marine-tracker-may-18-2026", SOURCE_URLS.usniIndex);
  const articleHtml = await fetchText(articleUrl);
  const title = stripTags(articleHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || "USNI News Fleet and Marine Tracker";
  const publishedAt = articleDateFromTitle(title) || articleDateFromTitle(stripTags(articleHtml));
  const imageUrl = extractMeta(articleHtml, "og:image") || cleanUrl(articleHtml.match(/https:\/\/news\.usni\.org\/wp-content\/uploads\/[^"']+\.(?:jpg|png)/i)?.[0]);
  const articleText = stripTags(articleHtml);
  const sections = sectionizeUsniArticle(articleHtml);
  const assessments = [];

  for (const record of CARRIERS) {
    if (!containsAlias(articleText, record)) continue;

    const carrierSections = sections.filter((candidate) => containsAlias(candidate.text, record));
    const best = carrierSections
      .map((section) => ({
        section,
        candidate: bestCarrierLocation(section.text, record, section.heading)
      }))
      .filter((item) => item.candidate)
      .sort((a, b) => b.candidate.score - a.candidate.score)[0];

    if (!best) continue;

    const hint = best.candidate.hint;
    const context = best.candidate.text;
    const returned = /returned|arrived|in port/i.test(context);
    const status = returned && hint.status === "port" ? "port" : hint.status;
    const confidence = /operating|returned|underway|deployed|in support of|after visiting/i.test(context) ? "medium" : "low";
    assessments.push({
      hull: record.hull,
      status,
      locationName: hint.name,
      position: { lat: hint.lat, lon: hint.lon },
      confidence,
      lastSeen: publishedAt,
      summary: `${title} places ${record.name} in or near ${hint.name}. The point is an approximate public-source assessment.`,
      sources: [
        sourceFromArticle({
          publisher: "USNI News",
          title,
          url: articleUrl,
          publishedAt,
          note: `Text context: ${hint.name}`,
          imageUrl
        })
      ]
    });
  }

  return {
    ok: true,
    articleUrl,
    title,
    publishedAt,
    imageUrl,
    assessments
  };
}

async function scrapeStratfor() {
  const indexHtml = await fetchText(SOURCE_URLS.stratforIndex);
  const latestMatch = indexHtml.match(/href=["']([^"']+)["'][^>]*>\s*(?:Assessments\s*)?(?:[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*)?U\.S\. Naval Update Map:\s*([^<]+)/i);
  const articleUrl = absoluteUrl(latestMatch?.[1] || "/article/us-naval-update-map-may-21-2026", SOURCE_URLS.stratforIndex);
  const articleHtml = await fetchText(articleUrl);
  const title = stripTags(articleHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || "U.S. Naval Update Map";
  const publishedAt = articleDateFromTitle(title) || articleDateFromTitle(stripTags(articleHtml));
  const imageUrl = extractMeta(articleHtml, "og:image") || cleanUrl(articleHtml.match(/https:\/\/worldview\.stratfor\.com\/sites\/default\/files\/[^"']+\.(?:jpg|jpeg|png)(?:\?[^"']+)?/i)?.[0]);
  return {
    ok: true,
    articleUrl,
    title,
    publishedAt,
    imageUrl,
    assessments: []
  };
}

async function scrapeGoNavy() {
  const html = await fetchText(SOURCE_URLS.gonavy);
  const assessments = [];

  for (const record of CARRIERS) {
    const row = rowForCarrier(html, record);
    if (!row) continue;

    const remarksHtml = row.cells[2] || "";
    const lastUpdate = parseGoNavyDate(stripTags(row.cells[3] || ""));
    const entries = goNavyEntries(remarksHtml);
    const latestEntry = entries.at(-1);
    if (!latestEntry) continue;

    const best = bestCarrierLocation(`${record.name} ${record.hull}. ${latestEntry}`, record);
    if (!best) continue;

    const hint = best.hint;
    const returned = /\breturned\b|\barrived\b|\banchored\b/i.test(latestEntry);
    const departedOnly = /\bdeparted\b/i.test(latestEntry) && !/\bfor\b|\ben route\b|\boperating\b|\bin the\b/i.test(latestEntry);
    assessments.push({
      hull: record.hull,
      status: departedOnly ? "unknown" : returned && hint.status === "port" ? "port" : hint.status,
      locationName: hint.name,
      position: { lat: hint.lat, lon: hint.lon },
      confidence: "medium",
      lastSeen: lastUpdate,
      summary: `GoNavy's latest table entry places ${record.name} in or near ${hint.name}: ${latestEntry}`,
      sources: [
        sourceFromArticle({
          publisher: "GoNavy.jp",
          title: "Aircraft Carrier Locations",
          url: SOURCE_URLS.gonavy,
          publishedAt: lastUpdate,
          note: `Latest row: ${latestEntry}`
        })
      ]
    });
  }

  return { ok: true, assessments };
}

async function loadImagePointAssessments(sourceSummaries) {
  if (!existsSync(IMAGE_POINTS_PATH)) return [];
  const raw = await readFile(IMAGE_POINTS_PATH, "utf8");
  const points = JSON.parse(raw);
  return points.assessments.map((point) => {
    const record = CARRIERS.find((item) => item.hull === point.hull);
    const sourceSummary = sourceSummaries[point.sourceKey] || {};
    return {
      hull: point.hull,
      status: point.status || "deployed",
      locationName: point.locationName,
      position: point.position,
      confidence: point.confidence || "medium",
      lastSeen: point.lastSeen || sourceSummary.publishedAt,
      summary: point.summary || `${record?.name || point.hull} was placed from a public map image.`,
      sources: [
        sourceFromArticle({
          publisher: point.publisher || sourceSummary.publisher,
          title: point.title || sourceSummary.title,
          url: point.url || sourceSummary.articleUrl,
          publishedAt: point.lastSeen || sourceSummary.publishedAt,
          note: point.note || "Image-derived map point",
          imageUrl: point.imageUrl || sourceSummary.imageUrl
        })
      ]
    };
  });
}

async function main() {
  const previous = existsSync(DATA_PATH) ? JSON.parse(await readFile(DATA_PATH, "utf8")) : { carriers: [] };
  const carriers = new Map(CARRIERS.map((record) => [record.hull, blankCarrier(record)]));
  const sourceStatus = {};
  const sourceSummaries = {};

  const scrapers = [
    ["usni", scrapeUsni],
    ["stratfor", scrapeStratfor],
    ["gonavy", scrapeGoNavy]
  ];

  for (const [key, scraper] of scrapers) {
    try {
      const result = await scraper();
      sourceStatus[key] = "ok";
      sourceSummaries[key] = {
        publisher: key === "usni" ? "USNI News" : key === "stratfor" ? "Stratfor Worldview" : "GoNavy.jp",
        ...result
      };
      for (const assessment of result.assessments || []) {
        applyAssessment(carriers.get(assessment.hull), assessment);
      }
    } catch (error) {
      sourceStatus[key] = `error: ${error.message}`;
    }
  }

  for (const assessment of await loadImagePointAssessments(sourceSummaries)) {
    applyAssessment(carriers.get(assessment.hull), assessment);
  }

  for (const oldCarrier of previous.carriers || []) {
    const carrier = carriers.get(oldCarrier.hull);
    if (carrier && carrier.confidence === "unknown" && oldCarrier.confidence !== "unknown" && !oldCarrier.summary?.startsWith("No fresh source matched")) {
      carrier.status = oldCarrier.status;
      carrier.locationName = oldCarrier.locationName;
      carrier.position = oldCarrier.position;
      carrier.confidence = "low";
      carrier.lastSeen = oldCarrier.lastSeen;
      carrier.summary = `No fresh source matched this run, so this is a stale prior assessment: ${oldCarrier.summary}`;
      carrier.sources = oldCarrier.sources || [];
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceStatus,
    carriers: [...carriers.values()]
  };

  await writeFile(DATA_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${output.carriers.length} carrier records to ${DATA_PATH.pathname}`);
  for (const [key, status] of Object.entries(sourceStatus)) {
    console.log(`${key}: ${status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
