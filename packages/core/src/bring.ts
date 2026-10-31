/**
 * What a hospital can ask a patient to bring.
 *
 * A fixed catalogue rather than free text, for the same reason dosing is drawn:
 * the person reading it may not read comfortably, and a picture with a short
 * word is understood at a glance, in any language, on any phone. A hospital
 * picks from these, and can add a line of its own for anything else.
 */

export type BringItem = {
  id: string;
  label: string;
  hindi: string;
  hinglish: string;
  /** The name of a Lucide icon, resolved by each app. */
  icon: string;
};

export const BRING_ITEMS: BringItem[] = [
  { id: "id_proof", label: "Photo ID", hindi: "पहचान पत्र", hinglish: "Photo ID", icon: "IdCard" },
  { id: "reports", label: "Old reports and scans", hindi: "पुरानी रिपोर्ट", hinglish: "Purani reports", icon: "FileText" },
  { id: "medicines", label: "Medicines you take now", hindi: "अभी की दवाइयाँ", hinglish: "Abhi ki dawaiyan", icon: "Pill" },
  { id: "prescription", label: "Old prescriptions", hindi: "पुरानी पर्ची", hinglish: "Purani parchi", icon: "ScrollText" },
  { id: "insurance", label: "Insurance or health card", hindi: "बीमा कार्ड", hinglish: "Insurance card", icon: "ShieldCheck" },
  { id: "fasting", label: "Come without eating for 8 hours", hindi: "खाली पेट आइए", hinglish: "Khaali pet aaiye", icon: "UtensilsCrossed" },
  { id: "attendant", label: "A family member with you", hindi: "साथ में परिवार का सदस्य", hinglish: "Saath mein family member", icon: "Users" },
  { id: "samples", label: "Urine or stool sample", hindi: "सैंपल", hinglish: "Sample (urine ya stool)", icon: "FlaskConical" },
];

export const BRING_IDS = new Set(BRING_ITEMS.map((i) => i.id));

/** Only known items survive, in catalogue order, each once. */
export function cleanBring(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const want = new Set(ids.filter((x): x is string => typeof x === "string"));
  return BRING_ITEMS.filter((i) => want.has(i.id)).map((i) => i.id);
}
