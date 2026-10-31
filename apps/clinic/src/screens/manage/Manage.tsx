import {
  assignSeat,
  changeManagePin,
  closeManage,
  connectTeamMembers,
  createTeamMember,
  disconnectTeamMembers,
  deleteSeat,
  errorMessage,
  manageState,
  manageStats,
  openManage,
  saveSeat,
  saveSettings,
  setMemberActive,
  useRoutes,
  useTeam,
  type ManageSeat,
  type ClinicStatus,
  type ManageState,
  type ManageStats,
} from "@parcha/client";
import { ABILITIES, PIN_RE, rupees, type Ability, type BillLine, type SessionRules } from "@parcha/core";
import { AppBar, cn, Screen } from "@parcha/ui";
import { Check, KeyRound, Loader2, Lock, Plus, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Btn, Card, FIELD, Label } from "../../bits";
import { Wiring } from "../team/Wiring";
import { Running } from "./Running";

/** The pass the PIN gave. In memory only: a reload asks for the PIN again. */
let pass: { token: string; expiresAt: number } | null = null;
const passValid = () => !!pass && pass.expiresAt > Date.now();
const needsPin = (e: unknown) => String((e as Error)?.message ?? "").includes("MANAGE_PIN");

const SECTIONS = [
  { id: "running", label: "The clinic, running" },
  { id: "team", label: "People" },
  { id: "seats", label: "Roles" },
  { id: "flow", label: "Who sends to whom" },
  { id: "stats", label: "Stats" },
  { id: "clinic", label: "Clinic" },
  { id: "pin", label: "PIN" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

/**
 * Management: the people, the roles each holds (one or several), what each
 * role can do, the clinic's settings, and the PIN. Opens with the Manage PIN on top of the person's own
 * sign-in; every change is in the activity log.
 */
export function Manage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(passValid());
  const [state, setState] = useState<ManageState | null>(null);
  const [params] = useSearchParams();
  const [section, setSection] = useState<Section>(() => (SECTIONS.some((s) => s.id === params.get("section")) ? (params.get("section") as Section) : "team"));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!pass) return;
    try {
      setState(await manageState(pass.token));
      setError(null);
    } catch (e) {
      if (needsPin(e)) {
        pass = null;
        setOpen(false);
      } else setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /** Runs a change, then reloads; a lapsed pass goes back to the PIN. */
  const act = useCallback(
    async (fn: (token: string) => Promise<unknown>) => {
      if (!pass) return setOpen(false);
      setError(null);
      try {
        await fn(pass.token);
        pass.expiresAt = Date.now() + 15 * 60_000;
        await load();
        return true;
      } catch (e) {
        if (needsPin(e)) {
          pass = null;
          setOpen(false);
        } else setError(errorMessage(e));
        return false;
      }
    },
    [load],
  );

  async function leave() {
    pass = null;
    await closeManage().catch(() => undefined);
    navigate("/");
  }

  if (!open) return <PinPad onOpen={() => setOpen(true)} />;

  return (
    <>
      <AppBar
        title="Management"
        subtitle={state?.clinic.name || "Your clinic"}
        action={
          <Btn onClick={() => void leave()}>
            <Lock className="size-4" aria-hidden /> Lock
          </Btn>
        }
      />
      <Screen className="space-y-4 p-4">
        <div role="tablist" aria-label="Manage" className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "rounded-full border-[3px] border-[#232326] px-4 py-1.5 text-base font-bold",
                section === s.id ? "bg-[#232326] text-white" : "bg-white",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-base">
            {error}
          </p>
        ) : null}

        {!state ? (
          <p className="flex items-center gap-2 text-base">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : section === "running" ? (
          <Running state={state} />
        ) : section === "stats" ? (
          <Stats />
        ) : section === "seats" ? (
          <Seats state={state} act={act} />
        ) : section === "flow" ? (
          <Flow act={act} />
        ) : section === "team" ? (
          <Team state={state} act={act} />
        ) : section === "clinic" ? (
          <ClinicSettings state={state} act={act} />
        ) : (
          <ChangePin act={act} />
        )}
      </Screen>
    </>
  );
}

type Act = (fn: (token: string) => Promise<unknown>) => Promise<boolean | void>;

/* ------------------------------------------------------------------ flow */

/** Who sends patients to whom: the Team page's picture, editable here. */
function Flow({ act }: { act: Act }) {
  const team = useTeam();
  const routes = useRoutes();
  const people = team.data.filter((p) => p.active !== false);
  if (team.loading) return <p className="text-base">Loading the team…</p>;
  return (
    <Wiring
      people={people}
      routes={routes.data}
      canEdit
      onConnect={async (from, to) => {
        await act((token) => connectTeamMembers(token, from, to));
      }}
      onDisconnect={async (from, to) => {
        await act((token) => disconnectTeamMembers(token, from, to));
      }}
    />
  );
}

/* ------------------------------------------------------------------ PIN pad */

function PinPad({ onOpen }: { onOpen: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: string) {
    if (!PIN_RE.test(value)) return;
    setBusy(true);
    setError(null);
    try {
      pass = await openManage(value);
      onOpen();
    } catch (e) {
      setError(errorMessage(e));
      setPin("");
      setBusy(false);
    }
  }

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
  };

  return (
    <>
      <AppBar title="Management" subtitle="Enter the Manage PIN" />
      <Screen className="grid place-items-center p-4">
        <form
          className="w-full max-w-xs text-center"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(pin);
          }}
        >
          <span className="mx-auto flex size-14 items-center justify-center rounded-full border-[3px] border-[#232326] bg-[var(--brand)]">
            <KeyRound className="size-7" aria-hidden />
          </span>
          <p className="mt-3 text-base">People, roles and the clinic's settings open with the PIN.</p>
          <input
            aria-label="Manage PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            type="password"
            autoComplete="off"
            autoFocus
            className={cn(FIELD, "mt-4 text-center text-3xl tracking-[0.5em]")}
          />
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} type="button" onClick={() => press(d)} className="h-14 rounded-2xl border-[3px] border-[#232326] bg-white text-2xl font-bold shadow-[0_3px_0_#232326] active:translate-y-0.5">
                {d}
              </button>
            ))}
            <button type="button" aria-label="Delete a digit" onClick={() => setPin((p) => p.slice(0, -1))} className="h-14 rounded-2xl border-[3px] border-[#232326] bg-white text-base font-bold shadow-[0_3px_0_#232326] active:translate-y-0.5">
              Delete
            </button>
            <button type="button" onClick={() => press("0")} className="h-14 rounded-2xl border-[3px] border-[#232326] bg-white text-2xl font-bold shadow-[0_3px_0_#232326] active:translate-y-0.5">
              0
            </button>
            <button type="submit" disabled={busy || !PIN_RE.test(pin)} className="h-14 rounded-2xl border-[3px] border-[#232326] bg-[var(--brand)] text-base font-bold shadow-[0_3px_0_#232326] active:translate-y-0.5 disabled:opacity-45">
              {busy ? <Loader2 className="mx-auto size-5 animate-spin" aria-label="Checking" /> : "Open"}
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-destructive mt-4 text-base">
              {error}
            </p>
          ) : null}
        </form>
      </Screen>
    </>
  );
}

/* ------------------------------------------------------------------ seats */

function AbilityToggles({ value, onChange }: { value: Ability[]; onChange: (v: Ability[]) => void }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {ABILITIES.map((a) => {
        const on = value.includes(a.id);
        return (
          <li key={a.id}>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => onChange(on ? value.filter((x) => x !== a.id) : [...value, a.id])}
              className={cn(
                "flex h-full w-full items-start gap-2.5 rounded-xl border-[3px] border-[#232326] p-2.5 text-left",
                on ? "bg-[var(--brand-soft)]" : "bg-white",
              )}
            >
              <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-[3px] border-[#232326]", on ? "bg-[#232326] text-white" : "bg-white")}>
                {on ? <Check className="size-3.5" strokeWidth={4} aria-hidden /> : null}
              </span>
              <span>
                <span className="block text-sm font-bold">{a.label}</span>
                <span className="block text-xs leading-snug">{a.detail}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SeatCard({ seat, members, act }: { seat: ManageSeat; members: number; act: Act }) {
  const [name, setName] = useState(seat.name);
  const [abilities, setAbilities] = useState<Ability[]>(seat.abilities);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== seat.name || [...abilities].sort().join() !== [...seat.abilities].sort().join();
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <input aria-label="Role name" className={cn(FIELD, "text-lg font-bold")} value={name} onChange={(e) => setName(e.target.value)} />
        <span className="shrink-0 text-sm">
          {members} {members === 1 ? "person" : "people"}
        </span>
      </div>
      <AbilityToggles value={abilities} onChange={setAbilities} />
      <div className="flex flex-wrap gap-2">
        <Btn
          kind="primary"
          disabled={!dirty || busy || name.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            await act((t) => saveSeat(t, { id: seat.id, name: name.trim(), abilities }));
            setBusy(false);
          }}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} Save role
        </Btn>
        {members === 0 ? (
          <Btn kind="danger" disabled={busy} onClick={() => void act((t) => deleteSeat(t, seat.id))}>
            <Trash2 className="size-4" aria-hidden /> Remove
          </Btn>
        ) : null}
      </div>
    </Card>
  );
}

function Seats({ state, act }: { state: ManageState; act: Act }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [abilities, setAbilities] = useState<Ability[]>([]);
  return (
    <div className="space-y-3">
      <p className="text-base">
        A role is what a person can do. Change a role and everyone who holds it changes at once. A person can hold several roles; what they can do adds up. Anyone who can consult is a doctor that patients can be sent to.
      </p>
      {state.seats.map((s) => (
        <SeatCard key={`${s.id}:${s.name}:${s.abilities.join()}`} seat={s} members={state.team.filter((m) => m.seatIds.includes(s.id)).length} act={act} />
      ))}
      {adding ? (
        <Card className="space-y-3">
          <Label>New role</Label>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Triage nurse" autoFocus />
          <AbilityToggles value={abilities} onChange={setAbilities} />
          <div className="flex gap-2">
            <Btn
              kind="primary"
              disabled={name.trim().length < 2}
              onClick={async () => {
                if (await act((t) => saveSeat(t, { name: name.trim(), abilities }))) {
                  setAdding(false);
                  setName("");
                  setAbilities([]);
                }
              }}
            >
              <Check className="size-4" aria-hidden /> Add role
            </Btn>
            <Btn onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        </Card>
      ) : (
        <Btn onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden /> Add a role
        </Btn>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ team */

/** Role chips: tap to give or take away. Several can be on at once. */
function RolePicker({ seats, value, onChange, disabled, label }: { seats: ManageSeat[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {seats.map((s) => {
        const on = value.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== s.id) : [...value, s.id])}
            className={cn(
              "flex items-center gap-1.5 rounded-full border-[3px] border-[#232326] px-3 py-1 text-sm font-bold disabled:opacity-50",
              on ? "bg-[#232326] text-white" : "bg-white",
            )}
          >
            {on ? <Check className="size-3.5" strokeWidth={3.5} aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

/** One person's roles, saved when changed. Taking away the last one is not allowed. */
function MemberRoles({ member, seats, act }: { member: ManageState["team"][number]; seats: ManageSeat[]; act: Act }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <RolePicker
        seats={seats}
        value={member.seatIds}
        disabled={!member.active || busy}
        label={`Roles for ${member.displayName}`}
        onChange={async (ids) => {
          if (ids.length === 0) return;
          setBusy(true);
          await act((t) => assignSeat(t, member.uid, ids));
          setBusy(false);
        }}
      />
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin" aria-label="Saving" /> : null}
    </div>
  );
}

function Team({ state, act }: { state: ManageState; act: Act }) {
  const [adding, setAdding] = useState(false);
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [seatIds, setSeatIds] = useState<string[]>(state.seats[0] ? [state.seats[0].id] : []);
  const [department, setDepartment] = useState("");
  const consults = state.seats.some((s) => seatIds.includes(s.id) && s.abilities.includes("consult"));

  return (
    <div className="space-y-3">
      {made ? (
        <Card tone="ok" className="space-y-1">
          <p className="text-lg font-bold">Added. Pass these on once; they will not be shown again.</p>
          <p className="text-base">
            Sign in: <b>{made.email}</b>
          </p>
          <p className="text-base">
            First password: <b className="font-mono text-lg tracking-wide">{made.password}</b>
          </p>
          <Btn onClick={() => setMade(null)}>
            <X className="size-4" aria-hidden /> Done
          </Btn>
        </Card>
      ) : null}

      <ul className="space-y-2">
        {state.team.map((m) => (
          <li key={m.uid} className={cn("space-y-2 rounded-2xl border-[3px] border-[#232326] p-3", m.active ? "bg-card" : "bg-[oklch(0.94_0.01_85)] opacity-80")}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold">
                  {m.displayName} {m.uid === state.me ? <span className="text-sm font-normal">(you)</span> : null}
                </p>
                <p className="truncate text-sm">{m.email}{m.active ? "" : " · deactivated"}</p>
              </div>
              {m.uid === state.me ? null : (
                <Btn kind={m.active ? "danger" : "quiet"} onClick={() => void act((t) => setMemberActive(t, m.uid, !m.active))}>
                  {m.active ? "Deactivate" : "Bring back"}
                </Btn>
              )}
            </div>
            <MemberRoles key={m.seatIds.join()} member={m} seats={state.seats} act={act} />
          </li>
        ))}
      </ul>

      {adding ? (
        <Card className="space-y-3">
          <Label>Add a person</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Dr. P. Rao or Grace" autoFocus />
            <input className={FIELD} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email to sign in with" type="email" />
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm font-bold">Roles (one or more)</p>
              <RolePicker seats={state.seats} value={seatIds} onChange={setSeatIds} label="Roles for the new person" />
            </div>
            {consults ? <input className={FIELD} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Department, e.g. Paediatrics" /> : null}
          </div>
          <div className="flex gap-2">
            <Btn
              kind="primary"
              disabled={name.trim().length < 2 || !email.includes("@") || seatIds.length === 0}
              onClick={async () => {
                let result: { email: string; password: string } | null = null;
                const ok = await act(async (t) => {
                  result = await createTeamMember(t, { displayName: name.trim(), email: email.trim(), seatIds, department: department.trim() || undefined });
                });
                if (ok && result) {
                  setMade(result);
                  setAdding(false);
                  setName("");
                  setEmail("");
                  setDepartment("");
                }
              }}
            >
              <UserPlus className="size-4" aria-hidden /> Add
            </Btn>
            <Btn onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        </Card>
      ) : (
        <Btn onClick={() => setAdding(true)}>
          <UserPlus className="size-4" aria-hidden /> Add a person
        </Btn>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ clinic */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

/** The clinic's price list: a name and a price per line, added, changed or removed here. */
function Charges({ value, onChange }: { value: BillLine[]; onChange: (v: BillLine[]) => void }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const add = () => {
    const l = label.trim();
    if (!l || value.some((c) => c.label.toLowerCase() === l.toLowerCase())) return;
    onChange([...value, { label: l.slice(0, 60), amount: Number(amount) || 0 }]);
    setLabel("");
    setAmount("");
  };
  return (
    <div className="space-y-2">
      {value.length ? (
        <ul className="space-y-1.5">
          {value.map((c, i) => (
            <li key={c.label} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-base font-bold">{c.label}</span>
              <span className="text-base font-bold">₹</span>
              <input
                className={cn(FIELD, "max-w-28 shrink-0 text-right tabular-nums")}
                inputMode="numeric"
                value={c.amount || ""}
                placeholder="0"
                aria-label={`Price of ${c.label}`}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/\D/g, "").slice(0, 7)) || 0 } : x)))}
              />
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded-lg p-2 hover:bg-black/10">
                <Trash2 className="size-5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">No charges yet besides the consultation.</p>
      )}
      <div className="flex items-center gap-2">
        <input className={cn(FIELD, "min-w-0 flex-1")} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="Dressing, X-ray, ECG..." aria-label="New charge" />
        <span className="text-base font-bold">₹</span>
        <input className={cn(FIELD, "max-w-28 shrink-0 text-right tabular-nums")} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="0" aria-label="Its price" />
        <Btn onClick={add} disabled={!label.trim()}>
          <Plus className="size-4" aria-hidden /> Add
        </Btn>
      </div>
    </div>
  );
}

function ClinicSettings({ state, act }: { state: ManageState; act: Act }) {
  const [clinic, setClinic] = useState(state.clinic);
  const [rules, setRules] = useState<SessionRules>(state.sessionRules);
  const [status, setStatus] = useState<ClinicStatus>(state.status);
  const [dept, setDept] = useState("");
  const [saved, setSaved] = useState(false);
  const addDept = () => {
    const d = dept.trim();
    if (d && !status.departments.includes(d)) setStatus({ ...status, departments: [...status.departments, d] });
    setDept("");
  };
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-lg font-bold">Patients and requests</p>
        <p className="text-sm">What patients see in the app when they look for a clinic, and which requests reach your desk.</p>
        <Switch
          on={status.accepting}
          onChange={(accepting) => setStatus({ ...status, accepting })}
          title="Taking requests from the app"
          detail="Off: patients can still walk in, but the app sends their requests to the next clinic."
        />
        <div className={cn("grid gap-3 sm:grid-cols-2", !status.accepting && "pointer-events-none opacity-45")}>
          <Switch
            on={status.acceptsNew}
            onChange={(acceptsNew) => setStatus({ ...status, acceptsNew })}
            title="New problems"
            detail="Someone unwell who has not seen you for this before."
          />
          <Switch
            on={status.acceptsFollowUp}
            onChange={(acceptsFollowUp) => setStatus({ ...status, acceptsFollowUp })}
            title="Follow-ups"
            detail="A patient coming back to their own doctor."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="How busy are you now">
            <div role="radiogroup" aria-label="How busy" className="flex gap-2">
              {(["low", "medium", "high"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={status.load === l}
                  onClick={() => setStatus({ ...status, load: l })}
                  className={cn("flex-1 rounded-xl border-[3px] border-[#232326] py-2 text-base font-bold", status.load === l ? "bg-[#232326] text-white" : "bg-white")}
                >
                  {l === "low" ? "Quiet" : l === "medium" ? "Busy" : "Full"}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Answer each request within">
            <select className={FIELD} value={status.respondMinutes} onChange={(e) => setStatus({ ...status, respondMinutes: Number(e.target.value) })}>
              {[10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </Row>
        </div>
        <Row label="Consultation fee (₹), shown to patients and used by billing">
          <input
            className={FIELD}
            inputMode="numeric"
            value={status.consultationFee ?? ""}
            placeholder="Not set"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setStatus({ ...status, consultationFee: v ? Number(v) : null });
            }}
          />
        </Row>
        <Row label="Other charges (₹): one tap each at billing">
          <Charges value={status.charges} onChange={(charges) => setStatus({ ...status, charges })} />
        </Row>
        <Row label="Razorpay payment page: billing shows it as a QR for the patient to pay online">
          <input
            className={FIELD}
            inputMode="url"
            value={status.razorpayPage ?? ""}
            placeholder="https://rzp.io/rzp/..."
            onChange={(e) => setStatus({ ...status, razorpayPage: e.target.value.trim() || null })}
          />
        </Row>
        <Row label="Departments">
          <div className="space-y-2">
            {status.departments.length ? (
              <ul className="flex flex-wrap gap-2">
                {status.departments.map((d) => (
                  <li key={d} className="flex items-center gap-1 rounded-full border-2 border-[#232326] bg-white py-1 pr-1 pl-3 text-sm font-bold">
                    {d}
                    <button
                      type="button"
                      aria-label={`Remove ${d}`}
                      onClick={() => setStatus({ ...status, departments: status.departments.filter((x) => x !== d) })}
                      className="rounded-full p-0.5 hover:bg-black/10"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">None yet. Patients see you as a general clinic.</p>
            )}
            <div className="flex gap-2">
              <input
                className={FIELD}
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addDept();
                }}
                placeholder="e.g. Paediatrics"
                aria-label="Add a department"
              />
              <Btn onClick={addDept} disabled={!dept.trim()}>
                <Plus className="size-4" aria-hidden /> Add
              </Btn>
            </div>
          </div>
        </Row>
      </Card>

      <Card className="space-y-3">
        <p className="text-lg font-bold">The clinic</p>
        <Row label="Name">
          <input className={FIELD} value={clinic.name} onChange={(e) => setClinic({ ...clinic, name: e.target.value })} />
        </Row>
        <Row label="Address">
          <input className={FIELD} value={clinic.address} onChange={(e) => setClinic({ ...clinic, address: e.target.value })} />
        </Row>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Phone">
            <input className={FIELD} value={clinic.phone} onChange={(e) => setClinic({ ...clinic, phone: e.target.value })} />
          </Row>
          <Row label="Opening hours">
            <input className={FIELD} value={clinic.hours} onChange={(e) => setClinic({ ...clinic, hours: e.target.value })} placeholder="e.g. 9 am to 8 pm" />
          </Row>
        </div>
      </Card>

      <Card className="space-y-3">
        <p className="text-lg font-bold">Staff sessions</p>
        <p className="text-sm">A session is pinned to where it opened. These decide when it ends.</p>
        <Row label="End the session when a device moves more than">
          <select className={FIELD} value={rules.moveLimitM} onChange={(e) => setRules({ ...rules, moveLimitM: Number(e.target.value) })}>
            {[100, 300, 500, 1000, 2000, 5000].map((m) => (
              <option key={m} value={m}>
                {m < 1000 ? `${m} metres` : `${m / 1000} km`}
              </option>
            ))}
          </select>
        </Row>
        <Switch
          on={rules.endOnIpChange}
          onChange={(endOnIpChange) => setRules({ ...rules, endOnIpChange })}
          title="End the session if the internet address changes"
          detail="Strict, and the default. Off: the change is written in the activity log and the session carries on (useful on mobile data)."
        />
      </Card>

      <div className="flex items-center gap-3">
        <Btn
          kind="primary"
          onClick={async () => {
            setSaved(false);
            if (await act((t) => saveSettings(t, { clinic, sessionRules: rules, status }))) setSaved(true);
          }}
        >
          <Check className="size-4" aria-hidden /> Save settings
        </Btn>
        {saved ? <span role="status" className="text-base font-bold">Saved.</span> : null}
      </div>
    </div>
  );
}

function Switch({ on, onChange, title, detail }: { on: boolean; onChange: (on: boolean) => void; title: string; detail: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-start gap-3 rounded-xl border-[3px] border-[#232326] bg-white p-3 text-left"
    >
      <span className={cn("mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border-[3px] border-[#232326] p-0.5", on ? "justify-end bg-[var(--brand)]" : "justify-start bg-white")}>
        <span className="size-3.5 rounded-full bg-[#232326]" />
      </span>
      <span>
        <span className="block text-base font-bold">{title}</span>
        <span className="block text-sm">{detail}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ stats */

const fmtMin = (m: number | null) => (m == null ? "–" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

function Stats() {
  const [days, setDays] = useState<1 | 7 | 30>(1);
  const [stats, setStats] = useState<ManageStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setStats(null);
    setError(null);
    if (!pass) return;
    manageStats(pass.token, days)
      .then((s) => live && setStats(s))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [days]);

  const peak = stats ? Math.max(1, ...stats.byHour) : 1;
  // Only the clinic's working hours: from the first to the last hour anyone came.
  const hours = stats ? stats.byHour.map((n, h) => ({ n, h })).filter(({ h }) => h >= Math.min(8, firstHour(stats.byHour)) && h <= Math.max(20, lastHour(stats.byHour))) : [];
  // Of the requests that were decided: one still inside its time is neither answered nor missed.
  const decided = stats ? stats.requests.answered + stats.requests.timedOut + stats.requests.declined : 0;
  const answeredShare = stats && decided ? Math.round((stats.requests.answered / decided) * 100) : null;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Period" className="flex gap-2">
        {([1, 7, 30] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={days === d}
            onClick={() => setDays(d)}
            className={cn("rounded-full border-2 border-[#232326] px-3.5 py-1.5 text-sm font-bold", days === d ? "bg-[#232326] text-white" : "bg-white")}
          >
            {d === 1 ? "Today" : `Last ${d} days`}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-base">
          {error}
        </p>
      ) : !stats ? (
        <p className="flex items-center gap-2 text-base">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Counting…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Patients" value={String(stats.visits.total)} note={`${stats.visits.walkIns} walked in, ${stats.visits.fromRequests} from the app`} />
            <Tile label="Prescriptions signed" value={String(stats.visits.prescribed)} note={stats.visits.waitingNow ? `${stats.visits.waitingNow} still waiting` : "Nobody waiting"} />
            <Tile label="Wait for the doctor" value={fmtMin(stats.minutes.waitForDoctor)} note={`Whole visit ${fmtMin(stats.minutes.wholeVisit)}`} />
            <Tile
              label="Requests answered"
              value={answeredShare == null ? "–" : `${answeredShare}%`}
              note={
                stats.requests.asked
                  ? [`${stats.requests.answered} answered`, stats.requests.timedOut ? `${stats.requests.timedOut} ran out of time` : null, stats.requests.declined ? `${stats.requests.declined} passed on` : null, stats.requests.waiting ? `${stats.requests.waiting} waiting now` : null].filter(Boolean).join(", ")
                  : "No requests"
              }
              warn={answeredShare != null && answeredShare < 80}
            />
          </div>

          <Card className="space-y-3">
            <p className="text-lg font-bold">When patients arrive</p>
            {stats.visits.total === 0 ? (
              <p className="text-sm">Nobody yet in this period.</p>
            ) : (
              <div className="flex h-36 items-end gap-1" role="img" aria-label={`Busiest hour: ${hourLabel(stats.byHour.indexOf(peak))}`}>
                {hours.map(({ n, h }) => (
                  <div key={h} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-xs font-bold">{n || ""}</span>
                    <div
                      className={cn("w-full rounded-t-md border-2 border-b-0 border-[#232326]", n === peak ? "bg-[var(--brand)]" : "bg-[var(--brand-soft)]")}
                      style={{ height: `${Math.max(n ? 6 : 0, (n / peak) * 100)}%` }}
                      title={`${hourLabel(h)}: ${n}`}
                    />
                    <span className="text-[10px] whitespace-nowrap">{h % 2 === 0 ? hourLabel(h) : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2">
              <p className="text-lg font-bold">Each doctor</p>
              {stats.doctors.length === 0 ? (
                <p className="text-sm">No prescriptions signed in this period.</p>
              ) : (
                <ul className="divide-y-2 divide-[#232326]/15">
                  {stats.doctors.map((d) => (
                    <li key={d.name} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="text-base font-bold">{d.name}</span>
                      <span className="text-sm whitespace-nowrap">
                        {d.seen} {d.seen === 1 ? "patient" : "patients"} · {fmtMin(d.consultation)} each
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="space-y-2">
              <p className="text-lg font-bold">Where the time goes</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-base">
                <dt>Arrival to vitals done</dt>
                <dd className="font-bold">{fmtMin(stats.minutes.waitForVitals)}</dd>
                <dt>Vitals to the doctor</dt>
                <dd className="font-bold">{fmtMin(stats.minutes.waitForDoctor)}</dd>
                <dt>With the doctor</dt>
                <dd className="font-bold">{fmtMin(stats.minutes.consultation)}</dd>
                <dt>Cancelled visits</dt>
                <dd className="font-bold">{stats.visits.cancelled}</dd>
              </dl>
            </Card>
          </div>

          {stats.counters.dispensed || stats.counters.billedTotal || stats.counters.unpaid ? (
            <Card className="space-y-2">
              <p className="text-lg font-bold">Pharmacy and billing</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-base">
                <dt>Prescriptions given out</dt>
                <dd className="font-bold">{stats.counters.dispensed}</dd>
                <dt>Billed</dt>
                <dd className="font-bold">{rupees(stats.counters.billedTotal)}</dd>
                <dt>Bills paid / not yet paid</dt>
                <dd className="font-bold">
                  {stats.counters.paid} / {stats.counters.unpaid}
                </dd>
              </dl>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

const firstHour = (xs: number[]) => {
  const i = xs.findIndex((n) => n > 0);
  return i < 0 ? 8 : i;
};
const lastHour = (xs: number[]) => {
  const i = xs.map((n) => n > 0).lastIndexOf(true);
  return i < 0 ? 20 : i;
};

function Tile({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <Card tone={warn ? "warn" : "plain"} className="space-y-1">
      <p className="text-sm font-bold">{label}</p>
      <p className="text-3xl leading-none font-bold tabular-nums">{value}</p>
      <p className="text-sm">{note}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ PIN */

function ChangePin({ act }: { act: Act }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  return (
    <Card className="max-w-md space-y-3">
      <p className="text-lg font-bold">Change the Manage PIN</p>
      <p className="text-sm">You may be asked for your own password first.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <input aria-label="New PIN" className={cn(FIELD, "text-center text-2xl tracking-[0.4em]")} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="new-password" placeholder="New" />
        <input aria-label="New PIN again" className={cn(FIELD, "text-center text-2xl tracking-[0.4em]")} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="new-password" placeholder="Again" />
      </div>
      {mismatch ? <p role="alert" className="text-destructive text-base">The two PINs are not the same.</p> : null}
      {done ? <p role="status" className="text-base font-bold">The PIN is changed.</p> : null}
      <Btn
        kind="primary"
        disabled={!PIN_RE.test(pin)}
        onClick={async () => {
          setDone(false);
          setMismatch(pin !== pin2);
          if (pin !== pin2) return;
          if (await act((t) => changeManagePin(t, pin))) {
            setDone(true);
            setPin("");
            setPin2("");
          }
        }}
      >
        <KeyRound className="size-4" aria-hidden /> Change PIN
      </Btn>
    </Card>
  );
}
