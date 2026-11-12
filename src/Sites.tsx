import { useEffect, useState } from "react";
import type { Language } from "./translations";
import { SiteMap } from "./SiteMap";
import { SignaturePad, type Signature } from "./SignaturePad";
import { validPolygon, type Point } from "./siteGeometry";

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
const labels = {
  en: { title: "Flight sites", name: "Name", latitude: "Latitude", longitude: "Longitude", municipality: "Municipality",
    status: "Status", open: "Open", closed: "Closed", maintenance: "Under maintenance", wind: "Flyable wind directions",
    landings: "Landing zones", add: "Add landing", remove: "Remove", create: "Add site", save: "Save", cancel: "Cancel",
    edit: "Edit", archive: "Archive", confirm: "Archive this site?", fail: "Unable to confirm the operation. Check records before retrying.", refreshFailed: "Saved, but the display could not refresh. Reload; do not repeat the operation.",
    safety: "Validation and site status do not guarantee safe flying conditions or permission to fly.",
    ownerAgreement: "Owner / manager and agreement", access: "Access: track, duration and vehicle", launchAltitude: "Takeoff altitude",
    launchOrientation: "Takeoff orientation", windLimits: "Favorable winds and limits", hazards: "Hazards", restrictedAreas: "Restricted overflight areas",
    minimumLevel: "Minimum pilot level", tandem: "Tandem site", unknown: "Unknown", yes: "Yes", no: "No",
    emergencyServices: "Nearest emergency services", phoneCoverage: "Telephone coverage", primary: "Primary", emergency: "Emergency",
    mapHelp: "Click the map to select the takeoff point. You may drag the marker or enter coordinates.",
    polygonHelp: "Click the map to add 4–7 vertices, or enter them below. Drag markers to adjust.",
    tileError: "Map tiles could not be loaded. Check your connection or enter coordinates manually.",
    legacy: "Existing point: draw a polygon before saving.", invalidPolygon: "Every landing needs a valid, non-crossing polygon of 4–7 distinct points.",
    addPoint: "Add point", up: "Move up", down: "Move down", validated: "Validated", unvalidated: "Not validated",
    sign: "Security manager signature", clear: "Clear signature", validate: "Validate", validationInfo: "Validation requires a signature, confirmation and at least one landing zone.",
    confirmValidated: "I confirm this site is validated", noLanding: "Add at least one landing zone before validation.",
    saveWarning: "Changing site details clears the existing validation and signature." },
  fr: { title: "Sites de vol", name: "Nom", latitude: "Latitude", longitude: "Longitude", municipality: "Commune",
    status: "Statut", open: "Ouvert", closed: "Fermé", maintenance: "En maintenance", wind: "Directions de vent praticables",
    landings: "Zones d'atterrissage", add: "Ajouter un atterrissage", remove: "Retirer", create: "Ajouter un site", save: "Enregistrer", cancel: "Annuler",
    edit: "Modifier", archive: "Archiver", confirm: "Archiver ce site ?", fail: "Opération non confirmée. Vérifiez les données avant de réessayer.", refreshFailed: "Enregistré, mais l'affichage n'a pas pu être actualisé. Rechargez sans répéter l'opération.",
    safety: "La validation et le statut ne garantissent ni la sécurité ni l'autorisation de vol.",
    ownerAgreement: "Propriétaire / gestionnaire et convention", access: "Accès : piste, durée et véhicule", launchAltitude: "Altitude du décollage",
    launchOrientation: "Orientation du décollage", windLimits: "Vents favorables et limites", hazards: "Dangers", restrictedAreas: "Zones interdites de survol",
    minimumLevel: "Niveau minimal requis", tandem: "Site biplace", unknown: "Inconnu", yes: "Oui", no: "Non",
    emergencyServices: "Secours le plus proche", phoneCoverage: "Couverture téléphonique", primary: "Principal", emergency: "Secours",
    mapHelp: "Cliquez sur la carte pour choisir le décollage. Déplacez le marqueur ou saisissez les coordonnées.",
    polygonHelp: "Cliquez sur la carte pour ajouter 4 à 7 points ou saisissez-les ci-dessous. Déplacez les marqueurs pour ajuster.",
    tileError: "La carte n'a pas pu être chargée. Vérifiez la connexion ou saisissez les coordonnées.",
    legacy: "Ancien point : dessinez un polygone avant d'enregistrer.", invalidPolygon: "Chaque zone nécessite un polygone valide, sans croisement, de 4 à 7 points distincts.",
    addPoint: "Ajouter un point", up: "Monter", down: "Descendre", validated: "Validé", unvalidated: "Non validé",
    sign: "Signature du responsable sécurité", clear: "Effacer la signature", validate: "Valider", validationInfo: "La validation exige une signature, une confirmation et au moins une zone d'atterrissage.",
    confirmValidated: "Je confirme la validation de ce site", noLanding: "Ajoutez au moins une zone d'atterrissage avant validation.",
    saveWarning: "Toute modification du site efface la validation et la signature." },
  ar: { title: "مواقع الطيران", name: "الاسم", latitude: "خط العرض", longitude: "خط الطول", municipality: "الجماعة",
    status: "الحالة", open: "مفتوح", closed: "مغلق", maintenance: "قيد الصيانة", wind: "اتجاهات الرياح المناسبة",
    landings: "مناطق الهبوط", add: "إضافة منطقة هبوط", remove: "إزالة", create: "إضافة موقع", save: "حفظ", cancel: "إلغاء",
    edit: "تعديل", archive: "أرشفة", confirm: "أرشفة هذا الموقع؟", fail: "تعذر تأكيد العملية. تحقق من السجلات قبل إعادة المحاولة.", refreshFailed: "تم الحفظ لكن تعذر تحديث العرض. أعد التحميل دون تكرار العملية.",
    safety: "التحقق وحالة الموقع لا يضمنان سلامة ظروف الطيران أو الإذن بالطيران.",
    ownerAgreement: "المالك أو المسير والاتفاقية", access: "الولوج: المسلك والمدة والمركبة", launchAltitude: "ارتفاع الإقلاع",
    launchOrientation: "اتجاه الإقلاع", windLimits: "الرياح الملائمة وحدودها", hazards: "الأخطار", restrictedAreas: "المناطق الممنوع التحليق فوقها",
    minimumLevel: "المستوى الأدنى للطيار", tandem: "موقع للطيران الثنائي", unknown: "غير معروف", yes: "نعم", no: "لا",
    emergencyServices: "أقرب إسعاف", phoneCoverage: "تغطية الهاتف", primary: "رئيسية", emergency: "احتياطية",
    mapHelp: "انقر على الخريطة لاختيار الإقلاع. اسحب العلامة أو أدخل الإحداثيات.",
    polygonHelp: "انقر على الخريطة لإضافة ٤ إلى ٧ نقاط أو أدخلها أدناه. اسحب العلامات للتعديل.",
    tileError: "تعذر تحميل الخريطة. تحقق من الاتصال أو أدخل الإحداثيات يدوياً.",
    legacy: "نقطة سابقة: ارسم مضلعاً قبل الحفظ.", invalidPolygon: "تحتاج كل منطقة إلى مضلع صالح غير متقاطع من ٤ إلى ٧ نقاط مختلفة.",
    addPoint: "إضافة نقطة", up: "تحريك لأعلى", down: "تحريك لأسفل", validated: "تم التحقق", unvalidated: "غير متحقق",
    sign: "توقيع مسؤول السلامة", clear: "مسح التوقيع", validate: "التحقق", validationInfo: "يتطلب التحقق توقيعاً وتأكيداً ومنطقة هبوط واحدة على الأقل.",
    confirmValidated: "أؤكد التحقق من هذا الموقع", noLanding: "أضف منطقة هبوط واحدة على الأقل قبل التحقق.",
    saveWarning: "تعديل بيانات الموقع يلغي التحقق والتوقيع." },
} as const;
const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const blank = (): Draft => ({ name: "", latitude: NaN, longitude: NaN, municipality: "", status: "open", windDirections: [],
  landings: [], revision: 1, details: { ...emptyDetails } });
const fields = ["ownerAgreement", "access", "launchAltitude", "launchOrientation", "windLimits", "hazards",
  "restrictedAreas", "minimumLevel", "emergencyServices", "phoneCoverage"] as const;

export function Sites({ api, language, specialAdmin, canEdit, canValidate, onChange }: {
  api: Api; language: Language; specialAdmin: boolean; canEdit: boolean; canValidate: boolean; onChange: () => void;
}) {
  const t = labels[language];
  const [sites, setSites] = useState<Site[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [signing, setSigning] = useState<Site | null>(null);
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
      <p>{t.mapHelp}</p><SiteMap points={Number.isFinite(draft.latitude) && Number.isFinite(draft.longitude) ? [{ latitude: draft.latitude, longitude: draft.longitude }] : []}
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
        <p>{t.polygonHelp}</p>{(item.polygon ?? []).every((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) &&
          <SiteMap points={item.polygon ?? []} reference={!item.polygon && item.latitude !== undefined && item.longitude !== undefined ?
            { latitude: item.latitude, longitude: item.longitude } : undefined}
            polygon unavailable={t.tileError} onChange={(polygon) => updateLanding(item.id, { polygon })} />}
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
    {signing && <form className="form" onSubmit={(event) => void validate(event)}>
      <h3>{signing.name} — {t.validate}</h3><p>{t.validationInfo}</p>
      <SignaturePad value={signature} onChange={setSignature} label={t.sign} clear={t.clear} />
      <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required />{t.confirmValidated}</label>
      {signing.landings.length === 0 && <p role="alert">{t.noLanding}</p>}
      {signing.landings.some((l) => !l.polygon || !validPolygon(l.polygon)) && <p role="alert">{t.invalidPolygon}</p>}
      <button disabled={busy || !signing.landings.length || signing.landings.some((l) => !l.polygon || !validPolygon(l.polygon))}>{t.validate}</button>
      <button type="button" onClick={() => { setSigning(null); setSignature([]); setConfirmed(false); }}>{t.cancel}</button>
    </form>}
    <ul className="member-list">{sites.map((site) => <li key={site.id}><div><strong>{site.name}</strong> — {t[site.status]} — {site.validatedAt ? t.validated : t.unvalidated}
      <div dir="auto">{site.municipality} · <bdi>{site.latitude}, {site.longitude}</bdi> · {site.windDirections.join(", ")}</div>
      {site.landings.map((item) => <div key={item.id}>{item.name} · {t[item.type]}: {item.polygon ? item.polygon.map((p) => `${p.latitude}, ${p.longitude}`).join(" | ") : `${t.legacy} ${item.latitude}, ${item.longitude}`}</div>)}
      <details><summary>{t.title}</summary>{fields.map((field) => <div key={field}><strong>{t[field]}:</strong> {site.details[field] ?? ""}</div>)}<div>{t.tandem}: {t[site.details.tandem ?? "unknown"]}</div></details>
      {site.validatedAt && <div><bdi>{site.validatedBy}</bdi> · {new Date(site.validatedAt).toLocaleString(language)}
        {site.signature && <svg viewBox="0 0 600 200" className="signature-preview" role="img" aria-label={t.sign}>{site.signature.map((stroke, i) =>
          <polyline key={i} points={stroke.map((p) => `${p.x * 600},${p.y * 200}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />)}</svg>}</div>}</div>
      <div>{canEdit && <button onClick={() => { setEditing(site.id); setDraft({ name: site.name, municipality: site.municipality, status: site.status,
        windDirections: site.windDirections, latitude: site.latitude, longitude: site.longitude, revision: site.revision,
        details: { ...emptyDetails, ...site.details }, landings: site.landings.map((item) => ({ ...item })) }); }}>{t.edit}</button>}
        {canValidate && <button onClick={() => { setSigning(site); setSignature([]); setConfirmed(false); }}>{t.validate}</button>}
        {specialAdmin && <button disabled={busy} onClick={() => void archive(site.id)}>{t.archive}</button>}</div>
    </li>)}</ul>
  </section>;
}
