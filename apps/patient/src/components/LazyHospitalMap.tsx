/**
 * The map, loaded only when a screen shows it.
 *
 * The map library is the heaviest thing the app carries and most screens never
 * draw a map, so it arrives as its own file after the screen is already up. A
 * shimmer holds its place meanwhile, and if the file cannot be fetched (a weak
 * connection) the screen carries on without the map instead of failing: every
 * place the map appears also lists the same hospitals as cards.
 */
import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from "react";

const Inner = lazy(() => import("./HospitalMap").then((m) => ({ default: m.HospitalMap })));

type Props = ComponentProps<typeof Inner>;

class MapBoundary extends Component<{ className?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className={`flex items-center justify-center rounded-3xl border-[3px] border-[#232326] bg-[#faf5ea] p-4 text-center text-base font-bold ${this.props.className ?? ""}`}
      >
        The map could not load. Choose from the list below.
      </div>
    );
  }
}

export function HospitalMap(props: Props) {
  return (
    <MapBoundary className={props.className}>
      <Suspense
        fallback={
          <div
            role="status"
            aria-label="Loading the map"
            className={`skeleton rounded-3xl border-[3px] border-[#232326] ${props.className ?? ""}`}
          />
        }
      >
        <Inner {...props} />
      </Suspense>
    </MapBoundary>
  );
}
