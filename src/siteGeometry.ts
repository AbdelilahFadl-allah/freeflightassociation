export type Point = { latitude: number; longitude: number };

// Reject crossing and touching non-adjacent edges, including collinear overlaps.
export function validPolygon(points: Point[]): boolean {
  if (points.length < 4 || points.length > 7 ||
      points.some((p) => !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) ||
        Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) ||
      new Set(points.map((p) => `${p.latitude},${p.longitude}`)).size !== points.length) return false;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.longitude - a.longitude) * (c.latitude - a.latitude) - (b.latitude - a.latitude) * (c.longitude - a.longitude);
  const on = (a: Point, b: Point, c: Point) =>
    Math.min(a.longitude, b.longitude) <= c.longitude && c.longitude <= Math.max(a.longitude, b.longitude) &&
    Math.min(a.latitude, b.latitude) <= c.latitude && c.latitude <= Math.max(a.latitude, b.latitude);
  const intersects = (a: Point, b: Point, c: Point, d: Point) => {
    const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
    return (x === 0 && on(a, b, c)) || (y === 0 && on(a, b, d)) ||
      (z === 0 && on(c, d, a)) || (w === 0 && on(c, d, b)) || ((x > 0) !== (y > 0) && (z > 0) !== (w > 0));
  };
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twiceArea += a.longitude * b.latitude - b.longitude * a.latitude;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return Math.abs(twiceArea) > 1e-12;
}
