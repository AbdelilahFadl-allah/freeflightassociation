import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Point } from "./siteGeometry";

const finite = (p: Point) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

export function SiteMap({ points, polygon, onChange, unavailable, reference, readOnly, polygons, mapLabels }: {
  points: Point[]; polygon: boolean; onChange: (points: Point[]) => void; unavailable: string; reference?: Point;
  readOnly?: boolean; polygons?: Point[][];
  mapLabels: { layer: string; standard: string; terrain: string };
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const change = useRef(onChange);
  const current = useRef(points);
  const [tileError, setTileError] = useState(false);
  const [layer, setLayer] = useState<"standard" | "terrain">("standard");
  // Leaflet handlers outlive renders; refs give them the latest React state and callback.
  change.current = onChange;
  current.current = points;
  useEffect(() => {
    if (!element.current) return;
    const first = points.find(finite);
    const instance = L.map(element.current).setView([first?.latitude ?? reference?.latitude ?? 34, first?.longitude ?? reference?.longitude ?? -5], reference || readOnly ? 14 : 10);
    map.current = instance;
    if (!readOnly) instance.on("click", (event: L.LeafletMouseEvent) => {
      const point = { latitude: Number(event.latlng.lat.toFixed(7)), longitude: Number(event.latlng.lng.toFixed(7)) };
      if (!polygon) change.current([point]);
      else if (current.current.length < 7) change.current([...current.current, point]);
    });
    return () => { instance.remove(); map.current = null; };
  }, [polygon, readOnly]);
  useEffect(() => {
    if (!map.current) return;
    setTileError(false);
    const tiles = layer === "terrain"
      ? L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, maxNativeZoom: 17,
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      })
      : L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
    tiles.on("tileerror", () => setTileError(true));
    tiles.addTo(map.current);
    return () => { tiles.remove(); };
  }, [layer, polygon, readOnly]);
  useEffect(() => {
    if (!map.current) return;
    const group = L.layerGroup().addTo(map.current);
    if (reference) L.circleMarker([reference.latitude, reference.longitude], { radius: 7, color: "#b55b00" }).addTo(group);
    const toTuple = (p: Point): L.LatLngTuple => [p.latitude, p.longitude];
    const valid = points.filter(finite);
    if (polygon && valid.length >= 2) L.polygon(valid.map(toTuple)).addTo(group);
    const bounds: L.LatLngTuple[] = [];
    (polygons ?? []).forEach((ring) => {
      const shape = ring.filter(finite).map(toTuple);
      if (shape.length >= 2) { L.polygon(shape, { color: "#a32020" }).addTo(group); bounds.push(...shape); }
    });
    points.forEach((point, index) => {
      if (!finite(point)) return;
      bounds.push(toTuple(point));
      const marker = L.marker([point.latitude, point.longitude], {
        draggable: !readOnly, icon: L.divIcon({ className: "site-map-marker", html: String(index + 1), iconSize: [26, 26] }),
      }).addTo(group);
      if (readOnly) return;
      marker.on("dragend", () => {
        const position = marker.getLatLng();
        change.current(current.current.map((p, i) => i === index ?
          { latitude: Number(position.lat.toFixed(7)), longitude: Number(position.lng.toFixed(7)) } : p));
      });
    });
    if (readOnly && bounds.length > 1) map.current.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 17 });
    return () => { group.remove(); };
  }, [points, polygon, readOnly, polygons, reference?.latitude, reference?.longitude]);
  return <div className="site-map-wrapper">
    <label className="map-layer-control">{mapLabels.layer}{" "}
      <select data-map-layer value={layer} onChange={(event) => setLayer(event.target.value === "terrain" ? "terrain" : "standard")}>
        <option value="standard">{mapLabels.standard}</option>
        <option value="terrain">{mapLabels.terrain}</option>
      </select>
    </label>
    <div ref={element} className="site-map" aria-label={layer === "terrain" ? mapLabels.terrain : mapLabels.standard} />
    {tileError && <p role="alert" className="error">{unavailable}</p>}</div>;
}
