/**
 * The privacy notice a patient agrees to, and its version.
 *
 * Short, in plain words, in English and Hindi. It says what is kept, why, who
 * can see it, and what the patient can do. Bump `PRIVACY_VERSION` when the
 * words change and everyone is asked again.
 *
 * This is the engineering draft, not a reviewed legal document: it must be
 * checked against India's Digital Personal Data Protection Act, 2023 and the
 * hospital's own policies before real patients rely on it.
 */
export const PRIVACY_VERSION = "2026-10-1";

export type PrivacyPoint = { icon: "keep" | "see" | "own" | "calls"; en: string; hi: string; hg: string };

export const PRIVACY_POINTS: PrivacyPoint[] = [
  {
    icon: "keep",
    en: "We keep your prescriptions, visits, medicine reminders, and anything you add: papers and health notes.",
    hi: "हम आपकी पर्चियाँ, डॉक्टर के पास की यात्राएँ, दवा के रिमाइंडर और आपके जोड़े काग़ज़ व स्वास्थ्य नोट रखते हैं।",
    hg: "Hum aapki parchiyan, doctor visits, dawai ke reminders aur aapke jode papers aur health notes rakhte hain.",
  },
  {
    icon: "see",
    en: "Your hospital's doctors and front desk see the visits made there. They cannot see your papers, health notes or reminders.",
    hi: "आपके अस्पताल के डॉक्टर और फ्रंट डेस्क केवल वहाँ की यात्राएँ देखते हैं। वे आपके काग़ज़, स्वास्थ्य नोट या रिमाइंडर नहीं देख सकते।",
    hg: "Aapke hospital ke doctor aur front desk sirf wahan ki visits dekhte hain. Woh aapke papers, health notes ya reminders nahi dekh sakte.",
  },
  {
    icon: "calls",
    en: "We call you only if you switch phone reminders on, and only on your own number.",
    hi: "हम तभी फ़ोन करते हैं जब आप फ़ोन रिमाइंडर चालू करें, और केवल आपके अपने नंबर पर।",
    hg: "Hum tabhi phone karte hain jab aap phone reminders chalu karein, aur sirf aapke apne number par.",
  },
  {
    icon: "own",
    en: "You can download everything, or delete what you added, from Me. A hospital must keep its own medical records of your visits.",
    hi: "आप \"मैं\" से अपना सारा डेटा डाउनलोड कर सकते हैं या अपना जोड़ा हुआ डेटा मिटा सकते हैं। अस्पताल को आपकी यात्राओं का अपना चिकित्सा रिकॉर्ड रखना होता है।",
    hg: "Aap \"Main\" se apna saara data download kar sakte hain ya apna joda hua data mita sakte hain. Hospital ko aapki visits ka apna medical record rakhna hota hai.",
  },
];
