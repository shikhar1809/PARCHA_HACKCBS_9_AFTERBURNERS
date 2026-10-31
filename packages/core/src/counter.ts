/**
 * The optional counters after the doctor: a pharmacy and a billing desk. A
 * clinic has them only if a seat has the "dispense" or "billing" ability; the
 * visit's own stages end at "prescribed" either way, so neither can hold a
 * patient up.
 */

export type BillLine = { label: string; amount: number };

/** Razorpay: the clinic's Razorpay payment page, shown to the patient as a QR. */
export const PAY_MODES = ["cash", "upi", "card", "razorpay"] as const;
export type PayMode = (typeof PAY_MODES)[number];
export const PAY_MODE_LABEL: Record<PayMode, string> = { cash: "Cash", upi: "UPI", card: "Card", razorpay: "Razorpay" };

/** Razorpay's payment id, as on the patient's confirmation ("pay_" and 14 letters and digits). */
export const cleanPaymentRef = (value: unknown): string | null => {
  const v = String(value ?? "").trim();
  return /^pay_[A-Za-z0-9]{8,30}$/.test(v) ? v : null;
};

/** A Razorpay payment page (rzp.io short link or pages.razorpay.com), or null. */
export const cleanRazorpayPage = (value: unknown): string | null => {
  const v = String(value ?? "").trim();
  return /^https:\/\/(rzp\.io|pages\.razorpay\.com|razorpay\.me)\/[A-Za-z0-9/_\-@.]{2,100}$/.test(v) ? v : null;
};

/** Keeps lines with a label and an amount from 0 to 10 lakh, rounded to the rupee. */
export function cleanBillLines(value: unknown): BillLine[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((l) => ({ label: String((l as BillLine)?.label ?? "").trim().slice(0, 60), amount: Math.round(Number((l as BillLine)?.amount)) }))
    .filter((l) => l.label && Number.isFinite(l.amount) && l.amount >= 0 && l.amount <= 1_000_000)
    .slice(0, 30);
}

export const billTotal = (lines: BillLine[]) => lines.reduce((sum, l) => sum + l.amount, 0);

/** "₹1,250", Indian grouping. */
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** One line of what the pharmacy gave: the prescribed medicine, whether it was given, and what was given instead. */
export type DispensedLine = { drugName: string; given: boolean; substitute: string | null };
