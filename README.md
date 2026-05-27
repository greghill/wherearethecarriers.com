# Where Are the Carriers?

Static public-source aircraft carrier tracker. The site is built for easy GitHub Pages hosting: the browser loads one JSON file and does all map rendering client side.

This is not live tracking and does not claim exact positions. Every point is an approximate public-source assessment with source links attached.

## Run locally

```bash
npm run scrape
npm run serve
```

Open `http://localhost:8080`.

## Current sources

- GoNavy aircraft carrier locations: `http://www.gonavy.jp/CVLocation.html`
- USNI Fleet and Marine Tracker: `https://news.usni.org/category/fleet-tracker`
- Stratfor U.S. Naval Update Map: `https://worldview.stratfor.com/topic/tracking-us-naval-power`
- The War Zone carrier tracker: `https://www.twz.com/category/carrier-tracker`

USNI, Stratfor, and TWZ category/topic pages are treated as indexes. The scraper first discovers the latest actual tracker/map article, then parses that article and captures the likely tracker-map image URL as source context.

## Data flow

- `docs/index.html`, `docs/app.js`, and `docs/styles.css` render a Leaflet world map in the browser.
- `docs/data/carriers.json` is the runtime carrier data file.
- `docs/data/scrape-status.json` tracks scrape/source health separately so source outages can be visible without making carrier data look changed.
- `scripts/scrape.mjs` fetches public source pages, parses source text, picks approximate map positions, and writes both JSON files.
- `.github/workflows/scrape.yml` runs hourly and commits carrier data only when a carrier's status, location, evidence, confidence, last-seen date, or position actually changes. Scrape-health-only runs commit only `docs/data/scrape-status.json`.

The current JSON contract stays intentionally simple: one carrier record per ship, with selected status, location, last reported date, approximate position, and an embedded list of supporting sources.

## Source parsing notes

- GoNavy is parsed from carrier table rows and the latest dated operational entry, avoiding homeport boilerplate where possible.
- USNI is parsed by article section so a carrier mention in one regional section is not confused with another.
- TWZ parsing trims related-story snippets and handles the current article's “respectively” phrasing for multiple carriers and ports.
- Stratfor contributes article/map metadata, and can contribute image-derived positions when OpenAI image parsing is enabled.

## Image-derived assessments

The scraper can optionally use OpenAI vision parsing for USNI, Stratfor, and TWZ tracker map images. Set this GitHub Actions secret to enable it:

```text
OPENAI_API_KEY
```

Optional GitHub Actions variable:

```text
OPENAI_MODEL=gpt-5.5
```

(`gpt-5.5` is also the default if the variable is unset.)

When enabled, the scraper sends the latest tracker map images to the OpenAI Responses API and asks for approximate carrier positions as structured JSON. Results are cached in `scripts/map-image-cache.json` by image URL/model/date so unchanged map images are not reprocessed every scheduled run.

If `OPENAI_API_KEY` is not set, image parsing is skipped and the scraper falls back to text-derived regional/port assessments.

You can also use a small manual merge file for public map-image points.

Copy `scripts/image-points.example.json` to `scripts/image-points.json` and add entries shaped like:

```json
{
  "sourceKey": "stratfor",
  "hull": "CVN-72",
  "locationName": "Arabian Sea",
  "position": { "lat": 18.0, "lon": 63.0 },
  "note": "Point read from public Stratfor naval update map image."
}
```

The scraper merges those entries into `docs/data/carriers.json` without changing the frontend.

## Deployment

Use GitHub Pages with the publish source set to the `docs/` folder on `master`. The scheduled workflow needs repository `contents: write` permission so it can commit updated JSON.
