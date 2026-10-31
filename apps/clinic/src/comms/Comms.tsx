import {
  createChannel,
  dmId,
  e2eSupported,
  errorMessage,
  isUnread,
  markRead,
  openDm,
  safetyCode,
  sendMessage,
  useAllergies,
  useCommsRead,
  useDeviceKey,
  useDevices,
  useMessages,
  usePatient,
  usePrescriptions,
  useTeam,
  useThreads,
  useTodaysVisits,
  useVisit,
  type CommsRef,
  type CommsTag,
  type CommsThread,
  type DeviceKey,
  type PublicDevice,
  type ReadMessage,
} from "@parcha/client";
import { ACCESS_NEEDS, STAGE_META, type Visit } from "@parcha/core";
import { cn } from "@parcha/ui";
import {
  ArrowLeft,
  AtSign,
  ChevronDown,
  ClipboardList,
  FileText,
  Hash,
  Loader2,
  Lock,
  MessagesSquare,
  Mic,
  Paperclip,
  Plus,
  Search,
  SendHorizontal,
  ShieldCheck,
  Square,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useIdentity, type Identity } from "../auth";
import { useVoice, type VoiceLang } from "./useVoice";

type Person = { uid: string; displayName: string; seatName?: string | null; onDuty?: boolean; active?: boolean };

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .replace(/^(Dr\.?|Sister)\s+/i, "")
    .replace(/[^\p{L}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** "Dr. A. Khan", "Rekha": a name without the role in brackets. */
const shortName = (name: string) => name.replace(/\s*\(.*?\)\s*/g, " ").trim();

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "sending…");

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * Talking inside the team, from anywhere in the app: a button at the bottom
 * right, or Ctrl+M. Channels for everyone at the hospital, and direct messages
 * only the two people can read. Every message is end-to-end encrypted on this
 * device; a patient is shared as a reference only, opened under the reader's
 * own rights.
 */
export function CommsDock() {
  const { identity } = useIdentity();
  if (!identity) return null;
  return <Dock me={identity} />;
}

function Dock({ me }: { me: Identity }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const threads = useThreads(me.uid);
  const read = useCommsRead(me.uid);
  const team = useTeam();
  const device = useDeviceKey(e2eSupported() ? me.uid : null);
  const devices = useDevices();
  const people: Person[] = useMemo(
    () => team.data.filter((p) => p.uid !== me.uid && p.active !== false).sort((a, b) => Number(!!b.onDuty) - Number(!!a.onDuty) || a.displayName.localeCompare(b.displayName)),
    [team.data, me.uid],
  );
  // Only the devices of people still on the team are written to.
  const active = useMemo(() => new Set([me.uid, ...people.map((p) => p.uid)]), [people, me.uid]);
  const readers = useMemo(() => devices.data.filter((d) => active.has(d.uid)), [devices.data, active]);
  const channels = threads.data.filter((t) => t.kind === "channel").sort((a, b) => (a.id === "general" ? -1 : b.id === "general" ? 1 : (a.name ?? "").localeCompare(b.name ?? "")));
  const unread = threads.data.filter((t) => isUnread(t, read, me.uid));
  const pinged = unread.filter((t) => t.kind === "dm" || t.lastMentions?.includes(me.uid));

  // Every hospital starts with one channel for everybody.
  const madeGeneral = useRef(false);
  useEffect(() => {
    if (threads.loading || threads.error || madeGeneral.current) return;
    if (!threads.data.some((t) => t.id === "general")) {
      madeGeneral.current = true;
      void createChannel(me.uid, "general", "Everyone at the hospital").catch(() => undefined);
    }
  }, [threads.loading, threads.error, threads.data, me.uid]);

  // Ctrl+M opens and closes it, from anywhere; Escape closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A direct message or a mention, arriving while the panel is shut or on
  // another thread, shows for a few seconds above the button: who, never what.
  const [toast, setToast] = useState<CommsThread | null>(null);
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (threads.loading) return;
    const before = seen.current;
    seen.current = new Map(threads.data.map((t) => [t.id, t.lastAt ?? ""]));
    if (!before) return;
    const fresh = threads.data.find(
      (t) => t.lastAt && t.lastAt !== before.get(t.id) && t.lastFromUid !== me.uid && (t.kind === "dm" || t.lastMentions?.includes(me.uid)) && !(open && current === t.id),
    );
    if (fresh) setToast(fresh);
  }, [threads.data, threads.loading, me.uid, open, current]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function go(threadId: string) {
    setCurrent(threadId);
    setOpen(true);
    setToast(null);
  }

  return (
    <>
      {open ? null : (
        <div className="fixed right-4 bottom-[5.5rem] z-[60] flex flex-col items-end gap-2 lg:bottom-4">
          {toast ? (
            <button type="button" onClick={() => go(toast.id)} className="pop max-w-72 rounded-2xl border-[3px] border-[#232326] bg-white p-3 text-left shadow-[3px_3px_0_#232326]">
              <span className="block text-xs font-bold tracking-wide uppercase">{toast.kind === "dm" ? "New message" : `Mentioned you in #${toast.name}`}</span>
              <span className="block text-sm font-bold">{toast.lastFromName}</span>
              <span className="flex items-center gap-1 text-xs">
                <Lock className="size-3" aria-hidden /> Open Messages to read it
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Messages${unread.length ? `, ${unread.length} unread` : ""}. Shortcut Control M.`}
            className="flex items-center gap-2 rounded-full border-[3px] border-[#232326] bg-[var(--brand)] py-2 pr-3 pl-2.5 text-base font-bold shadow-[3px_3px_0_#232326] active:translate-y-0.5"
          >
            <MessagesSquare className="size-5" aria-hidden />
            <span className="hidden sm:inline">Messages</span>
            {unread.length ? (
              <span className={cn("flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-sm text-white", pinged.length ? "bg-[#b3261e]" : "bg-[#232326]")}>{unread.length}</span>
            ) : null}
            <kbd className="hidden rounded-md border-2 border-[#232326]/40 bg-white/60 px-1.5 text-xs font-bold lg:inline">Ctrl M</kbd>
          </button>
        </div>
      )}

      {open ? (
        <Panel
          me={me}
          device={device.key}
          deviceError={e2eSupported() ? device.error : "This browser cannot encrypt messages, so Messages is off here."}
          readers={readers}
          channels={channels}
          dms={threads.data.filter((t) => t.kind === "dm")}
          people={people}
          read={read}
          current={current}
          setCurrent={setCurrent}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

type PanelProps = {
  me: Identity;
  device: DeviceKey | null;
  deviceError: string | null;
  readers: PublicDevice[];
  channels: CommsThread[];
  dms: CommsThread[];
  people: Person[];
  read: Record<string, string>;
  current: string | null;
  setCurrent: (id: string | null) => void;
  onClose: () => void;
};

function Panel(p: PanelProps) {
  const { me, current, people } = p;
  const thread = [...p.channels, ...p.dms].find((t) => t.id === current) ?? null;
  // A direct thread picked before it exists is shown while it is made.
  const pendingDm = current?.startsWith("dm_") && !thread ? current : null;
  const other = (() => {
    const uids = thread?.members ?? (current?.startsWith("dm_") ? current.replace(/^dm_/, "").split("_") : []);
    const uid = uids.find((u) => u !== me.uid);
    return people.find((x) => x.uid === uid) ?? null;
  })();

  return (
    <div
      role="dialog"
      aria-label="Messages"
      className="pop fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[var(--color-background)] sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(38rem,calc(100dvh-2rem))] sm:w-[min(52rem,calc(100vw-2rem))] sm:rounded-3xl sm:border-[3px] sm:border-[#232326] sm:shadow-[5px_5px_0_#232326]"
    >
      <div className="flex min-h-0 flex-1">
        <ThreadList {...p} hidden={!!current} />
        <section className={cn("min-w-0 flex-1 flex-col", current ? "flex" : "hidden sm:flex")}>
          {p.deviceError ? (
            <div className="m-auto max-w-xs p-6 text-center">
              <Lock className="mx-auto size-10" aria-hidden />
              <p className="mt-3 text-lg font-bold">Messages are off on this device</p>
              <p className="mt-1 text-base">{p.deviceError}</p>
            </div>
          ) : (thread || pendingDm) && current ? (
            <ThreadView
              key={current}
              me={me}
              device={p.device}
              readers={p.readers}
              thread={thread}
              threadId={current}
              other={other}
              people={people}
              onBack={() => p.setCurrent(null)}
              onClose={p.onClose}
            />
          ) : (
            <div className="m-auto max-w-xs p-6 text-center">
              <ShieldCheck className="mx-auto size-12" aria-hidden />
              <p className="mt-3 text-xl font-bold">Pick a channel or a person</p>
              <p className="mt-1 text-base">
                Every message is encrypted on this computer before it leaves. A direct message can be read only by the person you send it to. A patient is shared as a link, and opens only for someone allowed to see them.
              </p>
              <button type="button" onClick={p.onClose} className="mt-4 text-sm font-bold underline">
                Close (Ctrl+M or Esc)
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ThreadList({ me, channels, dms, people, read, current, setCurrent, onClose, hidden }: PanelProps & { hidden: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const shown = people.filter((p) => `${p.displayName} ${p.seatName ?? ""}`.toLowerCase().includes(filter.toLowerCase()));

  async function addChannel() {
    setError(null);
    try {
      const id = await createChannel(me.uid, name);
      setName("");
      setAdding(false);
      setCurrent(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function talkTo(uid: string) {
    setCurrent(dmId(me.uid, uid));
    try {
      await openDm(me.uid, uid);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <aside className={cn("w-full shrink-0 flex-col overflow-y-auto border-[#232326] bg-[var(--brand-soft)] p-2 sm:flex sm:w-60 sm:border-r-[3px]", hidden ? "hidden" : "flex")}>
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <p className="flex items-center gap-2 text-lg font-bold">
          <MessagesSquare className="size-5" aria-hidden /> Messages
        </p>
        <button type="button" onClick={onClose} aria-label="Close messages" className="flex size-9 items-center justify-center rounded-full hover:bg-black/10">
          <ChevronDown className="size-5" aria-hidden />
        </button>
      </div>

      <div className="flex items-center justify-between px-2 pt-1">
        <p className="text-xs font-bold tracking-wide uppercase">Channels</p>
        <button type="button" onClick={() => setAdding(!adding)} aria-label="Add a channel" className="flex size-7 items-center justify-center rounded-full hover:bg-black/10">
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      {adding ? (
        <form
          className="flex gap-1 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            void addChannel();
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. desk-and-doctors" aria-label="Channel name" className="min-w-0 flex-1 rounded-lg border-2 border-[#232326] bg-white px-2 py-1 text-sm" />
          <button type="submit" disabled={name.trim().length < 2} className="rounded-lg border-2 border-[#232326] bg-white px-2 text-sm font-bold disabled:opacity-50">
            Add
          </button>
        </form>
      ) : null}
      <ul className="space-y-0.5">
        {channels.map((c) => {
          const un = isUnread(c, read, me.uid);
          const mentioned = un && c.lastMentions?.includes(me.uid);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setCurrent(c.id)}
                aria-current={current === c.id ? "true" : undefined}
                className={cn("flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-base", current === c.id ? "bg-[#232326] text-white" : "hover:bg-black/10", un && "font-bold")}
              >
                <Hash className="size-4 shrink-0 opacity-70" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {mentioned ? <AtSign className="size-4 shrink-0 text-[#b3261e]" aria-label="Mentions you" /> : un ? <span className="size-2 rounded-full bg-current" aria-label="Unread" /> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="px-2 pt-4 pb-1 text-xs font-bold tracking-wide uppercase">Direct messages</p>
      {people.length > 6 ? (
        <label className="mx-1 mb-1 flex items-center gap-1.5 rounded-lg border-2 border-[#232326]/30 bg-white px-2">
          <Search className="size-4 shrink-0" aria-hidden />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a person" className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none" />
        </label>
      ) : null}
      <ul className="space-y-0.5">
        {shown.map((p) => {
          const id = dmId(me.uid, p.uid);
          const t = dms.find((d) => d.id === id);
          const un = !!t && isUnread(t, read, me.uid);
          return (
            <li key={p.uid}>
              <button
                type="button"
                onClick={() => void talkTo(p.uid)}
                aria-current={current === id ? "true" : undefined}
                className={cn("flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left", current === id ? "bg-[#232326] text-white" : "hover:bg-black/10")}
              >
                <span className="relative shrink-0">
                  <span className="flex size-8 items-center justify-center rounded-full border-2 border-[#232326] bg-white text-xs font-bold text-[#232326]">{initials(p.displayName)}</span>
                  <span className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-[#232326]", p.onDuty ? "bg-[#2e9e5b]" : "bg-[#b9b9b9]")} aria-label={p.onDuty ? "On duty" : "Off duty"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm leading-tight", un ? "font-bold" : "")}>{p.displayName}</span>
                  <span className="block truncate text-xs leading-tight opacity-75">{p.seatName ?? ""}</span>
                </span>
                {un ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#b3261e] px-1 text-xs font-bold text-white">•</span> : null}
              </button>
            </li>
          );
        })}
        {people.length === 0 ? <li className="px-2 text-sm">Nobody else is on the team yet.</li> : null}
      </ul>
      {error ? (
        <p role="alert" className="text-destructive px-2 pt-2 text-sm">
          {error}
        </p>
      ) : null}
      <p className="mt-auto hidden items-center gap-1 px-2 pt-4 text-xs opacity-70 sm:flex">
        <Lock className="size-3 shrink-0" aria-hidden /> End-to-end encrypted. Ctrl+M opens and closes.
      </p>
    </aside>
  );
}

function ThreadView({
  me,
  device,
  readers,
  thread,
  threadId,
  other,
  people,
  onBack,
  onClose,
}: {
  me: Identity;
  device: DeviceKey | null;
  readers: PublicDevice[];
  thread: CommsThread | null;
  threadId: string;
  other: Person | null;
  people: Person[];
  onBack: () => void;
  onClose: () => void;
}) {
  const messages = useMessages(thread ? threadId : null, device);
  const bottom = useRef<HTMLDivElement>(null);
  const isDm = threadId.startsWith("dm_");

  // The safety code: the same on both people's screens when no key was swapped.
  const [code, setCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const pair = useMemo(() => (isDm && other ? readers.filter((d) => d.uid === me.uid || d.uid === other.uid) : []), [isDm, other, readers, me.uid]);
  useEffect(() => {
    if (pair.length) void safetyCode(pair).then(setCode);
  }, [pair]);

  // Reading it marks it read; so does a new message arriving while it is open.
  const last = messages.data.at(-1)?.id;
  useEffect(() => {
    if (thread) void markRead(me.uid, threadId).catch(() => undefined);
  }, [thread, last, me.uid, threadId]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [last]);

  let lastDay = "";
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b-[3px] border-[#232326] px-3 py-2">
        <button type="button" onClick={onBack} aria-label="Back to the list" className="flex size-9 items-center justify-center rounded-full hover:bg-black/10 sm:hidden">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-tight font-bold">
            {thread?.kind === "channel" ? (
              <span className="flex items-center gap-1">
                <Hash className="size-5" aria-hidden />
                {thread.name}
              </span>
            ) : (
              (other?.displayName ?? "Direct message")
            )}
          </p>
          <p className="flex items-center gap-1 truncate text-sm">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {thread?.kind === "channel"
              ? `Encrypted · ${thread.topic || "everyone at the hospital"}`
              : `Encrypted · only you and ${other ? shortName(other.displayName) : "them"}${other?.seatName ? ` (${other.seatName})` : ""}`}
          </p>
        </div>
        {isDm && code ? (
          <button type="button" onClick={() => setShowCode(!showCode)} aria-expanded={showCode} className="flex items-center gap-1 rounded-full border-2 border-[#232326] px-2 py-1 text-xs font-bold">
            <ShieldCheck className="size-4" aria-hidden /> Safety code
          </button>
        ) : null}
        <button type="button" onClick={onClose} aria-label="Close messages" className="flex size-9 items-center justify-center rounded-full hover:bg-black/10">
          <X className="size-5" aria-hidden />
        </button>
      </header>
      {showCode && code ? (
        <div className="shrink-0 border-b-2 border-[#232326]/20 bg-[var(--brand-soft)] px-3 py-2 text-sm">
          <p className="font-mono text-lg font-bold tracking-wider">{code}</p>
          <p>If {other ? shortName(other.displayName) : "they"} sees the same code, nobody has slipped a key in between you. Compare it face to face, not over Messages.</p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {messages.loading || !thread ? (
          <p className="flex items-center gap-2 p-4 text-base">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Opening…
          </p>
        ) : messages.error ? (
          <p role="alert" className="text-destructive p-4 text-base">
            {messages.error}
          </p>
        ) : messages.data.length === 0 ? (
          <p className="p-6 text-center text-base opacity-80">No messages yet. Say hello, or press the microphone and speak.</p>
        ) : (
          <ol className="space-y-0.5">
            {messages.data.map((m, i) => {
              const prev = messages.data[i - 1];
              const day = m.at ? dayLabel(m.at) : lastDay;
              const newDay = day !== lastDay;
              lastDay = day;
              const grouped = !newDay && prev && prev.fromUid === m.fromUid && prev.at && m.at && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60_000;
              return (
                <li key={m.id}>
                  {newDay ? (
                    <p className="my-2 flex items-center gap-2 text-xs font-bold tracking-wide uppercase opacity-70">
                      <span className="h-px flex-1 bg-[#232326]/25" />
                      {day}
                      <span className="h-px flex-1 bg-[#232326]/25" />
                    </p>
                  ) : null}
                  <Message m={m} me={me} people={people} grouped={!!grouped} />
                </li>
              );
            })}
          </ol>
        )}
        <div ref={bottom} />
      </div>

      {thread && device ? <Composer me={me} device={device} readers={readers} thread={thread} people={people} /> : null}
    </>
  );
}

/**
 * Text with each "@Name" of someone on the team picked out, and each "@" visit
 * or prescription turned into a chip that shows a quick view on hover and opens
 * the visit on a click.
 */
function withMentions(text: string, names: string[], meName: string, tags: CommsTag[] = []) {
  const byLabel = new Map(tags.map((t) => [`@${t.label}`, t]));
  const sorted = [...names.map((n) => `@${n}`), ...byLabel.keys()].sort((a, b) => b.length - a.length);
  if (!sorted.length) return text;
  const re = new RegExp(`(${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  // Splitting on a capturing group puts each match at an odd index.
  return text.split(re).map((part, i) => {
    if (i % 2 === 0) return part;
    const tag = byLabel.get(part);
    if (tag) return <RefChip key={i} tag={tag} />;
    return (
      <b key={i} className={cn("rounded px-0.5", part === `@${meName}` ? "bg-[oklch(0.9_0.12_85)]" : "bg-[var(--brand-soft)]")}>
        {part}
      </b>
    );
  });
}

function Message({ m, me, people, grouped }: { m: ReadMessage; me: Identity; people: Person[]; grouped: boolean }) {
  const mentionsMe = m.mentions?.includes(me.uid);
  const names = [me.displayName, ...people.map((p) => p.displayName)];
  return (
    <div className={cn("group flex gap-2.5 rounded-xl px-1.5", grouped ? "py-0.5" : "pt-2 pb-0.5", mentionsMe && "bg-[oklch(0.96_0.06_85)]")}>
      <span className="w-9 shrink-0">
        {grouped ? null : (
          <span className={cn("flex size-9 items-center justify-center rounded-full border-2 border-[#232326] text-xs font-bold", m.fromUid === me.uid ? "bg-[var(--brand)]" : "bg-white")}>{initials(m.fromName)}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        {grouped ? null : (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-bold">{m.fromName}</span>
            {m.fromRole ? <span className="text-xs opacity-75">{m.fromRole}</span> : null}
            <span className="text-xs opacity-60">{clock(m.at)}</span>
          </p>
        )}
        {m.body ? (
          <>
            {m.body.text ? (
              <p className="text-base leading-snug break-words whitespace-pre-wrap">
                {m.body.voice ? <Mic className="mr-1 inline size-3.5 align-[-2px] opacity-60" aria-label="Spoken" /> : null}
                {withMentions(m.body.text, names, me.displayName, m.body.tags)}
              </p>
            ) : null}
            {m.body.ref ? <RefCard r={m.body.ref} /> : null}
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-sm italic opacity-70">
            <Lock className="size-3.5" aria-hidden />
            {m.unreadable === "opening"
              ? "Opening…"
              : m.unreadable === "not-for-this-device"
                ? "Sent before this device could read messages."
                : "This message could not be opened."}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ references */

/** Where this person can open a visit, if anywhere. */
function useVisitLink(visitId: string, stage: string | undefined): string | null {
  const { identity } = useIdentity();
  if (!identity) return null;
  if (identity.counters.includes("doctor")) return stage === "proposed" ? `/doctor/requests/${visitId}` : `/doctor/${visitId}`;
  if (identity.counters.includes("compounder")) return stage === "requested" ? `/desk/requests/${visitId}` : `/intake/${visitId}`;
  return null;
}

const REF_LABEL: Record<CommsRef["kind"], string> = { patient: "Patient record", visit: "Visit and vitals", prescription: "Prescription" };
const REF_ICON: Record<CommsRef["kind"], typeof UserRound> = { patient: UserRound, visit: ClipboardList, prescription: FileText };

function vitalsLine(v: Visit["vitals"]) {
  if (!v) return null;
  const parts = [
    v.systolicMmhg && v.diastolicMmhg ? `BP ${v.systolicMmhg}/${v.diastolicMmhg}` : null,
    v.pulseBpm ? `Pulse ${v.pulseBpm}` : null,
    v.temperatureC ? `Temp ${v.temperatureC}°C` : null,
    v.spo2Pct ? `SpO₂ ${v.spo2Pct}%` : null,
    v.bloodSugarMgdl ? `Sugar ${v.bloodSugarMgdl}` : null,
    v.weightKg ? `${v.weightKg} kg` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A shared patient, opened here. The message held only an id: the name and
 * the details are read now, with this person's own rights.
 */
function RefCard({ r, startOpen = false }: { r: CommsRef; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const visitId = r.kind === "patient" ? null : r.visitId;
  const visit = useVisit(visitId);
  const patient = usePatient(r.kind === "patient" ? r.patientId : null);
  const allergies = useAllergies(open && r.kind === "patient" ? r.patientId : null);
  const rx = usePrescriptions(open && r.kind === "prescription" ? visitId : null);
  const v = visit.data;
  const p = patient.data;
  const link = useVisitLink(visitId ?? "", v?.stage);
  const loading = r.kind === "patient" ? patient.loading : visit.loading;
  const blocked = !loading && (r.kind === "patient" ? !p : !v);
  const name = r.kind === "patient" ? p?.fullName : v?.patientName;
  const Icon = REF_ICON[r.kind];
  const latest = rx.data[0];

  return (
    <div className="mt-1 max-w-md rounded-xl border-[3px] border-[#232326] bg-white">
      <button type="button" disabled={blocked} onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 p-2 text-left">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border-2 border-[#232326] bg-[var(--brand-soft)]">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-tight font-bold">{loading ? "Opening…" : blocked ? "A patient (not visible to you)" : name}</span>
          <span className="block text-xs">
            {REF_LABEL[r.kind]}
            {v?.visitCode ? ` · ${v.visitCode}` : ""}
            {blocked ? " · shared with someone who can open it" : ""}
          </span>
        </span>
        {blocked ? <Lock className="size-4 shrink-0" aria-hidden /> : <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />}
      </button>
      {open && !blocked ? (
        <div className="space-y-1.5 border-t-2 border-[#232326]/20 p-2 text-sm">
          {r.kind === "patient" && p ? (
            <>
              <p>
                {p.statedAgeYears != null ? `${p.statedAgeYears} y` : "Age not given"}
                {p.sex ? ` · ${p.sex === "female" ? "F" : p.sex === "male" ? "M" : "Other"}` : ""}
              </p>
              {p.accessNeeds?.length ? <p>Needs: {p.accessNeeds.map((n) => ACCESS_NEEDS.find((a) => a.id === n)?.short ?? n).join(", ")}</p> : null}
              <p>
                <b>Allergies:</b> {allergies.loading ? "…" : allergies.data.length ? allergies.data.map((a) => a.label).join(", ") : "none recorded"}
              </p>
            </>
          ) : v ? (
            <>
              <p>
                <b>{STAGE_META[v.stage]?.label ?? v.stage}</b>
                {v.patientAgeYears != null ? ` · ${v.patientAgeYears} y` : ""}
                {v.patientSex ? ` · ${v.patientSex === "female" ? "F" : v.patientSex === "male" ? "M" : "Other"}` : ""}
              </p>
              {v.complaint ? <p>Came for: {v.complaint}</p> : null}
              {r.kind === "visit" ? <p>{vitalsLine(v.vitals) ?? "No vitals taken yet."}</p> : null}
              {r.kind === "prescription" ? (
                latest ? (
                  <ul className="rounded-lg bg-[var(--brand-soft)] p-1.5">
                    {latest.diagnosisText ? <li className="font-bold">{latest.diagnosisText}</li> : null}
                    {latest.items.map((it, i) => (
                      <li key={i}>
                        {it.drugName} {it.strength} · {it.frequency} · {it.durationDays} days
                      </li>
                    ))}
                  </ul>
                ) : rx.loading ? null : (
                  <p>No prescription signed yet.</p>
                )
              ) : null}
              {link ? (
                <Link to={link} className="inline-block font-bold underline">
                  Open the visit
                </Link>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A visit or prescription named in a message: a chip in the line of text.
 * Hovering (or focusing) it shows the quick view; clicking opens the visit
 * where this person works on it, or keeps the quick view open if they have no
 * screen for it.
 */
function RefChip({ tag }: { tag: CommsTag }) {
  const [peek, setPeek] = useState(false);
  const [pinned, setPinned] = useState(false);
  const visitId = tag.ref.kind === "patient" ? null : tag.ref.visitId;
  const visit = useVisit(peek || pinned ? visitId : null);
  const link = useVisitLink(visitId ?? "", visit.data?.stage);
  const navigate = useNavigate();
  const Icon = REF_ICON[tag.ref.kind];
  return (
    <span className="relative inline-block align-baseline" onMouseEnter={() => setPeek(true)} onMouseLeave={() => setPeek(false)}>
      <button
        type="button"
        onFocus={() => setPeek(true)}
        onBlur={() => setPeek(false)}
        onClick={() => (link ? navigate(link) : setPinned(!pinned))}
        title={link ? "Open it" : "Show it"}
        className="inline-flex items-center gap-1 rounded-md border-2 border-[#232326] bg-[var(--brand-soft)] px-1.5 text-sm font-bold hover:bg-[var(--brand)]"
      >
        <Icon className="size-3.5" aria-hidden />
        {tag.label}
      </button>
      {peek || pinned ? (
        <span className="absolute top-full left-0 z-30 block w-80 pt-1" role="tooltip">
          <RefCard r={tag.ref} startOpen />
        </span>
      ) : null}
    </span>
  );
}

/** "Active prescription #12 · Sunita Devi", "Visit #12 · Sunita Devi": what a chip says. */
function tagsFor(v: Visit): CommsTag[] {
  const token = v.tokenNumber ? ` #${v.tokenNumber}` : "";
  const out: CommsTag[] = [{ label: `Visit${token} · ${v.patientName}`, ref: { kind: "visit", visitId: v.id } }];
  if (v.stage === "prescribed") out.unshift({ label: `${v.dispensedAt ? "Prescription" : "Active prescription"}${token} · ${v.patientName}`, ref: { kind: "prescription", visitId: v.id } });
  return out;
}

/** Today's patients to share, and what of theirs: the record, the visit or the prescription. */
function PatientPicker({ onPick, onClose }: { onPick: (r: CommsRef) => void; onClose: () => void }) {
  const today = useTodaysVisits(true);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Visit | null>(null);
  const found = today.data
    .filter((v) => v.stage !== "cancelled")
    .filter((v) => `${v.patientName} ${v.visitCode}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);
  const what: { ref: CommsRef; label: string; detail: string; ok: boolean }[] = chosen
    ? [
        { ref: { kind: "patient", patientId: chosen.patientId }, label: "Patient record", detail: "Age, needs and allergies", ok: true },
        { ref: { kind: "visit", visitId: chosen.id }, label: "This visit", detail: "Where it stands, why they came, vitals", ok: true },
        { ref: { kind: "prescription", visitId: chosen.id }, label: "Prescription", detail: chosen.stage === "prescribed" ? "The signed medicines" : "Not signed yet", ok: chosen.stage === "prescribed" },
      ]
    : [];

  return (
    <div className="absolute right-2 bottom-full left-2 mb-1 rounded-2xl border-[3px] border-[#232326] bg-white p-2 shadow-[3px_3px_0_#232326]">
      <div className="flex items-center gap-2">
        {chosen ? (
          <button type="button" onClick={() => setChosen(null)} aria-label="Back to the list" className="rounded-full p-1 hover:bg-black/10">
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        ) : null}
        {chosen ? (
          <p className="min-w-0 flex-1 truncate text-base font-bold">Share {chosen.patientName}: what?</p>
        ) : (
          <label className="flex flex-1 items-center gap-1.5 rounded-lg border-2 border-[#232326] px-2">
            <Search className="size-4 shrink-0" aria-hidden />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Today's patient: name or visit code" aria-label="Find a patient" className="min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none" />
          </label>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-black/10">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <p className="mt-1 flex items-center gap-1 px-1 text-xs opacity-80">
        <Lock className="size-3 shrink-0" aria-hidden /> Only a link is sent. It opens for people allowed to see this patient.
      </p>
      {chosen ? (
        <ul className="mt-1.5 space-y-1">
          {what.map((w) => {
            const Icon = REF_ICON[w.ref.kind];
            return (
              <li key={w.ref.kind}>
                <button type="button" disabled={!w.ok} onClick={() => onPick(w.ref)} className="flex w-full items-center gap-2 rounded-lg border-2 border-[#232326] px-2 py-1.5 text-left hover:bg-[var(--brand-soft)] disabled:opacity-45">
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold">{w.label}</span>
                    <span className="block text-xs">{w.detail}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="mt-1 max-h-56 overflow-y-auto">
          {today.loading ? (
            <li className="flex items-center gap-2 p-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading today's visits…
            </li>
          ) : found.length === 0 ? (
            <li className="p-2 text-sm">{q ? "Nobody today by that name." : "No visits today yet."}</li>
          ) : (
            found.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => setChosen(v)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/10">
                  <UserRound className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-base font-bold">{v.patientName}</span>
                  <span className="shrink-0 text-xs">
                    {v.visitCode} · {STAGE_META[v.stage]?.label ?? v.stage}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ composer */

const LANG_KEY = "parcha.comms.voice";

function Composer({ me, device, readers, thread, people }: { me: Identity; device: DeviceKey; readers: PublicDevice[]; thread: CommsThread; people: Person[] }) {
  const [text, setText] = useState("");
  const [ref, setRef] = useState<CommsRef | null>(null);
  const [tags, setTags] = useState<CommsTag[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<VoiceLang>(() => {
    try {
      return localStorage.getItem(LANG_KEY) === "hi-IN" ? "hi-IN" : "en-IN";
    } catch {
      return "en-IN";
    }
  });
  const box = useRef<HTMLTextAreaElement>(null);

  // Who can be @mentioned here: everyone in a channel, the other person in a direct thread.
  const mentionable = thread.kind === "channel" ? people : people.filter((p) => thread.members?.includes(p.uid));
  const at = /(^|\s)@([^\s@]*)$/.exec(text);
  const q = at?.[2].toLowerCase().replace(/^#/, "") ?? "";
  const today = useTodaysVisits(at !== null);
  // People first, then today's visits and prescriptions: by name, token number or visit code.
  const suggestions: ({ kind: "person"; p: Person } | { kind: "tag"; tag: CommsTag; v: Visit })[] = at
    ? [
        ...mentionable.filter((p) => p.displayName.toLowerCase().includes(q)).slice(0, 4).map((p) => ({ kind: "person" as const, p })),
        ...today.data
          .filter((v) => !["cancelled", "requested", "proposed"].includes(v.stage))
          .filter((v) => !q || v.patientName.toLowerCase().includes(q) || String(v.tokenNumber ?? "") === q || (v.visitCode ?? "").toLowerCase().includes(q) || (v.stage === "prescribed" && (q === "rx" || (q.length >= 2 && "prescription".startsWith(q)))))
          .sort((a, b) => (b.tokenNumber ?? 0) - (a.tokenNumber ?? 0))
          .flatMap((v) => tagsFor(v).map((tag) => ({ kind: "tag" as const, tag, v })))
          .slice(0, 6),
      ].slice(0, 8)
    : [];

  async function send(body: string, voice = false) {
    const clean = body.trim();
    if (!clean && !ref) return;
    setBusy(true);
    setError(null);
    try {
      const mentions = mentionable.filter((p) => clean.includes(`@${p.displayName}`)).map((p) => p.uid);
      await sendMessage(thread, { uid: me.uid, name: me.displayName, role: me.seatName }, device, readers, { text: clean, voice, ref, mentions, tags });
      setText("");
      setRef(null);
      setTags([]);
      box.current?.focus();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const voice = useVoice(lang, (heard) => void send(heard, true));

  function pick(s: (typeof suggestions)[number]) {
    const label = s.kind === "person" ? s.p.displayName : s.tag.label;
    if (s.kind === "tag") setTags((all) => [...all.filter((t) => t.label !== s.tag.label), s.tag]);
    setText(text.replace(/@([^\s@]*)$/, `@${label} `));
    box.current?.focus();
  }

  const RefIcon = ref ? REF_ICON[ref.kind] : UserRound;

  return (
    <div className="relative shrink-0 border-t-[3px] border-[#232326] p-2">
      {suggestions.length ? (
        <ul className="absolute right-2 bottom-full left-2 mb-1 rounded-xl border-[3px] border-[#232326] bg-white p-1 shadow-[3px_3px_0_#232326]" role="listbox" aria-label="Mention someone, a visit or a prescription">
          {suggestions.map((s) => {
            const Icon = s.kind === "person" ? AtSign : REF_ICON[s.tag.ref.kind];
            return (
              <li key={s.kind === "person" ? s.p.uid : s.tag.label}>
                <button type="button" onClick={() => pick(s)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-black/10">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {s.kind === "person" ? (
                    <>
                      <b>{s.p.displayName}</b> <span className="opacity-70">{s.p.seatName}</span>
                    </>
                  ) : (
                    <>
                      <b className="truncate">{s.tag.label}</b>
                      <span className="ml-auto shrink-0 opacity-70">{STAGE_META[s.v.stage]?.label ?? s.v.stage}</span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {attaching ? <PatientPicker onPick={(r) => (setRef(r), setAttaching(false))} onClose={() => setAttaching(false)} /> : null}

      {ref ? (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg border-2 border-[#232326] bg-[var(--brand-soft)] px-2 py-1 text-sm">
          <RefIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Sharing a link: <b>{REF_LABEL[ref.kind]}</b>
          </span>
          <button type="button" onClick={() => setRef(null)} aria-label="Remove the link" className="rounded-full p-0.5 hover:bg-black/10">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {voice.listening ? (
        <div className="flex items-center gap-2 rounded-xl border-[3px] border-[#b3261e] bg-[oklch(0.96_0.03_25)] p-2" role="status">
          <span className="relative flex size-3 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#b3261e] opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-[#b3261e]" />
          </span>
          <p className="min-w-0 flex-1 text-base">{voice.heard || (lang === "hi-IN" ? "बोलिए…" : "Listening on this computer… speak now")}</p>
          <button type="button" onClick={voice.cancel} className="rounded-lg px-2 py-1 text-sm font-bold underline">
            Cancel
          </button>
          <button type="button" onClick={voice.stop} className="flex items-center gap-1.5 rounded-lg border-[3px] border-[#232326] bg-[var(--brand)] px-3 py-1.5 text-sm font-bold">
            <Square className="size-3.5 fill-current" aria-hidden /> Stop and send
          </button>
        </div>
      ) : (
        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <button type="button" onClick={() => setAttaching(!attaching)} aria-label="Share a patient" aria-expanded={attaching} className="flex size-10 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-white">
            <Paperclip className="size-5" aria-hidden />
          </button>
          <textarea
            ref={box}
            autoFocus
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !suggestions.length) {
                e.preventDefault();
                void send(text);
              } else if ((e.key === "Enter" || e.key === "Tab") && suggestions.length) {
                e.preventDefault();
                pick(suggestions[0]);
              }
            }}
            placeholder={thread.kind === "channel" ? `Message #${thread.name} · @ a person, a token number or a patient` : "Write a message · @ a token number or a patient"}
            aria-label="Message"
            className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-xl border-[3px] border-[#232326] bg-white px-3 py-1.5 text-base outline-none [field-sizing:content] focus:bg-[var(--hover-soft)]"
          />
          <button
            type="button"
            onClick={() => {
              const next = lang === "en-IN" ? "hi-IN" : "en-IN";
              setLang(next);
              try {
                localStorage.setItem(LANG_KEY, next);
              } catch {
                /* remembered for now only */
              }
            }}
            aria-label={`Voice language: ${lang === "hi-IN" ? "Hindi" : "English"}. Change it.`}
            className="h-10 shrink-0 rounded-xl border-[3px] border-[#232326] bg-white px-1.5 text-xs font-bold"
          >
            {lang === "hi-IN" ? "हिं" : "EN"}
          </button>
          <button
            type="button"
            onClick={() => void voice.start()}
            disabled={voice.preparing}
            aria-label="Speak a message (recognised on this computer)"
            title="Speak a message. Recognised on this computer; the sound is never sent."
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-white disabled:opacity-60"
          >
            {voice.preparing ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Mic className="size-5" aria-hidden />}
          </button>
          <button type="submit" disabled={busy || (!text.trim() && !ref)} aria-label="Send" className="flex size-10 shrink-0 items-center justify-center rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] disabled:opacity-45">
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <SendHorizontal className="size-5" aria-hidden />}
          </button>
        </form>
      )}
      {error || voice.error ? (
        <p role="alert" className="text-destructive pt-1 text-sm">
          {error ?? voice.error}
        </p>
      ) : null}
    </div>
  );
}

