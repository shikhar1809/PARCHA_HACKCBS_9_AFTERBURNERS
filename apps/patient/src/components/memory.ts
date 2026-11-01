/**
 * The Parchas on this phone, in the shape the recall functions read.
 *
 * One place does this conversion, because two screens need the same answer:
 * Ask, which looks a medicine up in it, and the QR a family shows a doctor. A
 * scanned slip is marked `certain` — its signature was checked here — and a
 * list checked off a pharmacy bill is not. A photograph of a slip carries no
 * readable medicines at all, so it holds no memory to answer from and stays in
 * the Parchas tab as the picture it is.
 */
import type { MemoryParcha } from "@parcha/core";
import { useMemo } from "react";

import { useKeptParchas } from "./parchas";

export function useMemoryParchas(person: string | null): MemoryParcha[] {
  const kept = useKeptParchas(person ?? "");
  return useMemo(() => {
    if (!person) return [];
    const out: MemoryParcha[] = [];
    kept.forEach((row, i) => {
      if (row.kind === "scanned") {
        const p = row.slip.payload;
        out.push({
          id: `scanned:${i}:${p.c}`,
          person: row.slip.person,
          savedAt: row.slip.savedAt,
          date: (p.t ?? row.slip.savedAt).slice(0, 10),
          doctor: p.d?.[0] ?? null,
          hospital: p.h ?? null,
          diagnosis: p.x ?? null,
          // Only a slip that arrived with the token its QR carried was
          // signature-checked on this phone. One put here any other way —
          // the demo's own sample Parchas among them — is shown as what the
          // family entered, because claiming a check that never happened is
          // the one thing a provenance label must never do.
          certain: !!row.slip.token,
          medicines: p.m.map(([name, strength, form, frequency, durationDays, timing, , instructions]) => ({
            name,
            strength,
            form,
            frequency,
            durationDays,
            timing,
            instructions: instructions ?? null,
          })),
        });
      } else if (row.kind === "checked") {
        out.push({
          id: `checked:${i}`,
          person: row.list.person,
          savedAt: row.list.savedAt,
          date: row.list.savedAt.slice(0, 10),
          certain: false,
          medicines: row.list.medicines.map((m) => ({ name: m.name, frequency: m.frequency })),
        });
      }
      // A photograph of a slip carries no readable medicines, so it holds no
      // memory to answer from. It stays in the Parchas tab as the picture it is.
    });
    return out;
  }, [kept, person]);
}
