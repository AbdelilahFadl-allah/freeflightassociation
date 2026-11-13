import { useEffect, useState } from "react";
import type { Language } from "./translations";
import { SiteMap } from "./SiteMap";
import { SignaturePad, type Signature } from "./SignaturePad";
import { validPolygon, type Point } from "./siteGeometry";
import { labels } from "./i18n/sites";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Details = { ownerAgreement: string; access: string; launchAltitude: string; launchOrientation: string;
  windLimits: string; hazards: string; restrictedAreas: string; minimumLevel: string; tandem: "unknown" | "yes" | "no";
  emergencyServices: string; phoneCoverage: string };
type Landing = { id: string; name: string; type: "primary" | "emergency"; polygon: Point[] | null; latitude?: number; longitude?: number };
type Site = { id: string; name: string; latitude: number; longitude: number; municipality: string;
  status: "open" | "closed" | "maintenance"; windDirections: string[]; details: Partial<Details>;
  landings: Landing[]; revision: number; validatedAt: string | null; validatedBy: string | null; signature: Signature | null };
type Draft = Omit<Site, "id" | "validatedAt" | "validatedBy" | "signature" | "details"> & { details: Details };
const emptyDetails: Details = { ownerAgreement: "", access: "", launchAltitude: "", launchOrientation: "", windLimits: "",
  hazards: "", restrictedAreas: "", minimumLevel: "", tandem: "unknown", emergencyServices: "", phoneCoverage: "" };
const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const blank = (): Draft => ({ name: "", latitude: NaN, longitude: NaN, municipality: "", status: "open", windDirections: [],
  landings: [], revision: 1, details: { ...emptyDetails } });
const fields = ["ownerAgreement", "access", "launchAltitude", "launchOrientation", "windLimits", "hazards",
  "restrictedAreas", "minimumLevel", "emergencyServices", "phoneCoverage"] as const;

export function SiteCardContent({ site, language }: { site: Site; language: Language }) {
  const t = labels[language];
  return <div className="site-card">
    <div><strong>{t.name}:</strong> <bdi>{site.name}</bdi></div>
    <div><strong>{t.status}:</strong> {t[site.status]}</div>
    <div><strong>{t.validationStatus}:</strong> {site.validatedAt ? t.validated : t.unvalidated}</div>
    <div><strong>{t.municipality}:</strong> <bdi>{site.municipality}</bdi></div>
    <div><strong>{t.takeoffPoint}:</strong> <bdi>{site.latitude}, {site.longitude}</bdi></div>
    <div><strong>{t.wind}:</strong> <bdi>{site.windDirections.join(", ")}</bdi></div>
    <div><strong>{t.landings}:</strong>
      {site.landings.length === 0 && <> {t.none}</>}
      {site.landings.map((item) => <div className="site-card-related" key={item.id}>
        <strong>{t.name}:</strong> <bdi>{item.name}</bdi> · <strong>{t.landingType}:</strong> {t[item.type]} ·{" "}
        <strong>{t.coordinates}:</strong>{" "}
        <bdi>{item.polygon ? item.polygon.map((p) => `${p.latitude}, ${p.longitude}`).join(" | ") : `${item.latitude}, ${item.longitude}`}</bdi>
      </div>)}
    </div>
    <details><summary>{t.siteDetails}</summary><div className="site-card-related">{fields.map((field) => <div key={field}><strong>{t[field]}:</strong> {site.details[field] ?? ""}</div>)}<div><strong>{t.tandem}:</strong> {t[site.details.tandem ?? "unknown"]}</div></div></details>
    {site.validatedAt && <div>
      <div><strong>{t.validatedBy}:</strong> {t.validatorUnavailable}</div>
      <div><strong>{t.validatedOn}:</strong> <bdi>{new Date(site.validatedAt).toLocaleString(language)}</bdi></div>
      {site.signature && <svg viewBox="0 0 600 200" className="signature-preview" role="img" aria-label={t.sign}>{site.signature.map((stroke, i) =>
        <polyline key={i} points={stroke.map((p) => `${p.x * 600},${p.y * 200}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />)}</svg>}
    </div>}
  </div>;
}

export function Sites({ api, language, specialAdmin, canEdit, canValidate, onChange }: {
  api: Api; language: Language; specialAdmin: boolean; canEdit: boolean; canValidate: boolean; onChange: () => void;
}) {
  const t = labels[language];
  const mapLabels = { layer: t.mapLayer, standard: t.mapStandard, terrain: t.mapTerrain };
  const [sites, setSites] = useState<Site[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [signing, setSigning] = useState<Site | null>(null);
  const [viewing, setViewing] = useState<Site | null>(null);
  const [signature, setSignature] = useState<Signature>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function refresh() { setSites(await api<Site[]>("/api/sites")); }
  useEffect(() => { let active = true; api<Site[]>("/api/sites").then((data) => { if (active) setSites(data); })
    .catch((e: unknown) => { console.error(e); if (active) setError(t.fail); }); return () => { active = false; }; }, [api]);
  function updateLanding(id: string, patch: Partial<Landing>) {
    setDraft((current) => current && { ...current, landings: current.landings.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!draft) return;
    // Legacy points remain readable, but no retained landing may be saved without a real polygon.
    if (draft.landings.some((l) => !l.polygon || !validPolygon(l.polygon))) { setError(t.invalidPolygon); return; }
    setBusy(true);
    let saved = false;
    try {
      const { revision, landings, ...site } = draft;
      const body = { ...site, landings: landings.map(({ id, name, type, polygon }) => ({ id, name, type, polygon })),
        ...(editing ? { expectedRevision: revision } : {}) };
      await api(editing ? `/api/sites/${editing}` : "/api/sites", { method: editing ? "PUT" : "POST", body: JSON.stringify(body) });
      saved = true;
      setDraft(null); setEditing(null); onChange(); await refresh(); setError(null);
    } catch (e) { console.error(e); setError(saved ? t.refreshFailed : t.fail); } finally { setBusy(false); }
  }
  async function validate(event: React.FormEvent) {
    event.preventDefault(); if (!signing) return;
    if (!signing.landings.length) { setError(t.noLanding); return; }
    setBusy(true);
    let saved = false;
    try {
      await api(`/api/sites/${signing.id}/validate`, { method: "POST",
        body: JSON.stringify({ expectedRevision: signing.revision, validated: confirmed, signature }) });
      saved = true;
      setSigning(null); setSignature([]); setConfirmed(false); onChange(); await refresh(); setError(null);
    } catch (e) { console.error(e); setError(saved ? t.refreshFailed : t.fail); } finally { setBusy(false); }
  }
  async function archive(id: string) {
    if (!window.confirm(t.confirm)) return;
    setBusy(true);
    let saved = false;
    try { await api(`/api/sites/${id}/archive`, { method: "POST" }); saved = true; onChange(); await refresh(); setError(null); }
    catch (e) { console.error(e); setError(saved ? t.refreshFailed : t.fail); } finally { setBusy(false); }
  }
  function coord(label: string, value: number, max: number, change: (value: number) => void) {
    return <label>{label}<input required type="number" step="any" min={-max} max={max} dir="ltr"
      value={Number.isFinite(value) ? value : ""} onChange={(e) => change(e.target.value === "" ? NaN : Number(e.target.value))} /></label>;
  }
  return <section><div className="section-title"><h2>{t.title}</h2>{canEdit && <button onClick={() => { setEditing(null); setDraft(blank()); }}>{t.create}</button>}</div>
    <p>{t.safety}</p>{error && <p className="error" role="alert">{error}</p>}
    {draft && <form className="form" onSubmit={(event) => void submit(event)}>
      {editing && <p>{t.saveWarning}</p>}
      <label>{t.name}<input required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <p>{t.mapHelp}</p><SiteMap mapLabels={mapLabels} points={Number.isFinite(draft.latitude) && Number.isFinite(draft.longitude) ? [{ latitude: draft.latitude, longitude: draft.longitude }] : []}
        polygon={false} unavailable={t.tileError} onChange={([point]) => setDraft((d) => d && ({ ...d, ...point }))} />
      {coord(t.latitude, draft.latitude, 90, (value) => setDraft({ ...draft, latitude: value }))}
      {coord(t.longitude, draft.longitude, 180, (value) => setDraft({ ...draft, longitude: value }))}
      <label>{t.municipality}<input maxLength={200} value={draft.municipality} onChange={(e) => setDraft({ ...draft, municipality: e.target.value })} /></label>
      <label>{t.status}<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}>
        {(["open", "closed", "maintenance"] as const).map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></label>
      {fields.map((field) => <label key={field}>{t[field]}<textarea maxLength={field === "launchAltitude" || field === "launchOrientation" ? 200 : field === "minimumLevel" ? 500 : 2000}
        value={draft.details[field]} onChange={(e) => setDraft({ ...draft, details: { ...draft.details, [field]: e.target.value } })} /></label>)}
      <label>{t.tandem}<select value={draft.details.tandem} onChange={(e) => setDraft({ ...draft, details: { ...draft.details, tandem: e.target.value as Details["tandem"] } })}>
        {(["unknown", "yes", "no"] as const).map((value) => <option key={value} value={value}>{t[value]}</option>)}</select></label>
      <fieldset><legend>{t.wind}</legend>{compass.map((direction) => <label className="checkbox" key={direction}>
        <input type="checkbox" checked={draft.windDirections.includes(direction)} onChange={(e) => setDraft({ ...draft,
          windDirections: e.target.checked ? [...draft.windDirections, direction] : draft.windDirections.filter((d) => d !== direction) })} />{direction}</label>)}</fieldset>
      <fieldset><legend>{t.landings}</legend>{draft.landings.map((item) => <div key={item.id} className="site-landing">
        <label>{t.name}<input required maxLength={200} value={item.name} onChange={(e) => updateLanding(item.id, { name: e.target.value })} /></label>
        <label>{t.landings}<select value={item.type} onChange={(e) => updateLanding(item.id, { type: e.target.value as Landing["type"] })}>
          <option value="primary">{t.primary}</option><option value="emergency">{t.emergency}</option></select></label>
        {!item.polygon && <p>{t.legacy} <bdi>{item.latitude}, {item.longitude}</bdi></p>}
        <p>{t.polygonHelp}</p>
        <SiteMap mapLabels={mapLabels} points={item.polygon ?? []} reference={!item.polygon && item.latitude !== undefined && item.longitude !== undefined ?
          { latitude: item.latitude, longitude: item.longitude } : undefined}
          polygon unavailable={t.tileError} onChange={(polygon) => updateLanding(item.id, { polygon })} />
        {(item.polygon ?? []).map((point, index, points) => <div className="inline-fields" key={index}>
          <strong>{index + 1}</strong>
          {coord(t.latitude, point.latitude, 90, (value) => updateLanding(item.id, { polygon: points.map((p, i) => i === index ? { ...p, latitude: value } : p) }))}
          {coord(t.longitude, point.longitude, 180, (value) => updateLanding(item.id, { polygon: points.map((p, i) => i === index ? { ...p, longitude: value } : p) }))}
          <button type="button" disabled={index === 0} onClick={() => { const p = [...points]; [p[index - 1], p[index]] = [p[index], p[index - 1]]; updateLanding(item.id, { polygon: p }); }}>{t.up}</button>
          <button type="button" disabled={index === points.length - 1} onClick={() => { const p = [...points]; [p[index + 1], p[index]] = [p[index], p[index + 1]]; updateLanding(item.id, { polygon: p }); }}>{t.down}</button>
          <button type="button" onClick={() => updateLanding(item.id, { polygon: points.filter((_, i) => i !== index) })}>{t.remove}</button>
        </div>)}
        <button type="button" disabled={(item.polygon?.length ?? 0) >= 7} onClick={() => updateLanding(item.id, { polygon: [...(item.polygon ?? []), { latitude: draft.latitude, longitude: draft.longitude }] })}>{t.addPoint}</button>
        <button type="button" onClick={() => setDraft({ ...draft, landings: draft.landings.filter((x) => x.id !== item.id) })}>{t.remove}</button>
      </div>)}
      <button type="button" onClick={() => setDraft({ ...draft, landings: [...draft.landings, { id: crypto.randomUUID(), name: "", type: "primary", polygon: [] }] })}>{t.add}</button></fieldset>
      <div><button disabled={busy}>{t.save}</button><button type="button" onClick={() => setDraft(null)}>{t.cancel}</button></div>
    </form>}
    {viewing && <div className="site-view">
      <h3>{t.siteDetails}</h3><p>{t.readOnlyNote}</p>
      <div><strong>{t.name}:</strong> <bdi>{viewing.name}</bdi></div>
      <div><strong>{t.municipality}:</strong> <bdi>{viewing.municipality}</bdi></div>
      <div><strong>{t.status}:</strong> {t[viewing.status]}</div>
      <div><strong>{t.validationStatus}:</strong> {viewing.validatedAt ? t.validated : t.unvalidated}</div>
      <SiteMap mapLabels={mapLabels} readOnly polygon={false} points={[{ latitude: viewing.latitude, longitude: viewing.longitude }]}
        polygons={viewing.landings.flatMap((l) => l.polygon && l.polygon.length ? [l.polygon] : [])}
        reference={viewing.landings.some((l) => !l.polygon && l.latitude !== undefined && l.longitude !== undefined) ?
          viewing.landings.filter((l) => !l.polygon).map((l) => ({ latitude: l.latitude!, longitude: l.longitude! }))[0] : undefined}
        unavailable={t.tileError} onChange={() => undefined} />
      <div><strong>{t.takeoffPoint}:</strong> <bdi>{viewing.latitude}, {viewing.longitude}</bdi></div>
      <div><strong>{t.landings}:</strong> {viewing.landings.length === 0 && t.none}
        {viewing.landings.map((item) => <div className="record-related" key={item.id}>
          <strong>{t.name}:</strong> <bdi>{item.name}</bdi> · <strong>{t.landingType}:</strong> {t[item.type]} ·{" "}
          <strong>{t.coordinates}:</strong> <bdi>{item.polygon ? item.polygon.map((p) => `${p.latitude}, ${p.longitude}`).join(" | ") : `${item.latitude}, ${item.longitude}`}</bdi>
        </div>)}
      </div>
      {fields.map((field) => <div key={field}><strong>{t[field]}:</strong> {viewing.details[field] ?? ""}</div>)}
      <div>{t.tandem}: {t[viewing.details.tandem ?? "unknown"]}</div>
      <div>{t.wind}: {viewing.windDirections.join(", ")}</div>
      {viewing.validatedAt && <>
        <div><strong>{t.validatedBy}:</strong> {t.validatorUnavailable}</div>
        <div><strong>{t.validatedOn}:</strong> <bdi>{new Date(viewing.validatedAt).toLocaleString(language)}</bdi></div>
      </>}
      <div><button type="button" onClick={() => setViewing(null)}>{t.close}</button></div>
    </div>}
    {signing && <form className="form" onSubmit={(event) => void validate(event)}>
      <h3>{signing.name} — {t.validate}</h3><p>{t.validationInfo}</p>
      <SignaturePad value={signature} onChange={setSignature} label={t.sign} clear={t.clear} />
      <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required />{t.confirmValidated}</label>
      {signing.landings.length === 0 && <p role="alert">{t.noLanding}</p>}
      {signing.landings.some((l) => !l.polygon || !validPolygon(l.polygon)) && <p role="alert">{t.invalidPolygon}</p>}
      <button disabled={busy || !signing.landings.length || signing.landings.some((l) => !l.polygon || !validPolygon(l.polygon))}>{t.validate}</button>
      <button type="button" onClick={() => { setSigning(null); setSignature([]); setConfirmed(false); }}>{t.cancel}</button>
    </form>}
    <ul className="member-list">{sites.map((site) => <li key={site.id}><SiteCardContent site={site} language={language} />
      <div><button type="button" onClick={() => setViewing(site)}>{t.view}</button>
        {canEdit && <button onClick={() => { setEditing(site.id); setDraft({ name: site.name, municipality: site.municipality, status: site.status,
        windDirections: site.windDirections, latitude: site.latitude, longitude: site.longitude, revision: site.revision,
        details: { ...emptyDetails, ...site.details }, landings: site.landings.map((item) => ({ ...item })) }); }}>{t.edit}</button>}
        {canValidate && <button onClick={() => { setSigning(site); setSignature([]); setConfirmed(false); }}>{t.validate}</button>}
        {specialAdmin && <button disabled={busy} onClick={() => void archive(site.id)}>{t.archive}</button>}</div>
    </li>)}</ul>
  </section>;
}
