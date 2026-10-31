import { DEFAULT_CENTRE, type Hospital, type LatLng } from "@parcha/core";
import { cn } from "@parcha/ui";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

import "./map.css";
import { currentLang, tr } from "../i18n";

/**
 * The basemap: OpenStreetMap's own tile server, which needs no key.
 *
 * That is right for a demo and light use. Its usage policy forbids heavy
 * traffic, so a real launch points `TILES` at self-hosted tiles or a keyed
 * provider; nothing else in the app needs to change.
 */
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** How many failed tiles before we stop pretending the map works. */
const GIVE_UP_AFTER = 8;

const CROSS = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

type Pin = Hospital & { km?: number };

/**
 * The hospitals on an open-source map, in the app's own colours.
 *
 * It shows three things at once. Where the hospitals are and which can be
 * chosen (coral pins; grey where they are not taking requests). Which one is
 * being asked right now (a pin that keeps pulsing), and which have already been
 * tried (dashed, with a dashed line showing the path the request has taken).
 * And, if the patient allows it, where they are.
 *
 * If the tiles cannot load (offline, blocked, a slow network) it says so and
 * stands down: the list of hospitals beside it is the real interface, and the
 * map is the nice part.
 */
export function HospitalMap({
  hospitals,
  selectedId,
  currentId,
  triedIds = [],
  me,
  onSelect,
  compact = false,
  zoomToSelected = false,
  className,
}: {
  hospitals: Pin[];
  selectedId?: string | null;
  /** The hospital being asked right now. */
  currentId?: string | null;
  /** Hospitals already tried, in the order they were tried. */
  triedIds?: string[];
  me?: LatLng | null;
  onSelect?: (id: string) => void;
  /** A small map: smaller pins, and only the hospital that matters is named. */
  compact?: boolean;
  /**
   * Choosing on the map: only the chosen hospital is named, and tapping one
   * flies to it, close enough to see its street.
   */
  zoomToSelected?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const failed = useRef(0);
  const [broken, setBroken] = useState(false);
  // The hospital the map last framed, so it only moves when the choice changes.
  const framed = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Make the map once.
  useEffect(() => {
    if (!host.current || map.current) return;
    const m = L.map(host.current, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false, // a page that scrolls should not be hijacked by its map
      tap: true,
    } as L.MapOptions).setView([DEFAULT_CENTRE.lat, DEFAULT_CENTRE.lng], 11);

    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(m);

    const tiles = L.tileLayer(TILES, {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
    });
    tiles.on("tileerror", () => {
      failed.current += 1;
      if (failed.current >= GIVE_UP_AFTER) setBroken(true);
    });
    tiles.on("tileload", () => {
      // Anything loading at all means the network is fine; forgive old errors.
      failed.current = 0;
      setBroken(false);
    });
    tiles.addTo(m);

    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // A new map has framed nothing yet (React can make it twice in development).
    framed.current = null;

    // The container can change size after mount (a screen settling in).
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current);

    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Draw the pins, the path and the patient whenever they change.
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();

    const points: L.LatLngExpression[] = [];

    for (const h of hospitals) {
      const state = [
        h.id === selectedId ? "is-selected" : "",
        h.id === currentId ? "is-current" : "",
        triedIds.includes(h.id) && h.id !== currentId ? "is-tried" : "",
        !h.accepting ? "is-closed" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const icon = L.divIcon({
        className: "",
        html: `<div class="pm-pin ${state}"><div class="pm-pin-body">${CROSS}</div></div>`,
        iconSize: [0, 0],
      });
      const marker = L.marker([h.lat, h.lng], { icon, keyboard: true, title: h.name }).addTo(g);
      // On a small map every name would sit on top of its neighbour, so only the
      // hospital being asked, or chosen, is labelled.
      if ((!compact && !zoomToSelected) || h.id === currentId || h.id === selectedId) {
        marker.bindTooltip(h.onParcha === false ? `${h.shortName} · ${tr(currentLang(), "not on Parcha yet", "अभी पर्चा पर नहीं", "abhi Parcha par nahi")}` : h.shortName, {
          permanent: true,
          direction: "top",
          offset: [0, -42],
          className: "pm-label",
        });
      }
      marker.on("click", () => onSelectRef.current?.(h.id));
      points.push([h.lat, h.lng]);
    }

    // The path a request has taken: tried hospitals, then the one asked now.
    const path = [...triedIds, ...(currentId && !triedIds.includes(currentId) ? [currentId] : [])]
      .map((id) => hospitals.find((h) => h.id === id))
      .filter((h): h is Pin => Boolean(h))
      .map((h) => [h.lat, h.lng] as L.LatLngTuple);
    if (path.length > 1) {
      L.polyline(path, {
        color: "#232326",
        weight: 3,
        dashArray: "2 9",
        lineCap: "round",
        opacity: 0.8,
      }).addTo(g);
    }

    if (me) {
      L.marker([me.lat, me.lng], {
        icon: L.divIcon({
          className: "",
          html: '<div class="pm-me"><i></i></div>',
          iconSize: [0, 0],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(g);
      points.push([me.lat, me.lng]);
    }

    // Measure first: a map framed before its box has a size stays at the wide view.
    m.invalidateSize();
    const chosen = zoomToSelected ? hospitals.find((h) => h.id === selectedId) : undefined;
    if (chosen) {
      if (framed.current !== chosen.id) {
        // After the first look, a tapped hospital is brought in close, to its street.
        if (framed.current === null && me) {
          // The patient, the suggestion and the few nearest others: the choices around them.
          const near = [...hospitals].sort((a, b) => (a.km ?? 0) - (b.km ?? 0)).slice(0, 5);
          m.fitBounds(L.latLngBounds([[me.lat, me.lng], [chosen.lat, chosen.lng], ...near.map((h) => [h.lat, h.lng] as L.LatLngTuple)]), { padding: [48, 48], maxZoom: 15, animate: false });
        }
        else m.setView([chosen.lat, chosen.lng], 16, { animate: false });
        framed.current = chosen.id;
      }
    } else if (points.length > 0) {
      m.fitBounds(L.latLngBounds(points), { padding: [56, 56], maxZoom: 13, animate: false });
    }
  }, [hospitals, selectedId, currentId, triedIds.join(","), me?.lat, me?.lng, compact, zoomToSelected]);

  return (
    <div className={cn("pm-map", compact && "pm-compact", className)}>
      <div ref={host} className="h-full w-full" role="application" aria-label="Map of hospitals" />
      {broken ? (
        <div className="pm-fallback">
          <p className="max-w-60 text-lg leading-snug font-bold">
            The map could not load. The hospital below is still the best choice for you.
          </p>
        </div>
      ) : null}
    </div>
  );
}
