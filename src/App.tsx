import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Auth, authClient } from "./Auth";
import { messages, type Language } from "./translations";
import { Operations } from "./Operations";
import { Finance } from "./Finance";
import { WhatsApp } from "./WhatsApp";
import { Reports } from "./Reports";
import { Sites } from "./Sites";

type Details = { birthDate: string | null; birthPlace: string; nationality: string; profession: string; address: string;
  emergencyContact: string; qualification: string; licenceNumber: string; licenceExpiresOn: string | null;
  insuranceProvider: string; insuranceReference: string };
type Member = { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; active: boolean; details: Details };
type Draft = Omit<Member, "id">;
type Profile = { objectId: string; role: "admin" | "special_admin"; sitePermissions: { siteTeam: boolean; securityManager: boolean } };
type Administrator = { objectId: string; role: "admin" | "special_admin"; active: boolean; siteTeam: boolean; securityManager: boolean };
type Audit = { id: string; actorId: string; action: string; entityType: string; entityId: string; occurredAt: string; details: unknown };
const emptyDetails: Details = { birthDate: null, birthPlace: "", nationality: "", profession: "", address: "",
  emergencyContact: "", qualification: "", licenceNumber: "", licenceExpiresOn: null, insuranceProvider: "", insuranceReference: "" };
const empty: Draft = { firstName: "", lastName: "", phone: null, email: null, active: true, details: emptyDetails };
export function App() {
  const [language, setLanguage] = useState<Language>("fr");
  const t = messages[language];
  const [account, setAccount] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [administratorId, setAdministratorId] = useState("");
  const [audit, setAudit] = useState<Audit[]>([]);
  const [page, setPage] = useState<"home" | "members" | "sites" | "operations" | "finance" | "notifications" | "reports" | "administrators">("home");
  const dirtyForms = useRef(new Set<HTMLFormElement>());
  // Associate a successful mutation with its submitted form so navigation warnings survive failed saves.
  const submittedForm = useRef<HTMLFormElement | null>(null);
  const navigationText = {
    en: { home: "Home", sites: "Flight sites", unsaved: "Discard unsaved changes?" },
    fr: { home: "Accueil", sites: "Sites de vol", unsaved: "Abandonner les modifications non enregistrées ?" },
    ar: { home: "الرئيسية", sites: "مواقع الطيران", unsaved: "هل تريد تجاهل التغييرات غير المحفوظة؟" },
  }[language];
  const siteRoleText = {
    en: { siteTeam: "Site team", securityManager: "Security manager", save: "Save site permissions" },
    fr: { siteTeam: "Équipe des sites", securityManager: "Responsable sécurité", save: "Enregistrer les permissions du site" },
    ar: { siteTeam: "فريق المواقع", securityManager: "مسؤول السلامة", save: "حفظ صلاحيات المواقع" },
  }[language];
  function hasUnsaved() {
    for (const form of dirtyForms.current) if (!form.isConnected) dirtyForms.current.delete(form);
    return dirtyForms.current.size > 0;
  }
  function navigate(next: typeof page) {
    if (hasUnsaved() && !window.confirm(navigationText.unsaved)) return;
    dirtyForms.current.clear(); setDraft(null); setPage(next); window.scrollTo(0, 0);
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (hasUnsaved()) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    if (!account || !loaded) return;
    const target = page === "home" ? document.querySelector<HTMLElement>(".main-menu button") :
      document.querySelector<HTMLElement>("main > section h2");
    if (target) { if (page !== "home") target.tabIndex = -1; target.focus(); }
  }, [page, account, loaded]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);
  const api = useMemo(() => async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!authClient || !account) throw new Error("Not authenticated");
    const form = submittedForm.current;
    submittedForm.current = null;
    const { data, error: sessionError } = await authClient.auth.getSession();
    if (sessionError || !data.session || data.session.user.id !== account.user.id) throw new Error("Session unavailable");
    const response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers, Authorization: `Bearer ${data.session.access_token}` },
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    if (form && init?.method && init.method !== "GET") dirtyForms.current.delete(form);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }, [account]);

  useEffect(() => {
    if (!account) { setMembers([]); setProfile(null); setAdministrators([]); setAudit([]); setLoaded(false); return; }
    let cancelled = false;
    setLoaded(false);
    setBusy(true);
    Promise.all([api<Profile>("/api/me"), api<Member[]>("/api/members")])
      .then(([me, list]) => { if (!cancelled) { setProfile(me); setMembers(list); setLoaded(true); setError(false); } })
      .catch((e: unknown) => { console.error("Unable to load members", e); if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [account, api]);

  useEffect(() => {
    if (profile?.role !== "special_admin") return;
    let cancelled = false;
    Promise.all([api<Administrator[]>("/api/administrators"), api<Audit[]>("/api/audit")])
      .then(([list, history]) => { if (!cancelled) { setAdministrators(list); setAudit(history); } })
      .catch((e: unknown) => { console.error("Unable to load administrators", e); if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [profile, api, revision]);

  async function signOut() {
    if (!authClient || !account) return;
    if (hasUnsaved() && !window.confirm(navigationText.unsaved)) return;
    try {
      const { error: signOutError } = await authClient.auth.signOut();
      if (signOutError) throw signOutError;
      dirtyForms.current.clear(); setDraft(null); setPage("home"); setAccount(null);
    }
    catch (e) { console.error("Sign-out failed", e); setError(true); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      const member = await api<Member>(editing ? `/api/members/${editing}` : "/api/members", {
        method: editing ? "PUT" : "POST", body: JSON.stringify(draft),
      });
      setMembers((previous) => editing ? previous.map((item) => item.id === member.id ? member : item) : [...previous, member]);
      setRevision((value) => value + 1);
      setDraft(null); setEditing(null); setError(false);
    } catch (e) { console.error("Saving member failed", e); setError(true); }
    finally { setBusy(false); }
  }
  async function archive(id: string) {
    if (!window.confirm(t.archived)) return;
    setBusy(true);
    try {
      await api<void>(`/api/members/${id}/archive`, { method: "POST" });
      setMembers((previous) => previous.filter((item) => item.id !== id));
      setRevision((value) => value + 1);
      setError(false);
    } catch (e) { console.error("Archiving member failed", e); setError(true); }
    finally { setBusy(false); }
  }
  async function setAdministrator(id: string, active: boolean) {
    setBusy(true);
    try {
      await api<Administrator>(`/api/administrators/${encodeURIComponent(id)}`, {
        method: "PUT", body: JSON.stringify({ active }),
      });
      setAdministratorId("");
      setRevision((value) => value + 1);
      setError(false);
    } catch (e) { console.error("Updating administrator failed", e); setError(true); }
    finally { setBusy(false); }
  }
  async function saveSitePermissions(administrator: Administrator) {
    setBusy(true);
    try {
      await api(`/api/administrators/${administrator.objectId}/site-permissions`, {
        method: "PUT", body: JSON.stringify({ siteTeam: administrator.siteTeam, securityManager: administrator.securityManager }),
      });
      setRevision((value) => value + 1); setError(false);
    } catch (e) { console.error("Unable to save site permissions", e); setError(true); }
    finally { setBusy(false); }
  }

  return <main onPointerDownCapture={(event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".site-map, .signature-pad")) {
      const form = target.closest("form"); if (form) dirtyForms.current.add(form);
    }
  }} onChangeCapture={(event) => {
    const target = event.target as HTMLElement;
    const form = target.closest("form"); if (form && !target.closest("[data-auth], [data-map-layer]")) dirtyForms.current.add(form);
  }} onClickCapture={(event) => {
    const button = (event.target as HTMLElement).closest("button");
    const form = button?.closest("form");
    if (form && button?.type === "button" && !button.closest("[data-auth]")) {
      if (button.textContent?.trim() === t.cancel) dirtyForms.current.delete(form);
      else dirtyForms.current.add(form);
    }
  }} onSubmitCapture={(event) => {
    const form = event.target as HTMLFormElement;
    if (form.closest("[data-auth]")) return;
    submittedForm.current = form;
    queueMicrotask(() => { if (submittedForm.current === form) submittedForm.current = null; });
  }}>
    <header>
      <h1>{t.title}</h1>
      <div className="controls">
        <label><span className="sr-only">Language / Langue / اللغة</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="fr">Français</option><option value="ar">العربية</option><option value="en">English</option>
          </select>
        </label>
        {account && <button onClick={signOut}>{t.signOut}</button>}
      </div>
    </header>
    <div data-auth hidden={!!account}><Auth language={language} onReady={setAccount} /></div>
    {error && <p role="alert" className="error">{t.failure}</p>}
    {account && loaded && page === "home" && <nav className="main-menu" aria-label={t.navigation}>
      <button onClick={() => navigate("members")}>{t.members}</button>
      <button onClick={() => navigate("sites")}>{navigationText.sites}</button>
      <button onClick={() => navigate("operations")}>{t.operations}</button>
      <button onClick={() => navigate("finance")}>{t.finance}</button>
      <button onClick={() => navigate("notifications")}>{t.notifications}</button>
      <button onClick={() => navigate("reports")}>{t.reports}</button>
      {profile?.role === "special_admin" && <button onClick={() => navigate("administrators")}>{t.administrators}</button>}
    </nav>}
    {account && loaded && page !== "home" && <button className="home-button" onClick={() => navigate("home")}>{navigationText.home}</button>}
    {account && loaded && page === "sites" && <Sites api={api} language={language} specialAdmin={profile?.role === "special_admin"}
      canEdit={!!(profile?.sitePermissions.siteTeam || profile?.sitePermissions.securityManager)}
      canValidate={!!profile?.sitePermissions.securityManager} onChange={() => setRevision((value) => value + 1)} />}
    {account && loaded && page === "operations" && <Operations api={api} language={language} members={members} specialAdmin={profile?.role === "special_admin"} onChange={() => setRevision((value) => value + 1)} />}
    {account && loaded && page === "finance" && <Finance api={api} language={language} onChange={() => setRevision((value) => value + 1)} />}
    {account && loaded && page === "notifications" && <WhatsApp api={api} language={language} revision={revision} onChange={() => setRevision((value) => value + 1)} specialAdmin={profile?.role === "special_admin"} />}
    {account && loaded && page === "reports" && <Reports api={api} language={language} revision={revision} />}
    {account && loaded && page === "members" && <section id="members">
      <div className="section-title"><h2>{t.members}</h2><button onClick={() => { setEditing(null); setDraft(empty); }}>{t.create}</button></div>
      {draft && <form onSubmit={save} className="form">
        <label>{t.firstName}<input required maxLength={100} value={draft.firstName} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} /></label>
        <label>{t.lastName}<input required maxLength={100} value={draft.lastName} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} /></label>
        <label>{t.phone}<input dir="ltr" maxLength={40} value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value || null })} /></label>
        <label>{t.email}<input dir="ltr" type="email" maxLength={254} value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value || null })} /></label>
        {(["birthDate", "licenceExpiresOn"] as const).map((field) => <label key={field}>{t[field]}<input type="date" value={draft.details[field] ?? ""} onChange={(e) => setDraft({ ...draft, details: { ...draft.details, [field]: e.target.value || null } })} /></label>)}
        {(["birthPlace", "nationality", "profession", "address", "emergencyContact", "qualification", "licenceNumber", "insuranceProvider", "insuranceReference"] as const).map((field) =>
          <label key={field}>{t[field]}<input value={draft.details[field]} onChange={(e) => setDraft({ ...draft, details: { ...draft.details, [field]: e.target.value } })} /></label>)}
        <label className="checkbox"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />{t.active}</label>
        <div><button disabled={busy} type="submit">{t.save}</button> <button type="button" onClick={() => setDraft(null)}>{t.cancel}</button></div>
      </form>}
      {busy && <p>{t.loading}</p>}
      {!busy && loaded && !members.length && <p>{t.empty}</p>}
      <ul className="member-list">{members.map((member) => <li key={member.id}>
        <div><div><strong>{t.firstName}:</strong> <bdi>{member.firstName}</bdi> · <strong>{t.lastName}:</strong> <bdi>{member.lastName}</bdi></div>
          <div><strong>{t.status}:</strong> {member.active ? t.active : t.inactive}</div>
          <div><strong>{t.phone}:</strong> <bdi>{member.phone ?? "—"}</bdi> · <strong>{t.email}:</strong> <bdi>{member.email ?? "—"}</bdi></div></div>
        <div><button onClick={() => { const { id, ...values } = member; setEditing(id); setDraft({ ...values, details: { ...emptyDetails, ...values.details } }); }}>{t.edit}</button>
          {profile?.role === "special_admin" && <button disabled={busy} onClick={() => archive(member.id)}>{t.archive}</button>}</div>
      </li>)}</ul>
    </section>}
    {account && loaded && page === "administrators" && profile?.role === "special_admin" && <section id="administrators">
        <h2>{t.administrators}</h2>
        <form className="form" onSubmit={(event) => { event.preventDefault(); void setAdministrator(administratorId, true); }}>
          <label>{t.objectId}<input required dir="ltr" value={administratorId} onChange={(event) => setAdministratorId(event.target.value)} /></label>
          <div><button disabled={busy} type="submit">{t.addAdmin}</button></div>
        </form>
        <ul className="member-list">{administrators.map((administrator) => <li key={administrator.objectId}>
          <div><strong>{t.objectId}:</strong> <bdi>{administrator.objectId}</bdi> · <strong>{t.status}:</strong> {administrator.role === "special_admin" ? t.protectedAdmin : administrator.active ? t.active : t.inactive}</div>
          {administrator.role === "admin" && <button disabled={busy} onClick={() => setAdministrator(administrator.objectId, !administrator.active)}>
            {administrator.active ? t.disable : t.enable}
          </button>}
          {administrator.role === "admin" && <form onSubmit={(event) => { event.preventDefault(); void saveSitePermissions(administrator); }}>
            {(["siteTeam", "securityManager"] as const).map((field) => <label className="checkbox" key={field}>
              <input type="checkbox" checked={administrator[field]} onChange={(event) => setAdministrators((items) => items.map((item) =>
                item.objectId === administrator.objectId ? { ...item, [field]: event.target.checked } : item))} />{siteRoleText[field]}</label>)}
            <button disabled={busy}>{siteRoleText.save}</button>
          </form>}
        </li>)}</ul>
        <h3>{t.audit}</h3>
        <button onClick={() => setRevision((value) => value + 1)}>{t.refresh}</button>
        {!audit.length && <p>{t.auditEmpty}</p>}
        <ul className="member-list">{audit.map((entry) => <li key={entry.id}><div>
          <strong>{t.auditActions[entry.action as keyof typeof t.auditActions] ?? entry.action} · {t.auditEntities[entry.entityType as keyof typeof t.auditEntities] ?? entry.entityType}</strong> · <bdi>{entry.entityId}</bdi>
          <div><bdi>{entry.actorId}</bdi> · {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(entry.occurredAt))}</div>
          <details><summary>{t.audit}</summary><pre dir="auto">{JSON.stringify(entry.details, null, 2)}</pre></details>
        </div></li>)}</ul>
      </section>}
  </main>;
}
