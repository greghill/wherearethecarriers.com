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

USNI, Stratfor, and TWZ category/topic pages are treated as indexes. The scraper first discovers the latest actual tracker/map article, then parses that article and captures the likely tracker-map image URL as source evidence.

## Data flow

- `docs/index.html`, `docs/app.js`, and `docs/styles.css` render a Leaflet world map in the browser.
- `docs/data/carriers.json` is the only runtime data file the page fetches.
- `scripts/scrape.mjs` fetches public source pages, parses source text, picks approximate map positions, and writes `docs/data/carriers.json`.
- `.github/workflows/scrape.yml` runs every four hours and commits changed data back to the repository.

The current JSON contract stays intentionally simple: one carrier record per ship, with selected status/location/confidence and an embedded list of supporting sources.

## Source parsing notes

- GoNavy is parsed from carrier table rows and the latest dated operational entry, avoiding homeport boilerplate where possible.
- USNI is parsed by article section so a carrier mention in one regional section is not confused with another.
- TWZ parsing trims related-story snippets and handles the current article's “respectively” phrasing for multiple carriers and ports.
- Stratfor currently contributes article/map metadata. Image-derived locations can be added through the manual hook below.

## Image-derived assessments

Automatic OCR/image georeferencing is not enabled yet. For now, use a small manual merge file for public map-image points.

Copy `scripts/image-points.example.json` to `scripts/image-points.json` and add entries shaped like:

```json
{
  "sourceKey": "stratfor",
  "hull": "CVN-72",
  "locationName": "Arabian Sea",
  "position": { "lat": 18.0, "lon": 63.0 },
  "confidence": "high",
  "note": "Point read from public Stratfor naval update map image."
}
```

The scraper merges those entries into `docs/data/carriers.json` without changing the frontend.

## Deployment

Use GitHub Pages with the publish source set to the `docs/` folder on `master`. The scheduled workflow needs repository `contents: write` permission so it can commit updated JSON.
