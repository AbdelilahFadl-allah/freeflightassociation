import { useEffect, useState } from "react";
import type { Language } from "./translations";
import { notificationMessages } from "./i18n/notificationSettings";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export type NotificationEvent = "flight_planned" | "goods_trade" | "gear_added" | "gear_removed" | "financial_operation";
type Setting = { event: NotificationEvent; enabled: boolean; templateId: string };
type Contact = { administratorId: string; active: boolean; phone: string | null; optedIn: boolean | null; evidence: string | null };
export { notificationMessages };
export function NotificationSettings({ api, language, templates, revision }: {
  api: Api; language: Language; templates: { id: string; label: string }[]; revision: number;
}) {
  const t = notificationMessages[language];
  const [settings, setSettings] = useState<Setting[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Discard responses after unmount or a revision change rather than restoring stale settings.
    let active = true;
    api<{ settings: Setting[]; contacts: Contact[] }>("/api/whatsapp/event-settings")
      .then((data) => { if (active) { setSettings(data.settings); setContacts(data.contacts); } })
      .catch((e: unknown) => { console.error(e); if (active) setError(true); });
    return () => { active = false; };
  }, [api, revision]);
  async function save(path: string, body: unknown) {
    setBusy(true);
    try { await api(path, { method: "PUT", body: JSON.stringify(body) }); setError(false); }
    catch (e) { console.error(e); setError(true); } finally { setBusy(false); }
  }
  return <section><h3>{t.title}</h3><p>{t.info}</p>{error && <p role="alert" className="error">{t.failed}</p>}
    {settings.map((item) => <form key={item.event} className="form" onSubmit={(e) => { e.preventDefault(); void save(`/api/whatsapp/event-settings/${item.event}`, { enabled: item.enabled, templateId: item.templateId }); }}>
      <strong>{t[item.event]}</strong>
      <label className="checkbox"><input type="checkbox" checked={item.enabled} onChange={(e) => setSettings(settings.map((s) => s.event === item.event ? { ...s, enabled: e.target.checked } : s))} />{t.enabled}</label>
      <label>{t.template}<select value={item.templateId} required={item.enabled} onChange={(e) => setSettings(settings.map((s) => s.event === item.event ? { ...s, templateId: e.target.value } : s))}>
        <option value="">{t.choose}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</select></label>
      <div><button disabled={busy}>{t.save}</button></div>
    </form>)}
    {contacts.map((contact) => <form key={contact.administratorId} className="form" onSubmit={(e) => { e.preventDefault(); void save(`/api/whatsapp/admin-contacts/${contact.administratorId}`, { phone: contact.phone, optedIn: contact.optedIn ?? false, evidence: contact.evidence }); }}>
      <bdi>{contact.administratorId}</bdi>
      <label>{t.phone}<input required dir="ltr" pattern="\+[1-9][0-9]{7,14}" value={contact.phone ?? ""} onChange={(e) => setContacts(contacts.map((c) => c.administratorId === contact.administratorId ? { ...c, phone: e.target.value } : c))} /></label>
      <label className="checkbox"><input type="checkbox" checked={contact.optedIn ?? false} onChange={(e) => setContacts(contacts.map((c) => c.administratorId === contact.administratorId ? { ...c, optedIn: e.target.checked } : c))} />{t.consent}</label>
      <label>{t.evidence}<input required maxLength={500} value={contact.evidence ?? ""} onChange={(e) => setContacts(contacts.map((c) => c.administratorId === contact.administratorId ? { ...c, evidence: e.target.value } : c))} /></label>
      <div><button disabled={busy}>{t.save}</button></div>
    </form>)}
  </section>;
}
