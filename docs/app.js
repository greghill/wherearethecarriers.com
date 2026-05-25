const DATA_URL = "./data/carriers.json";
const ACTIONS_API_URL = "https://api.github.com/repos/greghill/wherearethecarriers.com/actions/workflows/scrape.yml/runs?per_page=1";
const ACTIONS_WORKFLOW_URL = "https://github.com/greghill/wherearethecarriers.com/actions/workflows/scrape.yml";
const DATA_COMMITS_URL = "https://github.com/greghill/wherearethecarriers.com/commits/master/docs/data/carriers.json";

const statusLabels = {
  deployed: "Deployed",
  port: "In port",
  maintenance: "Maintenance",
  unknown: "Unknown"
};

const confidenceLabels = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "--"
};

const shortNames = {
  "CVN-68": "Nimitz",
  "CVN-69": "Eisenhower",
  "CVN-70": "Carl Vinson",
  "CVN-71": "Roosevelt",
  "CVN-72": "Lincoln",
  "CVN-73": "Washington",
  "CVN-74": "Stennis",
  "CVN-75": "Truman",
  "CVN-76": "Reagan",
  "CVN-77": "Bush",
  "CVN-78": "Ford"
};

const minMapZoom = window.innerWidth < 640 ? 1 : 3;

const map = L.map("map", {
  minZoom: minMapZoom,
  zoomControl: false,
  attributionControl: false,
  worldCopyJump: true
}).setView([21, 15], minMapZoom);

L.control.zoom({ position: "bottomleft" }).addTo(map);

const tileOpts = {
  maxZoom: 9,
  minZoom: minMapZoom,
  keepBuffer: 4,
  updateWhenZooming: false,
  crossOrigin: true
};
const esri = (path, attribution = "Tiles &copy; Esri") => L.tileLayer(
  `https://services.arcgisonline.com/arcgis/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`,
  { ...tileOpts, attribution }
);
const carto = (style) => L.tileLayer(
  `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`,
  { ...tileOpts, attribution: "&copy; OpenStreetMap contributors &copy; CARTO", subdomains: "abcd" }
);

const baseLayers = {
  "CARTO Voyager": carto("rastertiles/voyager"),
  "CARTO Positron": carto("light_all"),
  "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    ...tileOpts, attribution: "&copy; OpenStreetMap contributors"
  }),
  "OpenTopoMap": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    ...tileOpts, attribution: "&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)", subdomains: "abc"
  }),
  "Esri National Geographic": esri("NatGeo_World_Map"),
  "Esri Light Gray Canvas": L.layerGroup([
    esri("Canvas/World_Light_Gray_Base"),
    esri("Canvas/World_Light_Gray_Reference", "")
  ]),
  "Esri World Street Map": esri("World_Street_Map"),
  "Esri World Topographic": esri("World_Topo_Map"),
  "Esri Satellite Imagery": L.layerGroup([
    esri("World_Imagery", "Tiles &copy; Esri, Maxar, Earthstar Geographics"),
    esri("Reference/World_Boundaries_and_Places", "")
  ])
};

const defaultBasemap = "CARTO Voyager";
let activeBasemap = baseLayers[defaultBasemap].addTo(map);

const BasemapControl = L.Control.extend({
  onAdd() {
    const select = L.DomUtil.create("select", "basemap-select");
    select.setAttribute("aria-label", "Basemap");
    for (const name of Object.keys(baseLayers)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    select.value = defaultBasemap;
    L.DomEvent.disableClickPropagation(select);
    L.DomEvent.disableScrollPropagation(select);
    select.addEventListener("change", () => {
      map.removeLayer(activeBasemap);
      activeBasemap = baseLayers[select.value].addTo(map);
      renderBasemapAttribution();
    });
    return select;
  }
});
new BasemapControl({ position: "bottomright" }).addTo(map);

let state = {
  data: null,
  actionRun: null,
  filter: "all",
  selectedHull: null,
  markers: new Map(),
  isRenderingMarkers: false
};

const els = {
  updated: document.querySelector("#updated"),
  shipName: document.querySelector("#ship-name"),
  confidence: document.querySelector("#confidence"),
  summary: document.querySelector("#ship-summary"),
  status: document.querySelector("#ship-status"),
  location: document.querySelector("#ship-location"),
  seen: document.querySelector("#ship-seen"),
  sources: document.querySelector("#source-list"),
  aboutSources: document.querySelector("#about-source-list"),
  basemapAttribution: document.querySelector("#basemap-attribution"),
  fleet: document.querySelector("#fleet-list"),
  filters: [...document.querySelectorAll(".chip")]
};

function layerAttributions(layer) {
  if (layer instanceof L.LayerGroup) {
    const attributions = [];
    layer.eachLayer((child) => {
      attributions.push(...layerAttributions(child));
    });
    return attributions;
  }

  const attribution = layer.options?.attribution;
  return attribution ? [attribution] : [];
}

function renderBasemapAttribution() {
  if (!els.basemapAttribution) return;
  els.basemapAttribution.innerHTML = layerAttributions(activeBasemap).join(" | ");
}

renderBasemapAttribution();

function formatDate(value) {
  if (!value) return "--";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(year, month - 1, day));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined
  }).format(date);
}

function statusFor(carrier) {
  return carrier.status || "unknown";
}

function formatRelative(value, { withAgo = true } = {}) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const seconds = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const suffix = withAgo ? " ago" : "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h${suffix}`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d${suffix}`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo${suffix}`;
  return `${Math.round(months / 12)}y${suffix}`;
}

function daysSince(value) {
  if (!value) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((Date.now() - parsed.getTime()) / 86400000);
}

function staleness(value) {
  const days = daysSince(value);
  if (days === null) return null;
  if (days > 14) return { className: "stale-old", label: "very stale", days };
  if (days > 7) return { className: "stale-warn", label: "stale", days };
  return null;
}

function isVisible(carrier) {
  return state.filter === "all" || statusFor(carrier) === state.filter;
}

function markerClass(carrier) {
  const status = statusFor(carrier);
  const confidence = carrier.confidence || "unknown";
  return [
    "carrier-marker",
    status,
    confidence === "low" ? "low" : "",
    carrier.hull === state.selectedHull ? "selected" : ""
  ].join(" ");
}

function markerLabel(carrier) {
  return (carrier.hull || "?").replace(/^CVN-/, "");
}

function displayName(carrier) {
  return shortNames[carrier.hull] || carrier.name.replace(/^USS\s+/, "");
}

function createIcon(carrier) {
  return L.divIcon({
    className: "",
    html: `
      <span class="${markerClass(carrier)}">
        <span class="marker-dot">${markerLabel(carrier)}</span>
        <span class="marker-text">${displayName(carrier)}</span>
      </span>
    `,
    iconSize: [160, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18]
  });
}

function markerOffsets(carriers) {
  const positioned = carriers
    .filter((carrier) => carrier.position)
    .map((carrier) => ({
      carrier,
      key: `${carrier.position.lat.toFixed(3)},${carrier.position.lon.toFixed(3)}`
    }));

  const clustersByCoordinate = new Map();
  for (const item of positioned) {
    const cluster = clustersByCoordinate.get(item.key) || [];
    cluster.push(item);
    clustersByCoordinate.set(item.key, cluster);
  }

  const offsets = new Map();
  for (const cluster of clustersByCoordinate.values()) {
    const count = cluster.length;
    cluster.forEach((item, index) => {
      if (count === 1) {
        offsets.set(item.carrier.hull, L.point(0, 0));
        return;
      }

      const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
      const radius = window.innerWidth < 640 ? 5 : 7;
      offsets.set(item.carrier.hull, L.point(Math.cos(angle) * radius, Math.sin(angle) * radius));
    });
  }

  return offsets;
}

function renderMarkers() {
  if (!state.data || state.isRenderingMarkers) return;
  state.isRenderingMarkers = true;
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();

  const visibleCarriers = state.data.carriers.filter(isVisible);
  const offsets = markerOffsets(visibleCarriers);
  visibleCarriers.forEach((carrier) => {
    if (!carrier.position) return;
    const basePoint = map.latLngToLayerPoint([carrier.position.lat, carrier.position.lon]);
    const offset = offsets.get(carrier.hull) || L.point(0, 0);
    const markerLatLng = map.layerPointToLatLng(basePoint.add(offset));
    const marker = L.marker(markerLatLng, {
      icon: createIcon(carrier),
      title: `${carrier.name} ${carrier.hull}`
    }).addTo(map);
    marker.on("click", () => selectCarrier(carrier.hull, true));
    state.markers.set(carrier.hull, marker);
  });
  state.isRenderingMarkers = false;
}

function refreshMarkerIcons() {
  state.markers.forEach((marker, hull) => {
    const carrier = state.data.carriers.find((item) => item.hull === hull);
    if (carrier) marker.setIcon(createIcon(carrier));
  });
}

function fitVisibleMarkers() {
  const positions = state.data.carriers
    .filter(isVisible)
    .filter((carrier) => carrier.position)
    .map((carrier) => [carrier.position.lat, carrier.position.lon]);

  if (!positions.length) return;
  map.fitBounds(L.latLngBounds(positions), {
    animate: false,
    maxZoom: minMapZoom,
    paddingTopLeft: window.innerWidth < 640 ? [12, 138] : [20, 86],
    paddingBottomRight: [20, 24]
  });
}

function sourceClassName(source) {
  const publisher = (source.publisher || "").toLowerCase();
  const url = (source.url || "").toLowerCase();
  const value = `${publisher} ${url}`;

  if (value.includes("gonavy.jp")) return "source-gonavy";
  if (value.includes("the war zone") || value.includes("twz.com")) return "source-war-zone";
  if (value.includes("stratfor")) return "source-stratfor";
  if (value.includes("usni")) return "source-usni";
  return "";
}

function usedForLabel(source) {
  const values = source.usedFor || [];
  if (values.includes("coordinate_refinement")) return "coordinate refinement";
  if (values.includes("status") && values.includes("location")) return "status, location";

  const labels = values
    .filter((value) => value !== "summary")
    .map((value) => value.replace("_", " "));
  if (labels.length) return labels.join(", ");
  return source.role === "backup" ? "backup" : "";
}

function renderAboutSources() {
  if (!els.aboutSources) return;
  els.aboutSources.innerHTML = "";
  const sourceMap = new Map();

  state.data.carriers.forEach((carrier) => {
    (carrier.sources || []).forEach((source) => {
      if (!source.url) return;
      const publisher = source.publisher || "Source";
      if (!sourceMap.has(publisher)) sourceMap.set(publisher, source);
    });
  });

  [...sourceMap.values()]
    .sort((a, b) => (a.publisher || "").localeCompare(b.publisher || ""))
    .forEach((source) => {
      const link = document.createElement("a");
      const sourceClass = sourceClassName(source);
      link.className = `source-label${sourceClass ? ` ${sourceClass}` : ""}`;
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = source.publisher || "Source";
      els.aboutSources.append(link);
    });
}

function renderFleet() {
  els.fleet.innerHTML = "";
  state.data.carriers.forEach((carrier) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = `fleet-button${carrier.hull === state.selectedHull ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span><strong>${carrier.hull}</strong> ${carrier.name}</span>
      <span class="fleet-location">${carrier.locationName || "Unknown"}</span>
    `;
    button.addEventListener("click", () => selectCarrier(carrier.hull, true));
    item.append(button);
    els.fleet.append(item);
  });
}

function renderSources(carrier) {
  els.sources.innerHTML = "";
  const sources = carrier.sources || [];
  if (!sources.length) {
    const item = document.createElement("li");
    item.textContent = "No source attached yet.";
    els.sources.append(item);
    return;
  }

  sources.forEach((source) => {
    const item = document.createElement("li");
    const publisher = document.createElement("span");
    const sourceClass = sourceClassName(source);
    publisher.className = `source-label${sourceClass ? ` ${sourceClass}` : ""}`;
    publisher.textContent = source.publisher || "Source";
    const labelRow = document.createElement("div");
    labelRow.className = "source-label-row";
    labelRow.append(publisher);
    const usedFor = usedForLabel(source);
    if (usedFor) {
      const usage = document.createElement("span");
      usage.className = `source-use${usedFor === "backup" ? " backup" : ""}`;
      usage.textContent = usedFor;
      labelRow.append(usage);
    }
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = source.title || source.publisher || source.url;
    const meta = document.createElement("p");
    meta.className = "source-meta";
    meta.textContent = [
      source.publisher,
      source.publishedAt ? formatDate(source.publishedAt) : null,
      source.note
    ].filter(Boolean).join(" | ");
    item.append(labelRow, link, meta);
    els.sources.append(item);
  });
}

function selectCarrier(hull, moveMap = false) {
  const carrier = state.data.carriers.find((item) => item.hull === hull) || state.data.carriers[0];
  if (!carrier) return;

  state.selectedHull = carrier.hull;
  els.shipName.textContent = `${carrier.name} (${carrier.hull})`;
  els.confidence.textContent = confidenceLabels[carrier.confidence || "unknown"];
  els.confidence.className = `confidence${carrier.confidence ? "" : " muted"}`;
  els.summary.textContent = carrier.summary || "No assessment has been generated yet.";
  els.status.textContent = statusLabels[statusFor(carrier)] || statusLabels.unknown;
  els.location.textContent = carrier.locationName || "Unknown";
  els.seen.textContent = "";
  els.seen.append(document.createTextNode(formatDate(carrier.lastSeen)));
  const stale = staleness(carrier.lastSeen);
  if (stale) {
    const badge = document.createElement("span");
    badge.className = `stale-pill ${stale.className}`;
    badge.textContent = `${stale.label} (${stale.days}d)`;
    els.seen.append(" ", badge);
  }
  renderSources(carrier);
  refreshMarkerIcons();
  renderFleet();

  if (moveMap && carrier.position) {
    map.flyTo([carrier.position.lat, carrier.position.lon], Math.max(map.getZoom(), 3), {
      duration: 0.55
    });
  }
}

function setFilter(filter) {
  state.filter = filter;
  els.filters.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
  renderMarkers();
  fitVisibleMarkers();
}

function updateFilterCounts() {
  const counts = { all: state.data.carriers.length };
  state.data.carriers.forEach((carrier) => {
    const s = statusFor(carrier);
    counts[s] = (counts[s] || 0) + 1;
  });
  const labels = window.innerWidth < 640
    ? { all: "All", deployed: "Deployed", port: "Port", maintenance: "Maint.", unknown: "Unknown" }
    : { all: "Total", deployed: "Deployed", port: "At Port", maintenance: "Maintenance", unknown: "Unknown" };
  els.filters.forEach((button) => {
    const key = button.dataset.filter;
    const n = counts[key] ?? 0;
    button.textContent = `${n} ${labels[key] || key}`;
    if (key === "unknown") button.hidden = n === 0;
  });
}

async function loadData() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load ${DATA_URL}: ${response.status}`);
  }
  state.data = await response.json();
  renderUpdatedHeader();
  map.invalidateSize();
  state.selectedHull = state.data.carriers[0]?.hull || null;
  updateFilterCounts();
  renderAboutSources();
  renderMarkers();
  fitVisibleMarkers();
  renderFleet();
  selectCarrier(state.data.carriers[0]?.hull);
  window.setTimeout(() => map.invalidateSize(), 250);
}

els.filters.forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
});

window.addEventListener("load", () => {
  map.invalidateSize();
});

map.on("zoomend", renderMarkers);

function scrapeStatusIcon(action) {
  const span = document.createElement("span");
  span.className = "scrape-status";
  let label;
  if (action.status === "in_progress" || action.status === "queued") {
    span.classList.add("in-progress");
    span.textContent = "⏳";
    label = "in progress";
  } else if (action.conclusion === "success") {
    span.classList.add("ok");
    span.textContent = "✓";
    label = "succeeded";
  } else if (action.conclusion === "failure" || action.conclusion === "cancelled" || action.conclusion === "timed_out") {
    span.classList.add("fail");
    span.textContent = "✗";
    label = action.conclusion;
  } else {
    span.textContent = "•";
    label = action.conclusion || action.status || "unknown";
  }
  span.setAttribute("aria-label", label);
  return span;
}

function renderUpdatedHeader() {
  const { generatedAt, lastChangedAt } = state.data || {};
  const action = state.actionRun;
  els.updated.textContent = "";

  if (!generatedAt && !action) return;

  const segments = [];

  if (action) {
    const link = document.createElement("a");
    link.href = action.htmlUrl || ACTIONS_WORKFLOW_URL;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "scrape-link";
    link.title = formatDate(action.timestamp);
    link.append("scraped ", scrapeStatusIcon(action), ` ${formatRelative(action.timestamp, { withAgo: false })}`);
    segments.push(link);
  } else if (generatedAt) {
    const link = document.createElement("a");
    link.href = ACTIONS_WORKFLOW_URL;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "scrape-link";
    link.title = formatDate(generatedAt);
    link.textContent = `scraped ${formatRelative(generatedAt, { withAgo: false })}`;
    segments.push(link);
  }

  if (lastChangedAt) {
    const link = document.createElement("a");
    link.href = DATA_COMMITS_URL;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "scrape-link";
    link.title = formatDate(lastChangedAt);
    link.textContent = `updated ${formatRelative(lastChangedAt)}`;
    if (lastChangedAt === generatedAt) {
      const badge = document.createElement("span");
      badge.className = "fresh-badge";
      badge.textContent = "new";
      link.append(" ", badge);
    }
    segments.push(link);
  }

  els.updated.append("Via public sources: ");
  segments.forEach((node, i) => {
    if (i > 0) els.updated.append(", ");
    els.updated.append(node);
  });
}

async function loadActionStatus() {
  try {
    const response = await fetch(ACTIONS_API_URL);
    if (!response.ok) return;
    const data = await response.json();
    const run = data.workflow_runs?.[0];
    if (!run) return;
    state.actionRun = {
      timestamp: run.updated_at || run.run_started_at,
      conclusion: run.conclusion,
      status: run.status,
      htmlUrl: run.html_url
    };
    renderUpdatedHeader();
  } catch {
    // Silent fallback to carriers.json's generatedAt
  }
}

loadData().catch((error) => {
  els.updated.textContent = "Could not load carrier data.";
  els.summary.textContent = error.message;
});

loadActionStatus();
