/**
 * A prescription on paper, the traditional way.
 *
 * Black ink on white, hospital at the top, the patient, then each medicine as a
 * row with its dose pattern (1-0-1), how long and when to take it, and the
 * doctor's name above a signature line. It looks the same on A4 and on a
 * half sheet, prints without the app around it, and carries a QR code and the
 * visit code so the slip can be matched to the record.
 *
 * On screen it is hidden; `printPrescription()` shows only this and opens the
 * browser's print dialog, from which the patient or doctor can also "Save as
 * PDF".
 */
import { everyText, rxHindi, rxName, rxSig, type Prescription } from "@parcha/core";
import QRCode from "qrcode";
import { useMemo } from "react";
import { createPortal } from "react-dom";

export type SheetHospital = {
  name: string;
  address?: string | null;
  phone?: string | null;
};

export type SheetPatient = {
  name: string;
  ageYears?: number | null;
  sex?: string | null;
  phone?: string | null;
  /** Village or area, as the desk recorded it. */
  area?: string | null;
};

const SEX: Record<string, string> = { female: "F", male: "M", other: "Other" };

/** The QR as plain SVG squares, so nothing is injected and it prints crisp. */
export function Qr({ text, size = 84, label = "QR code" }: { text: string; size?: number; label?: string }) {
  const { n, cells } = useMemo(() => {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const cells: [number, number][] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) cells.push([x, y]);
    }
    return { n, cells };
  }, [text]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`-1 -1 ${n + 2} ${n + 2}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#fff" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000" />
      ))}
    </svg>
  );
}

const date = (iso: string | null | undefined) =>
  new Date(iso ?? Date.now()).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** The moment of signing, India time: "23 October 2026, 4:12 pm". */
const moment = (iso: string | null | undefined) =>
  new Date(iso ?? Date.now()).toLocaleString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

export function PrescriptionSheet({
  rx,
  hospital,
  patient,
  visitCode,
  shareCode,
  complaint,
}: {
  rx: Prescription;
  hospital?: SheetHospital | null;
  patient: SheetPatient;
  visitCode: string;
  /** The code that adds this visit to another phone. */
  shareCode?: string | null;
  /** The chief complaint, as the desk recorded it. */
  complaint?: string | null;
}) {
  const who = [
    patient.ageYears != null ? `${patient.ageYears} yrs` : null,
    patient.sex ? (SEX[patient.sex] ?? patient.sex) : null,
  ]
    .filter(Boolean)
    .join(" / ");

  // Into the page body, so no frame or scroll area around the app can clip it.
  return createPortal(
    <div className="rx-sheet" aria-hidden>
      <header className="rx-head">
        <div>
          <p className="rx-hospital">{hospital?.name ?? "Parcha"}</p>
          {hospital?.address ? <p>{hospital.address}</p> : null}
          {hospital?.phone ? <p>Phone {hospital.phone}</p> : null}
        </div>
        <div className="rx-qr">
          {/* The signed prescription itself: the patient app reads it with no network and checks it is genuine.
              Any phone camera opens the app on it. Without a signing key, the share link instead. */}
          <Qr
            text={rx.qr ?? (shareCode ? `https://parcha.web.app/link?code=${shareCode}` : `parcha:rx:${visitCode}:${rx.id}`)}
            size={rx.qr ? 118 : 84}
          />
          <p>{rx.qr ? "Scan in Parcha" : visitCode}</p>
        </div>
      </header>

      <section className="rx-patient">
        <p>
          <b>Patient:</b> {patient.name}
          {who ? ` · ${who}` : ""}
          {patient.phone ? ` · ${patient.phone}` : ""}
          {patient.area ? ` · ${patient.area}` : ""}
        </p>
        <p>
          <b>Date:</b> {date(rx.signedAt ?? rx.createdAt)}
        </p>
        {complaint ? (
          <p>
            <b>Complaint:</b> {complaint}
          </p>
        ) : null}
        {rx.diagnosisText ? (
          <p>
            <b>Diagnosis:</b> {rx.diagnosisText}
          </p>
        ) : null}
      </section>

      <p className="rx-mark">℞</p>

      <table className="rx-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Medicine</th>
            <th>Sig.</th>
            <th>Duration</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          {rx.items.map((it, i) => (
            <tr key={`${it.drugId}-${i}`}>
              <td>{i + 1}</td>
              <td>
                {/* As the chemist reads it, then as the family does. */}
                <b>{rxName(it)}</b>
                <br />
                <span className="rx-hi">{rxHindi(it)}</span>
                {it.instructions ? <span className="rx-sub"> · {it.instructions}</span> : null}
              </td>
              <td className="rx-nowrap">
                {rxSig(it)}
                {(it.everyDays ?? 1) > 1 ? (
                  <>
                    <br />
                    {everyText(it.everyDays)}
                  </>
                ) : null}
              </td>
              <td className="rx-nowrap">× {it.durationDays} d</td>
              <td>{it.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {rx.tests?.length ? (
        <p className="rx-block">
          <b>Tests:</b> {rx.tests.join(", ")}
        </p>
      ) : null}
      {rx.advice ? (
        <p className="rx-block">
          <b>Advice:</b> {rx.advice}
        </p>
      ) : null}
      {rx.followUpDays ? (
        <p className="rx-block">
          <b>Follow up:</b> after {rx.followUpDays} day{rx.followUpDays === 1 ? "" : "s"}
        </p>
      ) : null}

      <footer className="rx-foot">
        <p className="rx-small">
          Sig.: morning – afternoon – night, a count for each; OD once, BD twice, TDS three times, QID four times a day,
          HS at bedtime, SOS when needed; a.c. before food, p.c. after food. Do not stop a course early. Medicines are
          written by generic name; any brand with the same formula may be given.
          {rx.qr ? " Scan the code with the Parcha app to put these medicines, and their times, on a phone. The code carries this prescription itself, so nothing has to be typed again." : ""}
          {shareCode ? ` To follow this visit on another phone, open Parcha, choose Me, then Add a visit with a code: ${shareCode}. For the medicines on that phone too, scan the code above there as well.` : ""}
        </p>
        <div className="rx-sign">
          <DoctorStamp name={rx.prescriberName} qualification={rx.prescriberQualification} regNo={rx.prescriberRegNo} hospital={hospital?.name ?? null} />
          <div className="rx-line" />
          <p>
            <b>{rx.prescriberName}</b>
            {rx.prescriberQualification ? `, ${rx.prescriberQualification}` : ""}
          </p>
          {rx.prescriberRegNo ? <p className="rx-small">Reg. no. {rx.prescriberRegNo}</p> : null}
          <p className="rx-small">Signed electronically in Parcha, {moment(rx.signedAt)} IST</p>
        </div>
      </footer>
    </div>,
    document.body,
  );
}

/**
 * The doctor's stamp, drawn: a round rubber-stamp look in ink blue, with the
 * hospital round the top, the registration number round the bottom, and the
 * doctor's name and qualification in the middle. It stands beside the
 * electronic signature on every printed Parcha, the way a chemist expects to
 * see a stamp.
 */
export function DoctorStamp({ name, qualification, regNo, hospital }: { name: string; qualification?: string | null; regNo?: string | null; hospital?: string | null }) {
  const id = `stamp-${(regNo ?? name).replace(/[^A-Za-z0-9]/g, "")}`;
  const top = (hospital ?? "Parcha").toUpperCase().slice(0, 34);
  const bottom = regNo ? `REG. NO. ${regNo}`.toUpperCase().slice(0, 30) : "REGISTERED MEDICAL PRACTITIONER";
  return (
    <svg className="rx-stamp" viewBox="0 0 200 200" width="96" height="96" role="img" aria-label={`Stamp of ${name}`}>
      <defs>
        <path id={`${id}-top`} d="M 30,100 A 70,70 0 0 1 170,100" />
        <path id={`${id}-bottom`} d="M 26,100 A 74,74 0 0 0 174,100" />
      </defs>
      <g fill="none" stroke="#1b3f8b" strokeWidth="4">
        <circle cx="100" cy="100" r="94" />
        <circle cx="100" cy="100" r="58" strokeWidth="2.5" />
      </g>
      <g fill="#1b3f8b" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" textAnchor="middle">
        <text fontSize="15" letterSpacing="1.5">
          <textPath href={`#${id}-top`} startOffset="50%">{top}</textPath>
        </text>
        <text fontSize="13" letterSpacing="1.2">
          <textPath href={`#${id}-bottom`} startOffset="50%">{bottom}</textPath>
        </text>
        <text x="100" y="96" fontSize={name.length > 16 ? 13 : 15}>{name}</text>
        {qualification ? <text x="100" y="116" fontSize="10.5" fontWeight="400">{qualification.slice(0, 26)}</text> : null}
        {/* Stars at the sides, between the hospital above and the number below. */}
        <text x="19" y="105" fontSize="13">★</text>
        <text x="181" y="105" fontSize="13">★</text>
      </g>
    </svg>
  );
}

/**
 * The token a patient holds while they wait: the number the room calls, who
 * they are seeing, and a QR the doctor can scan to open the visit. Printed by
 * the same rule as the prescription (`printPrescription`), on a small slip.
 */
export function TokenSlip({
  hospital,
  token,
  patientName,
  doctorName,
  visitCode,
  at,
}: {
  hospital?: string | null;
  token: number | null;
  patientName: string;
  doctorName?: string | null;
  visitCode: string;
  at?: string | null;
}) {
  return createPortal(
    <div className="rx-sheet rx-token" aria-hidden>
      <p className="rx-hospital">{hospital ?? "Parcha"}</p>
      <p className="rx-token-label">Token</p>
      <p className="rx-token-number">{token ?? "–"}</p>
      <p>
        <b>{patientName}</b>
        {doctorName ? ` · ${doctorName}` : ""}
      </p>
      <p className="rx-small">{moment(at)} IST</p>
      <div className="rx-qr">
        <Qr text={`parcha:visit:${visitCode}`} size={120} />
        <p>{visitCode}</p>
      </div>
      <p className="rx-small">Please wait to be called. Show this at the doctor's door.</p>
    </div>,
    document.body,
  );
}

/** Shows only the sheet and opens the print dialog. */
/** Prints the sheet. `large` scales it up for someone who cannot see well. */
export function printPrescription(opts: { large?: boolean } = {}) {
  document.body.classList.add("printing-rx");
  if (opts.large) document.body.classList.add("rx-large");
  const done = () => {
    document.body.classList.remove("printing-rx", "rx-large");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
