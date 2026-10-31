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
  ErrorBoundary,
  OnlineBanner,
  SessionGuard,
  setMyDuty,
  useMyDutySwitch,
  signOutUser,
  takeSessionEndedNotice,
  useOnline,
} from "./session";
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
export * from "./mutations";
export { vaultClear, vaultDelete, vaultGet, vaultKeys, vaultPut, vaultStats } from "./vault";
export {
  callQueued,
  flushOutbox,
  dismissQueued,
  newClientId,
  forcedOffline,
  setForcedOffline,
  useOffline,
  useOutbox,
  useOutboxSync,
} from "./outbox";
export { StaffSessionGate } from "./staff-session";
export * from "./pending";
