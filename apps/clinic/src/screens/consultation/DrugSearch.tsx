import { searchDrugs, type Drug, type DrugHit } from "@parcha/core";
import { PenLine, Plus, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { FIELD } from "../../bits";

/** The name with the part the doctor typed picked out in bold. */
function Highlight({ hit, query }: { hit: DrugHit; query: string }) {
  const q = query.trim().length;
  const { name, at } = hit;
  if (at === null || at < 0 || q === 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <strong className="bg-[var(--hover-soft)]">{name.slice(at, at + q)}</strong>
      {name.slice(at + q)}
    </>
  );
}

/** What to show under a hit: the brand it matched, or the brands it is sold as. */
/**
 * Under each result: how it was found, its formula, and what else has the
 * same formula, so the doctor can write whatever the chemist stocks.
 */
function Sub({ hit }: { hit: DrugHit }) {
  const { drug } = hit;
  const how =
    hit.via === "brand"
      ? `Brand of ${hit.formula}`
      : hit.via === "ingredient"
        ? `Contains ${hit.name}: ${hit.formula}`
        : hit.via === "class"
          ? `${drug.drugClass}`
          : drug.drugClass;
  const others = hit.sameFormula.filter((n) => n !== hit.name).slice(0, 4);
  return (
    <span className="text-muted-foreground block text-sm leading-snug">
      <span className="block truncate">
        {how}
        {hit.strength ? ` · ${hit.strength}` : drug.defaultStrength ? ` · ${drug.defaultStrength}` : ""}
      </span>
      {others.length ? <span className="block truncate">Same formula: {others.join(", ")}</span> : null}
    </span>
  );
}

/**
 * A search box for the medicine register that answers as the doctor types.
 *
 * "para" brings up Paracetamol; a brand brings up the generic it stands for; a
 * slip of the finger ("parcetamol") still finds it. Up and Down move through
 * the list and Enter picks, so a doctor never has to leave the keyboard.
 *
 * A medicine that is not in the list can still be written, by hand, as the
 * last choice (or with Enter when nothing matches). It goes on the
 * prescription marked as not safety-checked.
 */
export function DrugSearch({
  drugs,
  onPick,
  onWrite,
  placeholder = "Medicine, brand, formula or class",
}: {
  drugs: Drug[];
  /** The medicine, and the strength the query named, if it comes in it. */
  onPick: (drug: Drug, strength: string | null) => void;
  /** Writes what was typed as a medicine that is not in the list. */
  onWrite?: (name: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const hits = useMemo(() => searchDrugs(drugs, query, 7), [drugs, query]);
  const open = query.trim().length >= 2;
  const current = Math.min(active, Math.max(hits.length - 1, 0));

  function pick(hit: DrugHit) {
    onPick(hit.drug, hit.strength);
    setQuery("");
    setActive(0);
  }
  function write() {
    if (!onWrite || query.trim().length < 2) return;
    onWrite(query.trim());
    setQuery("");
    setActive(0);
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" />
        <input
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={hits[current] ? `${listId}-${current}` : undefined}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && hits[current]) {
              e.preventDefault();
              pick(hits[current]);
            } else if (e.key === "Enter" && hits.length === 0) {
              e.preventDefault();
              write();
            } else if (e.key === "Escape") {
              setQuery("");
            }
          }}
          placeholder={placeholder}
          className={`${FIELD} pl-10`}
        />
      </div>

      {open && hits.length > 0 ? (
        <ul id={listId} role="listbox" className="mt-2 space-y-2">
          {hits.map((hit, i) => (
            <li key={hit.drug.id} role="option" id={`${listId}-${i}`} aria-selected={i === current}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(hit)}
                className={`flex w-full items-center gap-3 rounded-xl border-[3px] border-[#232326] px-3 py-2.5 text-left ${
                  i === current ? "bg-[var(--hover-soft)]" : "bg-card"
                }`}
              >
                <Plus className="size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-base leading-tight">
                    {hit.name === hit.drug.genericName ? (
                      <Highlight hit={hit} query={query} />
                    ) : (
                      <>
                        <Highlight hit={hit} query={query} /> · {hit.drug.genericName}
                      </>
                    )}
                  </span>
                  <Sub hit={hit} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : open ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Nothing in the medicine register matches “{query}”.
        </p>
      ) : null}
      {open && onWrite ? (
        <button
          type="button"
          onClick={write}
          className="mt-2 flex w-full items-center gap-3 rounded-xl border-[3px] border-dashed border-[#232326] bg-card px-3 py-2.5 text-left"
        >
          <PenLine className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-base leading-tight">
              Write “{query.trim()}” by hand{hits.length === 0 ? <span className="text-sm opacity-70"> · Enter</span> : null}
            </span>
            <span className="text-muted-foreground block text-sm">Not in the list, so the safety check cannot read it</span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * Suggestions for the word being typed in the free-text box. Clicking one
 * swaps the half-typed word for the register's name, so the dictation box
 * reads the same way whether it was spoken or typed.
 */
export function WordSuggest({
  drugs,
  text,
  onReplace,
}: {
  drugs: Drug[];
  text: string;
  onReplace: (next: string) => void;
}) {
  const word = /([A-Za-z][A-Za-z-]{2,})$/.exec(text)?.[1] ?? "";
  const hits = useMemo(
    () => (word ? searchDrugs(drugs, word, 4).filter((h) => h.score >= 40) : []),
    [drugs, word],
  );
  const first = hits[0]?.drug.genericName.toLowerCase();
  if (hits.length === 0 || (hits.length === 1 && first === word.toLowerCase())) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Medicine suggestions">
      <span className="text-sm">Did you mean</span>
      {hits.map((h) => (
        <button
          key={h.drug.id}
          type="button"
          onClick={() => onReplace(text.slice(0, text.length - word.length) + h.drug.genericName + " ")}
          className="rounded-full border-[3px] border-[#232326] bg-card px-3 py-1 text-base"
        >
          {h.drug.genericName}
        </button>
      ))}
    </div>
  );
}
