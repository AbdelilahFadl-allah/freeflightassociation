export const strings = {
  en: {
    title: "WhatsApp notifications", disabled: "WhatsApp is not configured. No messages can be sent.", consent: "Consent records",
    evidence: "Consent or opt-out evidence", name: "Name", phone: "Phone", consentStatus: "Consent", batchId: "Batch ID", event: "Event", sourceId: "Source ID", recipient: "Recipient", optIn: "Record opt-in", optOut: "Record opt-out", yes: "Opted in", no: "Not opted in",
    template: "Approved template", choose: "Choose", create: "Create batch", send: "Send next 10 queued messages",
    confirm: "Send this template individually to the eligible members in this batch?", batches: "Batches",
    failed: "The operation could not be confirmed. Check the batch and provider status before retrying.", refreshFailed: "The operation was saved, but the display could not refresh. Do not repeat it; reload the page.", inactive: "Inactive", status: "Status",
    states: { queued: "Queued", sending: "Sending", submitted: "Submitted", delivered: "Delivered", read: "Read", failed: "Failed", unknown: "Unknown", excluded: "Excluded" },
    reasons: { archived: "Archived", inactive: "Inactive", no_consent: "No consent", invalid_phone: "Invalid phone", eligibility_changed: "Eligibility changed", provider_outcome_unknown: "Provider outcome unknown" },
    markUnknown: "Mark stuck send as unknown", markConfirm: "Only mark a stuck send after checking the provider. This does not retry the message."
  },
  fr: {
    title: "Notifications WhatsApp", disabled: "WhatsApp n'est pas configuré. Aucun message ne peut être envoyé.", consent: "Consentements",
    evidence: "Preuve du consentement ou du retrait", name: "Nom", phone: "Téléphone", consentStatus: "Consentement", batchId: "Identifiant du lot", event: "Événement", sourceId: "Identifiant de la source", recipient: "Destinataire", optIn: "Enregistrer le consentement", optOut: "Enregistrer le retrait", yes: "Consentement donné", no: "Sans consentement",
    template: "Modèle approuvé", choose: "Choisir", create: "Créer un lot", send: "Envoyer les 10 prochains messages",
    confirm: "Envoyer ce modèle individuellement aux membres admissibles de ce lot ?", batches: "Lots",
    failed: "L'opération n'a pas pu être confirmée. Vérifiez le lot et le statut du fournisseur avant de réessayer.", refreshFailed: "L'opération a été enregistrée mais l'affichage n'a pas pu être actualisé. Ne la répétez pas ; rechargez la page.", inactive: "Inactif", status: "Statut",
    states: { queued: "En attente", sending: "Envoi en cours", submitted: "Transmis", delivered: "Livré", read: "Lu", failed: "Échec", unknown: "Inconnu", excluded: "Exclu" },
    reasons: { archived: "Archivé", inactive: "Inactif", no_consent: "Sans consentement", invalid_phone: "Téléphone invalide", eligibility_changed: "Admissibilité modifiée", provider_outcome_unknown: "Résultat inconnu chez le fournisseur" },
    markUnknown: "Marquer l'envoi bloqué comme inconnu", markConfirm: "Ne marquer un envoi bloqué qu'après vérification auprès du fournisseur. Le message ne sera pas renvoyé."
  },
  ar: {
    title: "إشعارات واتساب", disabled: "لم يتم إعداد واتساب. لا يمكن إرسال الرسائل.", consent: "سجلات الموافقة",
    evidence: "دليل الموافقة أو سحبها", name: "الاسم", phone: "الهاتف", consentStatus: "الموافقة", batchId: "معرّف الدفعة", event: "الحدث", sourceId: "معرّف المصدر", recipient: "المستلم", optIn: "تسجيل الموافقة", optOut: "تسجيل سحب الموافقة", yes: "وافق", no: "لم يوافق",
    template: "القالب المعتمد", choose: "اختر", create: "إنشاء دفعة", send: "إرسال الرسائل العشر التالية",
    confirm: "هل تريد إرسال هذا القالب فردياً إلى الأعضاء المؤهلين في هذه الدفعة؟", batches: "الدفعات",
    failed: "تعذر تأكيد العملية. تحقق من الدفعة وحالة المزود قبل إعادة المحاولة.", refreshFailed: "تم حفظ العملية لكن تعذر تحديث العرض. لا تكررها؛ أعد تحميل الصفحة.", inactive: "غير نشط", status: "الحالة",
    states: { queued: "في الانتظار", sending: "جار الإرسال", submitted: "تم الإرسال للمزود", delivered: "تم التسليم", read: "تمت القراءة", failed: "فشل", unknown: "غير معروف", excluded: "مستبعد" },
    reasons: { archived: "مؤرشف", inactive: "غير نشط", no_consent: "لا توجد موافقة", invalid_phone: "رقم غير صالح", eligibility_changed: "تغيرت الأهلية", provider_outcome_unknown: "نتيجة المزود غير معروفة" },
    markUnknown: "تحديد الإرسال المتوقف كمجهول", markConfirm: "تحقق من المزود قبل تحديد الإرسال المتوقف. لن تتم إعادة إرسال الرسالة."
  },
} as const;
