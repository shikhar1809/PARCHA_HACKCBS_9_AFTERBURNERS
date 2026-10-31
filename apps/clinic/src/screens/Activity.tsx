import { useActivity } from "@parcha/client";
import type { ActivityEntry } from "@parcha/core";
import { AppBar, cn, Screen } from "@parcha/ui";
import { Globe, MapPin, Search, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";

const FILTERS = [
  { id: "all", label: "Everything", match: () => true },
  { id: "patients", label: "Patients", match: (e: ActivityEntry) => /^(patient|visit|request|prescription)\./.test(e.kind) },
  { id: "sessions", label: "Sign-ins", match: (e: ActivityEntry) => e.kind.startsWith("session.") },
  { id: "team", label: "Team", match: (e: ActivityEntry) => /^(team|doctor)\./.test(e.kind) },
] as const;

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

/**
 * Who did what, in sentences. Every line is written by the server when the
 * thing happens, with the address it came from and where the device was, so a
 * doctor can answer "who changed this, and from where" without asking anyone.
 */
export function Activity() {
  const log = useActivity({ max: 300 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [q, setQ] = useState("");

  const days = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const needle = q.trim().toLowerCase();
    const shown = log.data.filter((e) => e.at && f.match(e) && (!needle || e.text.toLowerCase().includes(needle)));
    const out: { day: string; items: ActivityEntry[] }[] = [];
    for (const e of shown) {
      const d = day(e.at);
      if (out.at(-1)?.day !== d) out.push({ day: d, items: [] });
      out.at(-1)!.items.push(e);
    }
    return out;
  }, [log.data, filter, q]);

  return (
    <>
      <AppBar title="Activity" subtitle="Who did what, from where" />
      <Screen className="space-y-4 p-4">
        <div className="space-y-3">
          <label className="flex h-12 items-center gap-2 rounded-2xl border-[3px] border-[#232326] bg-white px-3">
            <Search className="size-5 shrink-0" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a name, a medicine, a person"
              aria-label="Search the activity"
              className="min-w-0 flex-1 bg-transparent text-base outline-none"
            />
          </label>
          <div role="tablist" aria-label="Show" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border-2 border-[#232326] px-3.5 py-1.5 text-sm font-bold",
                  filter === f.id ? "bg-[#232326] text-white" : "bg-white",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {log.error ? (
          <p role="alert" className="text-destructive text-base">
            Could not load the activity. {log.error}
          </p>
        ) : log.loading && log.data.length === 0 ? (
          <p className="text-muted-foreground text-base">Loading…</p>
        ) : days.length === 0 ? (
          <p className="text-muted-foreground text-base">
            {log.data.length === 0 ? "Nothing has happened here yet." : "Nothing matches."}
          </p>
        ) : (
          days.map((d) => (
            <section key={d.day} aria-label={d.day}>
              <h2 className="mb-2 text-sm font-bold tracking-wide uppercase">{d.day}</h2>
              <ol className="space-y-2">
                {d.items.map((e) => {
                  const ended = e.kind === "session.ended";
                  return (
                    <li
                      key={e.id}
                      className={cn(
                        "grid grid-cols-[4.5rem_1fr] gap-3 rounded-xl border-2 border-[#232326] p-3",
                        ended ? "bg-[oklch(0.88_0.1_25)]" : "bg-white",
                      )}
                    >
                      <time dateTime={e.at} className="pt-0.5 text-sm font-bold tabular-nums">
                        {time(e.at)}
                      </time>
                      <div className="min-w-0">
                        <p className="flex items-start gap-1.5 text-base leading-snug">
                          {ended ? <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-label="Session ended" /> : null}
                          <span>{e.text}</span>
                        </p>
                        {e.place || e.ip ? (
                          <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                            {e.place ? (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="size-3.5" aria-hidden /> {e.place}
                              </span>
                            ) : null}
                            {e.ip ? (
                              <span className="inline-flex items-center gap-1 break-all">
                                <Globe className="size-3.5" aria-hidden /> {e.ip}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
      </Screen>
    </>
  );
}
