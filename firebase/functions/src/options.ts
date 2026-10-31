/**
 * How every function is run. Imported first in index.ts so it applies to all of
 * them: the options must be set before the first function is declared.
 *
 * Region: Mumbai. The patients and the hospitals are in India, and a round trip
 * to the US costs a quarter of a second each way on a mobile connection.
 *
 * Size: small. Each instance gets a fraction of a CPU (`gcf_gen1`: about a
 * sixth of one at 256 MiB) and serves one request at a time. Cloud Run counts
 * the CPU of every running instance against the project's regional quota, and
 * a new project's quota is small: at a full CPU each, a handful of busy
 * functions used it up and the rest answered "Rate exceeded". These functions
 * spend their time waiting on Firestore, not computing, so a fraction is
 * enough. With real traffic, ask for more quota and move the hot paths
 * (registration, intake, signing) back to `cpu: 1` with `concurrency: 80`.
 *
 * maxInstances: a ceiling per function, so a runaway client cannot run up an
 * unbounded bill. 5 instances is 5 requests at once per function.
 *
 * minInstances: none. A warm instance removes the first cold start, but it is
 * set per function, so with about fifty functions it means fifty instances
 * billed all day.
 *
 * invoker: public. Callables check the caller themselves (and the HTTP ones a
 * key or a signature); saying so here makes every deploy grant it, not only
 * the first.
 */
import { setGlobalOptions } from "firebase-functions/v2";

export const REGION = "asia-south1";

setGlobalOptions({
  region: REGION,
  cpu: "gcf_gen1",
  memory: "256MiB",
  concurrency: 1,
  maxInstances: 5,
  minInstances: 0,
  invoker: "public",
  // No global timeout: Cloud Functions defaults to 60 s, and the demo seed
  // (emulator only) needs longer than any request should.
});
