const DATA_URL = "./data/carriers.json";

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

const map = L.map("map", {
  zoomControl: false,
  worldCopyJump: true
}).setView([21, 15], 2);

L.control.zoom({ position: "bottomleft" }).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  maxZoom: 9,
  minZoom: 1
}).addTo(map);

let state = {
  data: null,
  filter: "all",
  selectedHull: null,
  markers: new Map()
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
  fleet: document.querySelector("#fleet-list"),
  filters: [...document.querySelectorAll(".chip")]
};

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

function offsetPosition(carrier, visibleCarriers) {
  if (!carrier.position) return null;
  const key = `${carrier.position.lat.toFixed(3)},${carrier.position.lon.toFixed(3)}`;
  const colocated = visibleCarriers.filter((item) => {
    if (!item.position) return false;
    return `${item.position.lat.toFixed(3)},${item.position.lon.toFixed(3)}` === key;
  });
  if (colocated.length === 1) return [carrier.position.lat, carrier.position.lon];

  const index = colocated.findIndex((item) => item.hull === carrier.hull);
  const angle = (Math.PI * 2 * index) / colocated.length - Math.PI / 2;
  const radius = Math.min(1.2, 0.45 + colocated.length * 0.12);
  return [
    carrier.position.lat + Math.sin(angle) * radius,
    carrier.position.lon + Math.cos(angle) * radius
  ];
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

function renderMarkers() {
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();

  const visibleCarriers = state.data.carriers.filter(isVisible);
  visibleCarriers.forEach((carrier) => {
    if (!carrier.position) return;
    const marker = L.marker(offsetPosition(carrier, visibleCarriers), {
      icon: createIcon(carrier),
      title: `${carrier.name} ${carrier.hull}`
    }).addTo(map);
    marker.on("click", () => selectCarrier(carrier.hull, true));
    state.markers.set(carrier.hull, marker);
  });
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
    maxZoom: window.innerWidth < 640 ? 1 : 2,
    paddingTopLeft: window.innerWidth < 640 ? [12, 138] : [20, 86],
    paddingBottomRight: [20, 24]
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
    item.append(link, meta);
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
  els.seen.textContent = formatDate(carrier.lastSeen);
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

async function loadData() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load ${DATA_URL}: ${response.status}`);
  }
  state.data = await response.json();
  els.updated.textContent = `Updated ${formatDate(state.data.generatedAt)} from public sources`;
  map.invalidateSize();
  state.selectedHull = state.data.carriers[0]?.hull || null;
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

loadData().catch((error) => {
  els.updated.textContent = "Could not load carrier data.";
  els.summary.textContent = error.message;
});
