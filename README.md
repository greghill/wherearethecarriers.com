# Where Are the Carriers?

Static public-source aircraft carrier tracker. The frontend is a no-build GitHub Pages site in `docs/`; scheduled scraping writes `docs/data/carriers.json`.

## Run locally

```bash
npm run scrape
npm run serve
```

Open `http://localhost:8080`.

## Data flow

- `docs/index.html`, `docs/app.js`, and `docs/styles.css` render a Leaflet world map entirely in the browser.
- `docs/data/carriers.json` is the only runtime data file the page fetches.
- `scripts/scrape.mjs` pulls public GoNavy, USNI Fleet Tracker, and Stratfor topic/article metadata.
- `.github/workflows/scrape.yml` runs every four hours and commits changed data.

## Image-derived assessments

The scraper has a merge hook for points derived from public map images. Copy `scripts/image-points.example.json` to `scripts/image-points.json` and add entries shaped like:

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

That keeps OCR/vision/manual extraction separate from the static map and scraper contract.
