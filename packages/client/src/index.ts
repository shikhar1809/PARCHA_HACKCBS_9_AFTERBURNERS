/**
 * The Firebase side of both apps: wiring, live reads, and the one way to
 * write anything.
 */
export {
  EMULATOR_HOST,
  call,
  getAuthClient,
  getDb,
  usingEmulators,
} from "./firebase";
export { setReauthHandler } from "./firebase";
export {
  setHospitalScope,
  useHospitalScope,
  plain,
  useDoc,
  useQuery,
  useQueryFactory,
  type Loadable,
} from "./hooks";
export * from "./queries";
