export const notificationMessages = {
  en: { title: "Administrator notification settings", info: "Event batches are queued for review; sending remains manual. Contacts must consent.",
    flight_planned: "Flight planned", goods_trade: "Goods purchase or sale", gear_added: "Gear added", gear_removed: "Gear archived",
    financial_operation: "Financial operation or correction", enabled: "Enabled", template: "Approved template", choose: "Choose",
    phone: "WhatsApp phone (international)", consent: "Opted in", evidence: "Consent or opt-out evidence", save: "Save", failed: "Unable to save or load notification settings." },
  fr: { title: "Paramètres des notifications aux administrateurs", info: "Les lots sont préparés pour vérification ; l'envoi reste manuel. Le consentement est requis.",
    flight_planned: "Vol planifié", goods_trade: "Achat ou vente de marchandises", gear_added: "Matériel ajouté", gear_removed: "Matériel archivé",
    financial_operation: "Opération financière ou correction", enabled: "Activé", template: "Modèle approuvé", choose: "Choisir",
    phone: "Téléphone WhatsApp international", consent: "Consentement donné", evidence: "Preuve du consentement ou retrait", save: "Enregistrer", failed: "Impossible de charger ou enregistrer les paramètres." },
  ar: { title: "إعدادات إشعارات المسؤولين", info: "تُجهز الدفعات للمراجعة؛ يظل الإرسال يدوياً. موافقة المستلمين مطلوبة.",
    flight_planned: "رحلة مخططة", goods_trade: "شراء أو بيع البضائع", gear_added: "إضافة معدات", gear_removed: "أرشفة معدات",
    financial_operation: "عملية مالية أو تصحيح", enabled: "مفعّل", template: "القالب المعتمد", choose: "اختر",
    phone: "رقم واتساب الدولي", consent: "الموافقة", evidence: "دليل الموافقة أو سحبها", save: "حفظ", failed: "تعذر تحميل الإعدادات أو حفظها." },
} as const;
