import { useRoutes, useTeam } from "@parcha/client";
import { isOnDuty, type Account } from "@parcha/core";
import { AppBar, Screen } from "@parcha/ui";
import { CheckCircle2, Lock, TriangleAlert, UserPlus } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useIdentity } from "../auth";
import { Btn, Card } from "../bits";
import { useNow } from "./Sla";
import { problemFor } from "./team/geometry";
import { Wiring } from "./team/Wiring";

/**
 * The team, drawn as the route a patient takes.
 *
 * In a hospital there are many desks and doctors, and who sends
 * patients to whom is a decision somebody has to be able to see and change.
 * So it is a picture: desks on the left, doctors on
 * the right, and a wire for each "sends patients to". A card with a dead end
 * says so on its face, because a doctor nobody sends patients to is a
 * misconfiguration that would otherwise only show up as an empty queue.
 *
 * Here it is for looking at, by everyone. Changing it is in Management, behind
 * the Manage PIN, with people and roles.
 */
export function Team() {
  const { identity } = useIdentity();
  const team = useTeam();
  const routes = useRoutes();

  const people = useMemo(
    () => team.data.filter((p) => p.active !== false),
    [team.data],
  );
  const issues = useMemo(
    () =>
      people
        .map((p) => ({ p, problem: problemFor(p, routes.data) }))
        .filter((x) => x.problem !== null),
    [people, routes.data],
  );

  const count = (t: string) => people.filter((p) => p.accountType === t).length;
  // One doctor who does everything: there is no flow between people to draw.
  const solo = people.length > 0 && people.every((p) => p.abilities?.includes("register") && p.abilities?.includes("consult"));
  const admin = identity?.admin === true;

  return (
    <>
      <AppBar
        title="Team"
        subtitle={solo ? "One doctor does everything" : `${count("staff")} desks · ${count("doctor")} doctors`}
        action={
          // Adding people and choosing their seats is on the Manage page, behind the PIN.
          admin ? (
            <Link
              to="/manage"
              className="inline-flex items-center justify-center gap-2 rounded-xl border-[3px] border-[#232326] bg-[var(--brand)] px-4 py-2.5 text-base shadow-[0_3px_0_#232326]"
            >
              <UserPlus className="size-5" />
              <span className="hidden sm:inline">Add person</span>
            </Link>
          ) : null
        }
      />

      <Screen className="@container space-y-5 p-4">

        {team.error || routes.error ? (
          <p role="alert" className="text-destructive text-base">
            Could not load the team. {team.error ?? routes.error}
          </p>
        ) : null}

        {solo ? (
          <Card tone="ok">
            <p className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="size-6" aria-hidden />
              {people.length === 1 ? `${people[0].displayName} registers, takes vitals, prescribes and runs the clinic.` : "Each doctor registers, takes vitals and prescribes."}
            </p>
          </Card>
        ) : issues.length === 0 && people.length > 0 ? (
          <Card tone="ok">
            <p className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="size-6" aria-hidden />
              Every desk and doctor is connected into the flow.
            </p>
          </Card>
        ) : issues.length > 0 ? (
          <Card tone="warn">
            <p className="flex items-center gap-2 text-lg">
              <TriangleAlert className="size-6" aria-hidden />
              {issues.length} {issues.length === 1 ? "place needs" : "places need"} a connection
            </p>
            <ul className="mt-1.5 space-y-0.5 text-base">
              {issues.map(({ p, problem }) => (
                <li key={p.uid}>
                  <span className="font-bold">{p.displayName}:</span> {problem}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {people.length > 0 ? <DutyLegend people={people} /> : null}

        {admin && !solo ? (
          <Link
            to="/manage?section=flow"
            className="flex items-center gap-2 rounded-xl border-[3px] border-[#232326] bg-white px-3 py-2.5 text-base font-bold shadow-[0_3px_0_#232326]"
          >
            <Lock className="size-5 shrink-0" aria-hidden />
            Change who sends patients to whom
            <span className="ml-auto text-sm font-normal">Management, with the PIN</span>
          </Link>
        ) : null}

        {team.loading ? (
          <p className="text-muted-foreground text-base">Loading the team…</p>
        ) : solo ? null : (
          <Wiring people={people} routes={routes.data} canEdit={false} onConnect={async () => undefined} onDisconnect={async () => undefined} />
        )}
      </Screen>
    </>
  );
}

/** Says what the colours mean, and how many people are on right now. */
function DutyLegend({ people }: { people: Account[] }) {
  const now = useNow(20_000).getTime();
  const on = people.filter((p) => isOnDuty(p, now)).length;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-base">
      <span className="flex items-center gap-2">
        <span aria-hidden className="size-5 rounded-md border-[3px] border-[#232326] bg-[oklch(0.86_0.15_150)]" />
        On duty now
      </span>
      <span className="flex items-center gap-2">
        <span aria-hidden className="size-5 rounded-md border-[3px] border-[#232326] bg-white" />
        Not on duty
      </span>
      <span className="font-bold">
        {on} of {people.length} on duty
      </span>
    </div>
  );
}
