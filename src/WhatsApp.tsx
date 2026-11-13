import { useEffect, useState } from "react";
import type { Language } from "./translations";
import { strings } from "./i18n/whatsapp";
import { NotificationSettings, notificationMessages, type NotificationEvent } from "./NotificationSettings";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Member = { id: string; firstName: string; lastName: string; phone: string | null; active: boolean; optedIn: boolean | null; evidence: string | null };
type Templates = { configured: boolean; templates: { id: string; label: string }[] };
type Batch = { id: string; templateId: string; event: NotificationEvent | null; sourceId: string | null; recipients: { id: string; memberId: string | null; administratorId: string | null; state: string; reason: string | null }[] };

export function WhatsApp({ api, language, revision, onChange, specialAdmin }: { api: Api; language: Language; revision: number; onChange: () => void; specialAdmin: boolean }) {
  const t = strings[language];
  const [members, setMembers] = useState<Member[]>([]);
  const [templates, setTemplates] = useState<Templates>({ configured: false, templates: [] });
  const [batches, setBatches] = useState<Batch[]>([]);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [template, setTemplate] = useState("");
  const [error, setError] = useState<"uncertain" | "refresh" | null>(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [m, a, b] = await Promise.all([api<Member[]>("/api/whatsapp/consents"), api<Templates>("/api/whatsapp/templates"), api<Batch[]>("/api/whatsapp/batches")]);
    setMembers(m); setTemplates(a); setBatches(b);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api<Member[]>("/api/whatsapp/consents"), api<Templates>("/api/whatsapp/templates"), api<Batch[]>("/api/whatsapp/batches")])
      .then(([m, a, b]) => { if (active) { setMembers(m); setTemplates(a); setBatches(b); } })
      .catch((e: unknown) => { console.error("Loading WhatsApp settings failed", e); if (active) setError("uncertain"); });
    return () => { active = false; };
  }, [api, revision]);
  async function execute(path: string, method: "POST" | "PUT", body: unknown) {
    setBusy(true);
    // A refresh failure after a successful mutation must not encourage a duplicate send.
    let saved = false;
    try { await api(path, { method, body: JSON.stringify(body) }); saved = true; onChange(); await refresh(); setError(null); }
    catch (e) { console.error("WhatsApp operation could not be confirmed", e); setError(saved ? "refresh" : "uncertain"); }
    finally { setBusy(false); }
  }
  return <section id="notifications"><h2>{t.title}</h2>
    {!templates.configured && <p>{t.disabled}</p>}{error && <p role="alert" className="error">{error === "refresh" ? t.refreshFailed : t.failed}</p>}
    {specialAdmin && <NotificationSettings api={api} language={language} templates={templates.templates} revision={revision} />}
    <h3>{t.consent}</h3>
    <ul className="member-list">{members.map((m) => <li key={m.id}><div>
      <label className="checkbox"><input type="checkbox" checked={selected.includes(m.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id))} />
        <span><strong>{t.name}:</strong> <bdi>{m.firstName} {m.lastName}</bdi> · <strong>{t.phone}:</strong> <bdi>{m.phone ?? "—"}</bdi> · <strong>{t.consentStatus}:</strong> {m.optedIn ? t.yes : t.no} {!m.active && `· ${t.inactive}`}</span></label>
      <label>{t.evidence}<input maxLength={500} value={evidence[m.id] ?? m.evidence ?? ""} onChange={(e) => setEvidence({ ...evidence, [m.id]: e.target.value })} /></label>
      <button disabled={busy || !(evidence[m.id] ?? m.evidence ?? "").trim()} onClick={() => execute(`/api/whatsapp/consents/${m.id}`, "PUT", { optedIn: true, evidence: evidence[m.id] ?? m.evidence })}>{t.optIn}</button>{" "}
      <button disabled={busy || !(evidence[m.id] ?? m.evidence ?? "").trim()} onClick={() => execute(`/api/whatsapp/consents/${m.id}`, "PUT", { optedIn: false, evidence: evidence[m.id] ?? m.evidence })}>{t.optOut}</button>
    </div></li>)}</ul>
    <form className="form" onSubmit={(e) => { e.preventDefault(); void execute("/api/whatsapp/batches", "POST", { templateId: template, memberIds: selected }); }}>
      <label>{t.template}<select required value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">{t.choose}</option>{templates.templates.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
      <div><button disabled={busy || !templates.configured || !selected.length}>{t.create}</button></div>
    </form>
    <h3>{t.batches}</h3>
    <ul className="member-list">{batches.map((b) => <li key={b.id}><div><div><strong>{t.template}:</strong> <bdi>{b.templateId}</bdi> {b.event && <>· <strong>{t.event}:</strong> {notificationMessages[language][b.event]}</>}</div>
      <div><strong>{t.batchId}:</strong> <bdi>{b.id}</bdi></div>
      {b.sourceId && <div><strong>{t.sourceId}:</strong> <bdi>{b.sourceId}</bdi></div>}
      <ul>{b.recipients.map((r) => {
        const m = members.find((x) => x.id === r.memberId); return <li key={r.id}>
          <strong>{t.recipient}:</strong> <bdi>{m ? `${m.firstName} ${m.lastName}` : r.administratorId ?? r.memberId}</bdi> — <strong>{t.status}:</strong> {t.states[r.state as keyof typeof t.states] ?? r.state} {r.reason ? `(${t.reasons[r.reason as keyof typeof t.reasons] ?? r.reason})` : ""}
          {r.state === "sending" && specialAdmin && <button type="button" disabled={busy} onClick={() => {
            if (window.confirm(t.markConfirm)) void execute(`/api/whatsapp/recipients/${r.id}/mark-unknown`, "POST", {});
          }}>{t.markUnknown}</button>}
        </li>;
      })}</ul>
      {b.recipients.some((r) => r.state === "queued") && <button disabled={busy} onClick={() => {
        if (window.confirm(t.confirm)) void execute(`/api/whatsapp/batches/${b.id}/dispatch`, "POST", {});
      }}>{t.send}</button>}
    </div></li>)}</ul>
  </section>;
}
