import { errorMessage, recordBill, useHospital, useHospitalScope, useTodaysVisits } from "@parcha/client";
import { billTotal, cleanPaymentRef, PAY_MODE_LABEL, PAY_MODES, rupees, type BillLine, type PayMode, type Visit } from "@parcha/core";
import { AppBar, cn, Screen } from "@parcha/ui";
import { Check, ChevronDown, ExternalLink, Loader2, Plus, Printer, ReceiptIndianRupee, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Btn, Card, FIELD } from "../bits";

const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";

/**
 * The billing desk: today's patients with no bill yet, and the bills not yet
 * paid. Fees start from the clinic's consultation fee (set on the Manage
 * page); payment is cash, UPI or card taken at the desk, or online on the
 * clinic's Razorpay page (a QR the patient scans: UPI, card, netbanking), and
 * a receipt prints from here.
 */
export function Billing() {
  const today = useTodaysVisits();
  const hospital = useHospital(useHospitalScope());
  const fee = hospital.data?.consultationFee ?? null;
  const [showPaid, setShowPaid] = useState(false);
  const live = today.data.filter((v) => v.stage !== "cancelled" && v.stage !== "requested" && v.stage !== "proposed");
  // In token order, the order people came in.
  const toBill = live.filter((v) => typeof v.billTotal !== "number" || !v.paid).sort((a, b) => (a.tokenNumber ?? 1e9) - (b.tokenNumber ?? 1e9));
  const paid = live.filter((v) => typeof v.billTotal === "number" && v.paid);
  const takings = paid.reduce((s, v) => s + (v.billTotal ?? 0), 0);

  return (
    <>
      <AppBar title="Billing" subtitle={`Today ${rupees(takings)} taken · ${toBill.length} to bill`} />
      <Screen className="space-y-4 p-4">
        {today.error ? (
          <p role="alert" className="text-destructive text-base">
            Could not load today's visits. {today.error}
          </p>
        ) : today.loading && today.data.length === 0 ? (
          <p className="flex items-center gap-2 text-base">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : toBill.length === 0 ? (
          <Card tone="ok" className="flex items-center gap-3">
            <ReceiptIndianRupee className="size-7 shrink-0" aria-hidden />
            <p className="text-base">Everyone seen today has paid. Patients appear here as soon as the desk registers them.</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {toBill.map((v) => (
              <li key={v.id}>
                <ToBill visit={v} fee={fee} charges={hospital.data?.charges ?? []} clinic={hospital.data?.name ?? "Clinic"} razorpayPage={hospital.data?.razorpayPage ?? null} />
              </li>
            ))}
          </ul>
        )}

        {paid.length ? (
          <div className="space-y-2">
            <button type="button" onClick={() => setShowPaid(!showPaid)} className="flex items-center gap-2 text-base font-bold" aria-expanded={showPaid}>
              <ChevronDown className={cn("size-5 transition", showPaid && "rotate-180")} aria-hidden />
              Paid today ({paid.length})
            </button>
            {showPaid ? (
              <ul className="space-y-2">
                {paid.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#232326] bg-white px-3 py-2">
                    <span className="text-base font-bold">{v.patientName}</span>
                    <span className="text-sm">
                      {rupees(v.billTotal ?? 0)} · {v.paidMode ? PAY_MODE_LABEL[v.paidMode as PayMode] : ""}
                      {v.paidRef ? ` · ${v.paidRef}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Screen>
    </>
  );
}

/** Offered when the clinic has not set its own price list on the Manage page. */
const QUICK: BillLine[] = ["Dressing", "Injection", "Nebulisation", "ECG", "Blood test", "Medicines"].map((label) => ({ label, amount: 0 }));

function ToBill({ visit, fee, charges, clinic, razorpayPage }: { visit: Visit; fee: number | null; charges: BillLine[]; clinic: string; razorpayPage: string | null }) {
  const quick = charges.length ? [...charges, ...(charges.some((c) => c.label === "Medicines") ? [] : [{ label: "Medicines", amount: 0 }])] : QUICK;
  const [lines, setLines] = useState<BillLine[]>([{ label: "Consultation", amount: fee ?? 0 }]);
  const [mode, setMode] = useState<PayMode>("cash");
  // Razorpay's payment id from the patient's confirmation: optional, but it goes on the receipt.
  const [paidRef, setPaidRef] = useState("");
  const refOk = !paidRef.trim() || cleanPaymentRef(paidRef) !== null;
  // The clinic's fee can arrive after the card: fill it in if nobody has typed one yet.
  useEffect(() => {
    if (fee != null) setLines((ls) => (ls[0]?.label === "Consultation" && !ls[0].amount ? [{ ...ls[0], amount: fee }, ...ls.slice(1)] : ls));
  }, [fee]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = billTotal(lines);
  const owes = typeof visit.billTotal === "number" && !visit.paid;
  const set = (i: number, l: Partial<BillLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...l } : x)));

  async function save(paid: boolean) {
    setBusy(true);
    setError(null);
    try {
      const clean = lines.filter((l) => l.label.trim());
      const ref = paid && mode === "razorpay" ? cleanPaymentRef(paidRef) ?? undefined : undefined;
      await recordBill(visit.id, { lines: clean, paid, mode: paid ? mode : undefined, paidRef: ref });
      if (paid) printReceipt({ clinic, visit, lines: clean, mode, paidRef: ref ?? null });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-xl font-bold">
          {visit.tokenNumber ? <span className="mr-2 rounded-lg bg-[#232326] px-2 py-0.5 text-white tabular-nums">#{visit.tokenNumber}</span> : null}
          {visit.patientName}
        </p>
        <p className="text-sm">
          {owes ? <b>Billed {rupees(visit.billTotal ?? 0)}, not yet paid · </b> : null}
          came {time(visit.registeredAt)}
          {visit.assignedDoctorName ? ` · ${visit.assignedDoctorName}` : ""}
        </p>
      </div>

      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center gap-2">
            <input className={cn(FIELD, "min-w-0 flex-1")} value={l.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="What for" placeholder="What for" />
            <span className="text-lg font-bold">₹</span>
            <input
              className={cn(FIELD, "max-w-28 shrink-0 text-right tabular-nums")}
              inputMode="numeric"
              value={l.amount || ""}
              placeholder="0"
              onChange={(e) => set(i, { amount: Number(e.target.value.replace(/\D/g, "").slice(0, 7)) || 0 })}
              aria-label={`Amount for ${l.label || "this line"}`}
            />
            <button type="button" aria-label={`Remove ${l.label || "this line"}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded-lg p-2 hover:bg-black/10" disabled={lines.length === 1}>
              <Trash2 className="size-5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {quick.filter((q) => !lines.some((l) => l.label === q.label)).map((q) => (
          <button key={q.label} type="button" onClick={() => setLines([...lines, q])} className="inline-flex items-center gap-1 rounded-full border-2 border-[#232326] bg-white px-3 py-1 text-sm font-bold">
            <Plus className="size-3.5" aria-hidden /> {q.label}
            {q.amount ? <span className="font-normal">₹{q.amount}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[#232326]/15 pt-3">
        <div role="radiogroup" aria-label="Paid by" className="flex flex-wrap gap-2">
          {PAY_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded-xl border-[3px] border-[#232326] px-4 py-2 text-base font-bold", mode === m ? "bg-[#232326] text-white" : "bg-white")}
            >
              {PAY_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="text-2xl font-bold tabular-nums">{rupees(total)}</p>
      </div>
      {mode === "razorpay" ? <RazorpayPay page={razorpayPage} total={total} paidRef={paidRef} setPaidRef={setPaidRef} refOk={refOk} /> : null}
      {error ? (
        <p role="alert" className="text-destructive text-base">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Btn kind="primary" disabled={busy || !lines.some((l) => l.label.trim()) || !refOk || (mode === "razorpay" && !razorpayPage)} onClick={() => void save(true)}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          {total === 0 ? "Record as free (₹0)" : mode === "razorpay" ? `Paid ${rupees(total)} on Razorpay` : `Paid ${rupees(total)} by ${PAY_MODE_LABEL[mode]}`}
          <Printer className="size-4" aria-hidden />
        </Btn>
        {!owes ? (
          <Btn disabled={busy || !lines.some((l) => l.label.trim())} onClick={() => void save(false)}>
            Bill now, pay later
          </Btn>
        ) : null}
      </div>
    </Card>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/* ------------------------------------------------------------------ Razorpay */

/**
 * Paying on the clinic's Razorpay page: its QR, big enough to scan from the
 * patient's side of the desk, the amount to pay, and a place for the payment id
 * from their confirmation. Razorpay does not tell Parcha about a payment-page
 * payment, so the desk marks it paid once the patient shows the confirmation.
 */
function RazorpayPay({ page, total, paidRef, setPaidRef, refOk }: { page: string | null; total: number; paidRef: string; setPaidRef: (v: string) => void; refOk: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!page) return;
    let live = true;
    void QRCode.toDataURL(page, { errorCorrectionLevel: "M", margin: 1, width: 320 }).then((url) => live && setQr(url));
    return () => {
      live = false;
    };
  }, [page]);

  if (!page) {
    return (
      <p className="rounded-xl border-2 border-dashed border-[#232326] p-3 text-base">
        This clinic has no Razorpay payment page yet. Someone who manages the clinic can add it on the Manage page, under Clinic.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border-[3px] border-[#232326] bg-white p-3">
      {qr ? <img src={qr} alt="QR code of the clinic's Razorpay payment page" className="size-44 shrink-0 rounded-lg border-2 border-[#232326]" /> : <div className="skeleton size-44 shrink-0 rounded-lg" />}
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-base">
          The patient scans this and pays <b className="text-xl tabular-nums">{rupees(total)}</b> by UPI, card or netbanking.
        </p>
        <a href={page} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold underline">
          Open the payment page <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <label className="block text-sm font-bold">
          Payment id from their confirmation (optional)
          <input className={cn(FIELD, "mt-1 w-full font-mono")} value={paidRef} onChange={(e) => setPaidRef(e.target.value.trim())} placeholder="pay_..." aria-invalid={!refOk} />
        </label>
        {!refOk ? <p className="text-destructive text-sm">A Razorpay payment id starts pay_.</p> : null}
      </div>
    </div>
  );
}

/** A small receipt in its own window, sized for a thermal or A5 printer. */
function printReceipt({ clinic, visit, lines, mode, paidRef }: { clinic: string; visit: Visit; lines: BillLine[]; mode: PayMode; paidRef: string | null }) {
  const w = window.open("", "_blank", "width=420,height=640");
  if (!w) return;
  const when = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Receipt</title>
<style>body{font:15px/1.4 system-ui,sans-serif;margin:16px;max-width:340px}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:4px 0}td:last-child{text-align:right}tr.t td{border-top:2px solid #000;font-weight:700;font-size:17px}</style>
<h1>${esc(clinic)}</h1><p>Receipt · ${esc(when)}<br>${esc(visit.patientName)}${visit.tokenNumber ? ` · token ${visit.tokenNumber}` : ""}</p>
<table>${lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${rupees(l.amount)}</td></tr>`).join("")}
<tr class="t"><td>Paid by ${PAY_MODE_LABEL[mode]}</td><td>${rupees(billTotal(lines))}</td></tr></table>${paidRef ? `<p>Payment id ${esc(paidRef)}</p>` : ""}
<p>Thank you.</p><script>window.onload=()=>{window.print()}</script>`);
  w.document.close();
}
