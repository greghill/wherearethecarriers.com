#!/usr/bin/env python3
# Generates the Open Graph share card (docs/og-image.png) as an orthographic globe
# built from the real Natural Earth coastlines in scripts/land-polygons.json, with a
# representative set of carrier markers at true lat/lon. Run from the repo root:
#
#   python3 scripts/gen-og-image.py
#   inkscape scripts/og-image.svg --export-type=png \
#     --export-filename=docs/og-image.png -w 1200 -h 630
#
# The card is a static illustration; it is not regenerated from live positions.
import json, math

W, H = 1200, 630
# Globe placement: large, sits to the right, vertically centered.
CX, CY, R = 860, 300, 330
LON0, LAT0 = 88.0, -3.0  # center: Indian Ocean, showing Mideast / India / SE Asia / Japan

d = json.load(open('scripts/land-polygons.json'))
polys = d['polygons']

l0 = math.radians(LON0)
p0 = math.radians(LAT0)

def project(lon, lat):
    lam = math.radians(lon); phi = math.radians(lat)
    cosc = math.sin(p0)*math.sin(phi) + math.cos(p0)*math.cos(phi)*math.cos(lam-l0)
    if cosc < 0:
        return None  # far side of globe
    x = CX + R*math.cos(phi)*math.sin(lam-l0)
    y = CY - R*(math.cos(p0)*math.sin(phi) - math.sin(p0)*math.cos(phi)*math.cos(lam-l0))
    return (x, y)

def project_clamp(lon, lat):
    # Like project(), but instead of dropping far-side points, clamp them onto the
    # globe's rim at the same azimuth. This lets filled land be trimmed along the
    # curved limb instead of cutting a straight chord across the disc.
    lam = math.radians(lon); phi = math.radians(lat)
    dl = lam - l0
    cosc = math.sin(p0)*math.sin(phi) + math.cos(p0)*math.cos(phi)*math.cos(dl)
    xe = math.cos(phi)*math.sin(dl)
    ye = math.cos(p0)*math.sin(phi) - math.sin(p0)*math.cos(phi)*math.cos(dl)
    if cosc >= 0:
        return (CX + R*xe, CY - R*ye, True)
    norm = math.hypot(xe, ye) or 1e-9
    return (CX + R*xe/norm, CY - R*ye/norm, False)

# Build filled land rings; skip rings entirely on the far side.
# Keep rings grouped by polygon so inner rings (lakes) can punch holes via
# fill-rule:evenodd instead of being painted as overlapping solid patches.
land_polys = []
for poly in polys:
    rings = []
    any_front = False
    for ring in poly:
        pts = []
        for lon, lat in ring:
            x, y, front = project_clamp(lon, lat)
            if front:
                any_front = True
            pts.append((x, y))
        if len(pts) > 2:
            rings.append(pts)
    if any_front and rings:
        land_polys.append(rings)

def path_d(seg):
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in seg)

# Graticule (meridians + parallels) for a subtle globe feel.
grat = []
for lon in range(-180, 181, 30):
    seg = []
    for lat in range(-90, 91, 3):
        pt = project(lon, lat)
        if pt is None:
            if len(seg) > 1: grat.append(seg)
            seg = []
        else: seg.append(pt)
    if len(seg) > 1: grat.append(seg)
for lat in range(-60, 61, 30):
    seg = []
    for lon in range(-180, 181, 3):
        pt = project(lon, lat)
        if pt is None:
            if len(seg) > 1: grat.append(seg)
            seg = []
        else: seg.append(pt)
    if len(seg) > 1: grat.append(seg)

# Carrier markers at true lat/lon (only those on the visible hemisphere render).
markers = [
    ("68", -75, 18, "#d05f3f"),  # Caribbean
    ("75", 29, 34, "#d05f3f"),   # E. Mediterranean
    ("71", -40, 36, "#d05f3f"),  # W. Atlantic
    ("73", 12, 8, "#2f8b70"),    # placed over Gulf of Guinea for spacing (decorative)
]

svg = []
svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
svg.append('<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
           '<stop offset="0" stop-color="#0b1f25"/><stop offset="1" stop-color="#14333c"/></linearGradient>'
           f'<clipPath id="disc"><circle cx="{CX}" cy="{CY}" r="{R}"/></clipPath></defs>')
svg.append(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
# sphere disc (slightly lighter than bg)
svg.append(f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="#ffffff" fill-opacity="0.035"/>')
# graticule
svg.append('<g stroke="#ffffff" stroke-opacity="0.05" stroke-width="1" fill="none">')
for seg in grat: svg.append(f'<path d="{path_d(seg)}"/>')
svg.append('</g>')
# land: one opaque path per landmass (evenodd punches lake holes), so it stays
# strictly two-tone — no transparency stacking where rings overlap.
svg.append('<g clip-path="url(#disc)" fill="#2b4c53" fill-rule="evenodd">')
for rings in land_polys:
    d = "".join(path_d(r) + "Z" for r in rings)
    svg.append(f'<path d="{d}"/>')
svg.append('</g>')
# limb outline
svg.append(f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>')

# accent rule + text (left), shifted down so the upper area is free for markers
svg.append('<rect x="86" y="252" width="72" height="7" rx="3" fill="#d05f3f"/>')
svg.append('<text x="82" y="372" font-family="DejaVu Sans, Arial, sans-serif" font-size="74" fill="#f4f7f6" font-weight="700">Where Are the Carriers?</text>')
svg.append('<text x="86" y="460" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" fill="#c7d4d6">Compilation of the latest public sources for</text>')
svg.append('<text x="86" y="508" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" fill="#c7d4d6">U.S. Navy aircraft carrier locations.</text>')
svg.append('<text x="86" y="592" font-family="DejaVu Sans, Arial, sans-serif" font-size="31" fill="#e0865f" font-weight="600">wherearethecarriers.com</text>')

# carrier markers at their true positions (matches current live data)
# CVN-72 & CVN-77 in the Arabian Sea (deployed/orange), CVN-73 at Yokosuka (port/teal).
geo_markers = [
    ("72", 63.0, 18.0, "#d05f3f"),       # Arabian Sea
    ("77", 54.0, 11.0, "#d05f3f"),       # Arabian Sea, below-left of 72 (away from India)
    ("73", 139.67, 35.28, "#2f8b70"),    # Yokosuka, Japan
]
svg.append('<g font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">')
for label, lon, lat, color in geo_markers:
    pt = project(lon, lat)
    if pt is None:
        continue
    x, y = pt
    r = 30
    svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{color}" stroke="#ffffff" stroke-opacity="0.9" stroke-width="3"/>')
    svg.append(f'<text x="{x:.1f}" y="{y+10:.1f}" font-size="26">{label}</text>')
svg.append('</g>')

svg.append('</svg>')
open('scripts/og-image.svg', 'w').write("\n".join(svg))
print("wrote scripts/og-image.svg with", len(land_polys), "land polygons")
