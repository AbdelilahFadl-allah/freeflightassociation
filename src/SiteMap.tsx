import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Point } from "./siteGeometry";

export function SiteMap({ points, polygon, onChange, unavailable, reference }: {
  points: Point[]; polygon: boolean; onChange: (points: Point[]) => void; unavailable: string; reference?: Point;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const change = useRef(onChange);
  const current = useRef(points);
  const [tileError, setTileError] = useState(false);
  // Leaflet handlers outlive renders; refs give them the latest React state and callback.
  change.current = onChange;
  current.current = points;
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current).setView([points[0]?.latitude ?? reference?.latitude ?? 34, points[0]?.longitude ?? reference?.longitude ?? -5], reference ? 14 : 10);
    map.current = instance;
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    tiles.on("tileerror", () => setTileError(true));
    instance.on("click", (event: L.LeafletMouseEvent) => {
      const point = { latitude: Number(event.latlng.lat.toFixed(7)), longitude: Number(event.latlng.lng.toFixed(7)) };
      if (!polygon) change.current([point]);
      else if (current.current.length < 7) change.current([...current.current, point]);
    });
    return () => { instance.remove(); map.current = null; };
  }, [polygon]);
  useEffect(() => {
    if (!map.current) return;
    const group = L.layerGroup().addTo(map.current);
    if (reference) L.circleMarker([reference.latitude, reference.longitude], { radius: 7, color: "#b55b00" }).addTo(group);
    if (polygon && points.length >= 2) L.polygon(points.map((p): L.LatLngTuple => [p.latitude, p.longitude])).addTo(group);
    points.forEach((point, index) => {
      const marker = L.marker([point.latitude, point.longitude], {
        draggable: true, icon: L.divIcon({ className: "site-map-marker", html: String(index + 1), iconSize: [26, 26] }),
      }).addTo(group);
      marker.on("dragend", () => {
        const position = marker.getLatLng();
        change.current(current.current.map((p, i) => i === index ?
          { latitude: Number(position.lat.toFixed(7)), longitude: Number(position.lng.toFixed(7)) } : p));
      });
    });
    return () => { group.remove(); };
  }, [points, polygon, reference?.latitude, reference?.longitude]);
  return <div className="site-map-wrapper"><div ref={element} className="site-map" aria-label="OpenStreetMap" />
    {tileError && <p role="alert" className="error">{unavailable}</p>}</div>;
}
