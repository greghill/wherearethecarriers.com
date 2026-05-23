import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const DATA_PATH = new URL("../docs/data/carriers.json", import.meta.url);
const IMAGE_POINTS_PATH = new URL("./image-points.json", import.meta.url);
const IMAGE_ANALYSIS_CACHE_PATH = new URL("./map-image-cache.json", import.meta.url);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SOURCE_URLS = {
  gonavy: "http://www.gonavy.jp/CVLocation.html",
  usniIndex: "https://news.usni.org/category/fleet-tracker",
  stratforIndex: "https://worldview.stratfor.com/topic/tracking-us-naval-power",
  twzIndex: "https://www.twz.com/category/carrier-tracker"
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

function linksFromHtml(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absoluteUrl(cleanUrl(match[1]), baseUrl);
    const text = stripTags(match[2]);
    if (url) links.push({ url, text });
  }
  return links;
}

function firstUniqueUrl(items) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    return item.url;
  }
  return null;
}

function findLatestUsniTrackerUrl(html) {
  return firstUniqueUrl(
    linksFromHtml(html, SOURCE_URLS.usniIndex)
      .filter((link) => /usni-news-fleet-and-marine-tracker/i.test(link.url) || /USNI News Fleet and Marine Tracker/i.test(link.text))
  );
}

function findLatestStratforMapUrl(html) {
  return firstUniqueUrl(
    linksFromHtml(html, SOURCE_URLS.stratforIndex)
      .filter((link) => /us-naval-update-map/i.test(link.url) || /U\.S\. Naval Update Map/i.test(link.text))
  );
}

function findLatestTwzUrl(html) {
  return firstUniqueUrl(
    linksFromHtml(html, SOURCE_URLS.twzIndex)
      .filter((link) => /twz\.com\/sea\/(?:where-are-the-carriers|carrier-tracker-as-of)/i.test(link.url))
  );
}

function imageUrlsFromHtml(html, baseUrl) {
  const urls = [];
  for (const property of ["og:image", "twitter:image"]) {
    const meta = extractMeta(html, property);
    if (meta) urls.push(absoluteUrl(meta, baseUrl) || meta);
  }
  for (const match of html.matchAll(/<(?:img|source|link)[^>]+(?:src|href|data-src|srcset|imagesrcset)=["']([^"']+)["']/gi)) {
    const value = cleanUrl(match[1]);
    if (!value) continue;
    const candidates = value.split(",").map((part) => part.trim().split(/\s+/)[0]);
    for (const candidate of candidates) {
      if (/\.(?:jpg|jpeg|png)(?:\?|$)/i.test(candidate)) {
        urls.push(absoluteUrl(candidate, baseUrl) || candidate);
      }
    }
  }
  return [...new Set(urls)];
}

function upgradeStratforImageUrl(url) {
  if (!url) return url;
  const stripped = url.replace(/\/sites\/default\/files\/styles\/[^/]+\/public\//, "/sites/default/files/");
  return stripped.split("?")[0];
}

function bestMapImageUrl(html, baseUrl, sourceKey) {
  const urls = imageUrlsFromHtml(html, baseUrl);
  const mapPatterns = {
    usni: /\/FT_|fleet|tracker|map/i,
    twz: /Carrier-Tracker|carrier.*tracker|map/i,
    stratfor: /naval.*update.*map|display|map/i
  };
  const picked = urls.find((url) => mapPatterns[sourceKey]?.test(url)) || urls[0] || null;
  return sourceKey === "stratfor" ? upgradeStratforImageUrl(picked) : picked;
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

function sourceKeyToPublisher(sourceKey) {
  return sourceKey === "usni" ? "USNI News" : sourceKey === "stratfor" ? "Stratfor Worldview" : sourceKey === "twz" ? "The War Zone" : "GoNavy.jp";
}

function articleTextFromHtml(html, stopPattern) {
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
  let text = stripTags(article);
  if (stopPattern) {
    text = text.split(stopPattern)[0].trim();
  }
  return text;
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

function extractPublishedDate(html, fallbackText = "") {
  const metaDate = extractMeta(html, "article:published_time") || html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1];
  if (metaDate) {
    const dateOnly = metaDate.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateOnly) return dateOnly[1];
    const parsed = new Date(metaDate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return articleDateFromTitle(fallbackText);
}

function twzRespectivelyAssessments(text, { title, articleUrl, publishedAt, imageUrl }) {
  const assessments = [];
  const pattern = /USS George Washington\s*,\s*USS Dwight D\. Eisenhower\s*,\s*and USS Theodore Roosevelt[\s\S]{0,260}?pulled into Yokosuka,\s*Norfolk,\s*and San Diego,\s*respectively/i;
  if (!pattern.test(text)) return assessments;

  const mappings = [
    ["CVN-73", "Yokosuka, Japan"],
    ["CVN-69", "Norfolk, Virginia"],
    ["CVN-71", "San Diego, California"]
  ];

  for (const [hull, locationName] of mappings) {
    const record = CARRIERS.find((item) => item.hull === hull);
    const hint = LOCATION_HINTS.find((item) => item.name === locationName);
    if (!record || !hint) continue;
    assessments.push({
      hull,
      status: "port",
      locationName: hint.name,
      position: { lat: hint.lat, lon: hint.lon },
      confidence: "medium",
      lastSeen: publishedAt,
      summary: `${title} reports ${record.name} pulled into ${hint.name}.`,
      sources: [
        sourceFromArticle({
          publisher: "The War Zone",
          title,
          url: articleUrl,
          publishedAt,
          note: `Text context: pulled into ${hint.name}`,
          imageUrl
        })
      ]
    });
  }

  return assessments;
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
    positionPrecision: "unknown",
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
  const nextIsImage = isImageAssessment(assessment);
  const currentIsImage = carrier.positionPrecision === "image_estimate";
  const imageCanRefine = nextIsImage && nextWeight >= 2 && isBroadRegionalAssessment(carrier) && imageMatchesCentroidRegion(carrier, assessment);
  const imageCanReplaceImage = nextIsImage && currentIsImage && (nextWeight > currentWeight || (nextWeight === currentWeight && nextNewer));
  const shouldReplace = nextIsImage
    ? carrier.confidence === "unknown" || imageCanRefine || imageCanReplaceImage
    : carrier.confidence === "unknown" || nextWeight > currentWeight || (nextWeight === currentWeight && nextNewer);

  if (shouldReplace) {
    const refiningCentroid = nextIsImage && imageCanRefine && !currentIsImage;
    carrier.status = assessment.status || carrier.status;
    if (!refiningCentroid) carrier.locationName = assessment.locationName || carrier.locationName;
    carrier.position = assessment.position || carrier.position;
    carrier.positionPrecision = inferPositionPrecision(assessment);
    carrier.confidence = assessment.confidence || carrier.confidence;
    if (!refiningCentroid) carrier.lastSeen = assessment.lastSeen || carrier.lastSeen;
    if (!refiningCentroid) carrier.summary = assessment.summary || carrier.summary;
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

function isImageAssessment(assessment) {
  return assessment.positionPrecision === "image_estimate";
}

function isBroadRegionalAssessment(carrier) {
  if (!carrier.position) return true;
  if (carrier.positionPrecision === "image_estimate") return false;
  return /sea|ocean|atlantic|pacific|mediterranean|indo-pacific|caribbean|centcom/i.test(carrier.locationName || "");
}

function imageMatchesCentroidRegion(carrier, assessment) {
  const carrierHint = findLocationHint(carrier.locationName || "");
  const imageHint = findLocationHint(assessment.locationName || "");
  if (carrierHint && imageHint) return carrierHint.name === imageHint.name;

  const ref = carrier.position;
  const candidate = assessment.position;
  if (!ref || !candidate) return false;
  return Math.abs(ref.lat - candidate.lat) <= 8 && Math.abs(ref.lon - candidate.lon) <= 8;
}

function inferPositionPrecision(assessment) {
  if (assessment.positionPrecision) return assessment.positionPrecision;
  if (assessment.status === "port" || assessment.status === "maintenance") return "port";
  if (/sea|ocean|atlantic|pacific|mediterranean|indo-pacific|caribbean|centcom/i.test(assessment.locationName || "")) return "region";
  return "unknown";
}

async function scrapeUsni() {
  const indexHtml = await fetchText(SOURCE_URLS.usniIndex);
  const articleUrl = findLatestUsniTrackerUrl(indexHtml) || absoluteUrl("/2026/05/18/usni-news-fleet-and-marine-tracker-may-18-2026", SOURCE_URLS.usniIndex);
  const articleHtml = await fetchText(articleUrl);
  const title = stripTags(articleHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || "USNI News Fleet and Marine Tracker";
  const publishedAt = articleDateFromTitle(title) || articleDateFromTitle(stripTags(articleHtml));
  const imageUrl = bestMapImageUrl(articleHtml, articleUrl, "usni");
  const articleText = articleTextFromHtml(articleHtml);
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
  const articleUrl = findLatestStratforMapUrl(indexHtml) || absoluteUrl("/article/us-naval-update-map-may-21-2026", SOURCE_URLS.stratforIndex);
  const articleHtml = await fetchText(articleUrl);
  const title = stripTags(articleHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || "U.S. Naval Update Map";
  const publishedAt = articleDateFromTitle(title) || articleDateFromTitle(stripTags(articleHtml));
  const imageUrl = bestMapImageUrl(articleHtml, articleUrl, "stratfor");
  return {
    ok: true,
    articleUrl,
    title,
    publishedAt,
    imageUrl,
    assessments: []
  };
}

async function scrapeTwz() {
  const indexHtml = await fetchText(SOURCE_URLS.twzIndex);
  const articleUrl = findLatestTwzUrl(indexHtml) || SOURCE_URLS.twzIndex;
  const articleHtml = articleUrl === SOURCE_URLS.twzIndex ? indexHtml : await fetchText(articleUrl);
  const title = stripTags(articleHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || extractMeta(articleHtml, "og:title") || "The War Zone Carrier Tracker";
  const publishedAt = extractPublishedDate(articleHtml, title);
  const imageUrl = bestMapImageUrl(articleHtml, articleUrl, "twz");
  const articleText = articleTextFromHtml(articleHtml, /Latest in Carrier Tracker|More in Carrier Tracker|The War Zone Wire/);
  const assessments = twzRespectivelyAssessments(articleText, { title, articleUrl, publishedAt, imageUrl });

  for (const record of CARRIERS) {
    if (!containsAlias(articleText, record)) continue;
    if (assessments.some((assessment) => assessment.hull === record.hull)) continue;

    const best = bestCarrierLocation(articleText, record);
    if (!best || best.score < 5) continue;

    const hint = best.hint;
    const context = best.text;
    const returned = /returned|arrived|pulled into|homecoming|upon arrival/i.test(context);
    const status = returned && (hint.status === "port" || hint.status === "maintenance") ? hint.status : hint.status;

    assessments.push({
      hull: record.hull,
      status,
      locationName: hint.name,
      position: { lat: hint.lat, lon: hint.lon },
      confidence: "medium",
      lastSeen: publishedAt,
      summary: `${title} places ${record.name} in or near ${hint.name}.`,
      sources: [
        sourceFromArticle({
          publisher: "The War Zone",
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

function cacheKeyForImage(sourceSummary) {
  return [
    OPENAI_MODEL,
    sourceSummary.articleUrl || "",
    sourceSummary.imageUrl || "",
    sourceSummary.publishedAt || ""
  ].join("|");
}

async function loadImageAnalysisCache() {
  if (!existsSync(IMAGE_ANALYSIS_CACHE_PATH)) {
    return { version: 1, analyses: {} };
  }
  const raw = await readFile(IMAGE_ANALYSIS_CACHE_PATH, "utf8");
  return JSON.parse(raw);
}

async function saveImageAnalysisCache(cache) {
  await writeFile(IMAGE_ANALYSIS_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

function carrierMapSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["sourceKey", "imageUrl", "publishedAt", "carriers"],
    properties: {
      sourceKey: { type: "string", enum: ["usni", "stratfor", "twz"] },
      imageUrl: { type: "string" },
      publishedAt: { type: ["string", "null"] },
      carriers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["hull", "name", "locationName", "lat", "lon", "confidence", "evidenceText", "rationale"],
          properties: {
            hull: { type: "string", enum: CARRIERS.map((carrier) => carrier.hull) },
            name: { type: "string" },
            locationName: { type: "string" },
            lat: { type: "number" },
            lon: { type: "number" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            evidenceText: { type: "string" },
            rationale: { type: "string" }
          }
        }
      }
    }
  };
}

function openAiMapPrompt(sourceKey, sourceSummary) {
  const carrierList = CARRIERS.map((carrier) => `${carrier.hull} ${carrier.name}`).join("\n");
  return `Analyze this public carrier tracker map image from ${sourceKey}.

Return only U.S. aircraft carriers from this allowlist:
${carrierList}

Task:
- Read the map visually and estimate each carrier marker or label location.
- Return approximate latitude/longitude for the visual map marker/label, not a generic region centroid.
- If two carriers are close but shown as separate, preserve that separation.
- Omit carriers that are not visible or are too uncertain to locate.
- Do not include amphibious ships, destroyers, submarines, or foreign ships.
- Treat all coordinates as approximate public-source image estimates.

Article title: ${sourceSummary.title || "unknown"}
Article URL: ${sourceSummary.articleUrl || "unknown"}
Published date: ${sourceSummary.publishedAt || "unknown"}`;
}

async function callOpenAiForMapImage(sourceKey, sourceSummary) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: openAiMapPrompt(sourceKey, sourceSummary) },
            { type: "input_image", image_url: sourceSummary.imageUrl, detail: "high" }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "carrier_map_analysis",
          strict: true,
          schema: carrierMapSchema()
        }
      }
    })
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI map parse failed for ${sourceKey}: ${response.status} ${body.slice(0, 300)}`);
  }

  const parsed = JSON.parse(body);
  const outputText = parsed.output_text || parsed.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) {
    throw new Error(`OpenAI map parse returned no output_text for ${sourceKey}`);
  }
  return JSON.parse(outputText);
}

function imageResultToAssessments(result, sourceKey, sourceSummary) {
  const sourcePublisher = sourceKeyToPublisher(sourceKey);
  return (result.carriers || [])
    .filter((item) => CARRIERS.some((carrier) => carrier.hull === item.hull))
    .filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)) && Number(item.lat) >= -90 && Number(item.lat) <= 90 && Number(item.lon) >= -180 && Number(item.lon) <= 180)
    .map((item) => {
      const record = CARRIERS.find((carrier) => carrier.hull === item.hull);
      return {
        hull: item.hull,
        status: findLocationHint(item.locationName)?.status || "deployed",
        locationName: item.locationName,
        position: { lat: Number(item.lat), lon: Number(item.lon) },
        positionPrecision: "image_estimate",
        confidence: item.confidence,
        lastSeen: result.publishedAt || sourceSummary.publishedAt,
        summary: `${sourceSummary.title || sourcePublisher} places ${record?.name || item.hull} near ${item.locationName} from a public tracker map image.`,
        sources: [
          sourceFromArticle({
            publisher: sourcePublisher,
            title: sourceSummary.title,
            url: sourceSummary.articleUrl,
            publishedAt: result.publishedAt || sourceSummary.publishedAt,
            note: `Image estimate: ${item.evidenceText || item.rationale || item.locationName}`,
            imageUrl: sourceSummary.imageUrl || result.imageUrl
          })
        ]
      };
    });
}

async function loadOpenAiImageAssessments(sourceSummaries, sourceStatus) {
  const imageSources = Object.entries(sourceSummaries)
    .filter(([sourceKey, summary]) => ["usni", "stratfor", "twz"].includes(sourceKey) && summary.imageUrl);

  if (!imageSources.length) return [];
  if (!OPENAI_API_KEY) {
    recordStatus(sourceStatus, "openaiImages", "skipped", "OPENAI_API_KEY not set");
    return [];
  }

  const cache = await loadImageAnalysisCache();
  let cacheChanged = false;
  const assessments = [];
  const errors = [];

  for (const [sourceKey, summary] of imageSources) {
    const cacheKey = cacheKeyForImage(summary);
    try {
      if (!cache.analyses[cacheKey]) {
        cache.analyses[cacheKey] = {
          sourceKey,
          model: OPENAI_MODEL,
          imageUrl: summary.imageUrl,
          articleUrl: summary.articleUrl,
          publishedAt: summary.publishedAt,
          createdAt: new Date().toISOString(),
          result: await callOpenAiForMapImage(sourceKey, summary)
        };
        cacheChanged = true;
      }
      assessments.push(...imageResultToAssessments(cache.analyses[cacheKey].result, sourceKey, summary));
    } catch (error) {
      errors.push(`${sourceKey}: ${error.message}`);
    }
  }

  if (cacheChanged) await saveImageAnalysisCache(cache);
  if (errors.length) recordStatus(sourceStatus, "openaiImages", "partial", errors.join("; "));
  else recordStatus(sourceStatus, "openaiImages", "ok");
  return assessments;
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

function carryStatusEntry(previousStatus, key) {
  const prior = previousStatus?.[key];
  if (prior && typeof prior === "object") {
    return {
      status: prior.status || "unknown",
      lastFetchedAt: prior.lastFetchedAt || null,
      lastSuccessAt: prior.lastSuccessAt || null,
      lastErrorAt: prior.lastErrorAt || null,
      message: prior.message || null
    };
  }
  return { status: "unknown", lastFetchedAt: null, lastSuccessAt: null, lastErrorAt: null, message: null };
}

function recordStatus(sourceStatus, key, outcome, message) {
  const now = new Date().toISOString();
  const entry = sourceStatus[key];
  entry.status = outcome;
  entry.lastFetchedAt = now;
  entry.message = message || null;
  if (outcome === "ok") entry.lastSuccessAt = now;
  else if (outcome === "error") entry.lastErrorAt = now;
}

async function main() {
  const previous = existsSync(DATA_PATH) ? JSON.parse(await readFile(DATA_PATH, "utf8")) : { carriers: [] };
  const carriers = new Map(CARRIERS.map((record) => [record.hull, blankCarrier(record)]));
  const sourceStatus = {};
  const sourceSummaries = {};

  const scrapers = [
    ["usni", scrapeUsni],
    ["stratfor", scrapeStratfor],
    ["twz", scrapeTwz],
    ["gonavy", scrapeGoNavy]
  ];

  for (const [key] of scrapers) sourceStatus[key] = carryStatusEntry(previous.sourceStatus, key);
  sourceStatus.openaiImages = carryStatusEntry(previous.sourceStatus, "openaiImages");

  for (const [key, scraper] of scrapers) {
    try {
      const result = await scraper();
      recordStatus(sourceStatus, key, "ok");
      sourceSummaries[key] = {
        publisher: key === "usni" ? "USNI News" : key === "stratfor" ? "Stratfor Worldview" : key === "twz" ? "The War Zone" : "GoNavy.jp",
        ...result
      };
      for (const assessment of result.assessments || []) {
        applyAssessment(carriers.get(assessment.hull), assessment);
      }
    } catch (error) {
      recordStatus(sourceStatus, key, "error", error.message);
    }
  }

  for (const assessment of await loadOpenAiImageAssessments(sourceSummaries, sourceStatus)) {
    applyAssessment(carriers.get(assessment.hull), assessment);
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
  for (const [key, entry] of Object.entries(sourceStatus)) {
    const suffix = entry.message ? ` (${entry.message})` : "";
    console.log(`${key}: ${entry.status}${suffix}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
