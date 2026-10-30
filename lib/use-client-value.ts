import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * A browser-only value read once on the client. SSR and the hydration render
 * get `serverValue` (so markup matches); the client then re-renders with
 * `read()`. `read` must return a primitive (compared with Object.is).
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noopSubscribe, read, () => serverValue);
}
