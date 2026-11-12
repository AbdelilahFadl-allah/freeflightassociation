import { useEffect, useState } from "react";
import type { Language } from "./translations";
import { NotificationSettings, notificationMessages, type NotificationEvent } from "./NotificationSettings";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Member = { id: string; firstName: string; lastName: string; phone: string | null; active: boolean; optedIn: boolean | null; evidence: string | null };
type Templates = { configured: boolean; templates: { id: string; label: string }[] };
type Batch = { id: string; templateId: string; event: NotificationEvent | null; sourceId: string | null; recipients: { id: string; memberId: string | null; administratorId: string | null; state: string; reason: string | null }[] };
const strings = {
  en: {
    title: "WhatsApp notifications", disabled: "WhatsApp is not configured. No messages can be sent.", consent: "Consent records",
    evidence: "Consent or opt-out evidence", optIn: "Record opt-in", optOut: "Record opt-out", yes: "Opted in", no: "Not opted in",
    template: "Approved template", choose: "Choose", create: "Create batch", send: "Send next 10 queued messages",
    confirm: "Send this template individually to the eligible members in this batch?", batches: "Batches",
    failed: "The operation could not be confirmed. Check the batch and provider status before retrying.", refreshFailed: "The operation was saved, but the display could not refresh. Do not repeat it; reload the page.", inactive: "Inactive", status: "Status",
    states: { queued: "Queued", sending: "Sending", submitted: "Submitted", delivered: "Delivered", read: "Read", failed: "Failed", unknown: "Unknown", excluded: "Excluded" },
    reasons: { archived: "Archived", inactive: "Inactive", no_consent: "No consent", invalid_phone: "Invalid phone", eligibility_changed: "Eligibility changed", provider_outcome_unknown: "Provider outcome unknown" },
    markUnknown: "Mark stuck send as unknown", markConfirm: "Only mark a stuck send after checking the provider. This does not retry the message."
  },
  fr: {
    title: "Notifications WhatsApp", disabled: "WhatsApp n'est pas configuré. Aucun message ne peut être envoyé.", consent: "Consentements",
    evidence: "Preuve du consentement ou du retrait", optIn: "Enregistrer le consentement", optOut: "Enregistrer le retrait", yes: "Consentement donné", no: "Sans consentement",
    template: "Modèle approuvé", choose: "Choisir", create: "Créer un lot", send: "Envoyer les 10 prochains messages",
    confirm: "Envoyer ce modèle individuellement aux membres admissibles de ce lot ?", batches: "Lots",
    failed: "L'opération n'a pas pu être confirmée. Vérifiez le lot et le statut du fournisseur avant de réessayer.", refreshFailed: "L'opération a été enregistrée mais l'affichage n'a pas pu être actualisé. Ne la répétez pas ; rechargez la page.", inactive: "Inactif", status: "Statut",
    states: { queued: "En attente", sending: "Envoi en cours", submitted: "Transmis", delivered: "Livré", read: "Lu", failed: "Échec", unknown: "Inconnu", excluded: "Exclu" },
    reasons: { archived: "Archivé", inactive: "Inactif", no_consent: "Sans consentement", invalid_phone: "Téléphone invalide", eligibility_changed: "Admissibilité modifiée", provider_outcome_unknown: "Résultat inconnu chez le fournisseur" },
    markUnknown: "Marquer l'envoi bloqué comme inconnu", markConfirm: "Ne marquer un envoi bloqué qu'après vérification auprès du fournisseur. Le message ne sera pas renvoyé."
  },
  ar: {
    title: "إشعارات واتساب", disabled: "لم يتم إعداد واتساب. لا يمكن إرسال الرسائل.", consent: "سجلات الموافقة",
    evidence: "دليل الموافقة أو سحبها", optIn: "تسجيل الموافقة", optOut: "تسجيل سحب الموافقة", yes: "وافق", no: "لم يوافق",
    template: "القالب المعتمد", choose: "اختر", create: "إنشاء دفعة", send: "إرسال الرسائل العشر التالية",
    confirm: "هل تريد إرسال هذا القالب فردياً إلى الأعضاء المؤهلين في هذه الدفعة؟", batches: "الدفعات",
    failed: "تعذر تأكيد العملية. تحقق من الدفعة وحالة المزود قبل إعادة المحاولة.", refreshFailed: "تم حفظ العملية لكن تعذر تحديث العرض. لا تكررها؛ أعد تحميل الصفحة.", inactive: "غير نشط", status: "الحالة",
    states: { queued: "في الانتظار", sending: "جار الإرسال", submitted: "تم الإرسال للمزود", delivered: "تم التسليم", read: "تمت القراءة", failed: "فشل", unknown: "غير معروف", excluded: "مستبعد" },
    reasons: { archived: "مؤرشف", inactive: "غير نشط", no_consent: "لا توجد موافقة", invalid_phone: "رقم غير صالح", eligibility_changed: "تغيرت الأهلية", provider_outcome_unknown: "نتيجة المزود غير معروفة" },
    markUnknown: "تحديد الإرسال المتوقف كمجهول", markConfirm: "تحقق من المزود قبل تحديد الإرسال المتوقف. لن تتم إعادة إرسال الرسالة."
  },
} as const;

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
        <bdi>{m.firstName} {m.lastName}</bdi> · <bdi>{m.phone ?? "—"}</bdi> · {m.optedIn ? t.yes : t.no} {!m.active && `· ${t.inactive}`}</label>
      <label>{t.evidence}<input maxLength={500} value={evidence[m.id] ?? m.evidence ?? ""} onChange={(e) => setEvidence({ ...evidence, [m.id]: e.target.value })} /></label>
      <button disabled={busy || !(evidence[m.id] ?? m.evidence ?? "").trim()} onClick={() => execute(`/api/whatsapp/consents/${m.id}`, "PUT", { optedIn: true, evidence: evidence[m.id] ?? m.evidence })}>{t.optIn}</button>{" "}
      <button disabled={busy || !(evidence[m.id] ?? m.evidence ?? "").trim()} onClick={() => execute(`/api/whatsapp/consents/${m.id}`, "PUT", { optedIn: false, evidence: evidence[m.id] ?? m.evidence })}>{t.optOut}</button>
    </div></li>)}</ul>
    <form className="form" onSubmit={(e) => { e.preventDefault(); void execute("/api/whatsapp/batches", "POST", { templateId: template, memberIds: selected }); }}>
      <label>{t.template}<select required value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">{t.choose}</option>{templates.templates.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
      <div><button disabled={busy || !templates.configured || !selected.length}>{t.create}</button></div>
    </form>
    <h3>{t.batches}</h3>
    <ul className="member-list">{batches.map((b) => <li key={b.id}><div><strong>{b.templateId}</strong> {b.event && `· ${notificationMessages[language][b.event]}`} · <bdi>{b.id}</bdi>
      {b.sourceId && <div><bdi>{b.sourceId}</bdi></div>}
      <ul>{b.recipients.map((r) => {
        const m = members.find((x) => x.id === r.memberId); return <li key={r.id}>
          <bdi>{m ? `${m.firstName} ${m.lastName}` : r.administratorId ?? r.memberId}</bdi> — {t.status}: {t.states[r.state as keyof typeof t.states] ?? r.state} {r.reason ? `(${t.reasons[r.reason as keyof typeof t.reasons] ?? r.reason})` : ""}
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
