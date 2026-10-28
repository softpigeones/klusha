import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { MatrixClient } from 'matrix-js-sdk';
import {
  Presence,
  UserPresence,
  getPresenceFromContent,
  userPresenceAtom,
} from '../state/presence';
import { getOwnPresence, getPresenceLabel, setOwnPresence } from '../utils/presence';
import { settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';
import { useMatrixClient } from './useMatrixClient';

export { Presence };
export type { UserPresence };

export const usePresenceLabel = (): Record<Presence, string> =>
  useMemo(
    () => ({
      [Presence.Online]: getPresenceLabel(Presence.Online),
      [Presence.Unavailable]: getPresenceLabel(Presence.Unavailable),
      [Presence.Offline]: getPresenceLabel(Presence.Offline),
    }),
    []
  );

/**
 * Returns live presence of a user.
 *
 * Presence is kept in a global atom which is fed by the `m.presence` events of `/sync`
 * (see `useBindUserPresenceAtom`), so it updates without the user switching rooms or
 * opening a profile. Returns `undefined` when no presence was ever received for the user,
 * which is different from "offline" - the homeserver simply did not tell us anything yet.
 */
export const useUserPresence = (userId?: string): UserPresence | undefined => {
  const selector = useMemo(
    () => (userIdToPresence: Map<string, UserPresence>) =>
      userId ? userIdToPresence.get(userId) : undefined,
    [userId]
  );

  return useAtomValue(selectAtom(userPresenceAtom, selector));
};

/** How often presence of users, which we have no data for, is polled. */
export const PRESENCE_POLL_INTERVAL_MS = 30 * 1000;
/** Maximum number of users polled per interval. */
export const PRESENCE_POLL_LIMIT = 50;

type InflightEntry = {
  promise: Promise<void>;
  ts: number;
};
// A single in-flight request per user, shared by every mounted poller.
const inflightRequests: Map<string, InflightEntry> = new Map();

const pollUserPresence = async (
  mx: MatrixClient,
  userId: string,
  upsert: (presence: UserPresence) => void
): Promise<void> => {
  const now = Date.now();
  const inflight = inflightRequests.get(userId);
  if (inflight && now - inflight.ts < PRESENCE_POLL_INTERVAL_MS) {
    return inflight.promise;
  }

  const promise = (async () => {
    try {
      const res = await mx.getPresence(userId);
      upsert(getPresenceFromContent(userId, res ?? {}));
    } catch {
      // Presence may be disabled on the homeserver or hidden for this user,
      // there is nothing we can show in that case.
    } finally {
      inflightRequests.delete(userId);
    }
  })();

  inflightRequests.set(userId, { promise, ts: now });
  return promise;
};

/**
 * Polls `GET /presence/{userId}/status` for users we have no presence data for.
 *
 * `/sync` only carries presence of users that share a room with us *and* are tracked by
 * the homeserver. For everybody else (e.g. the profile of a user from a public room) this
 * fills the gap. Polling is throttled, de-duplicated across components and paused while
 * the window is hidden.
 *
 * @param userIds users to keep up to date, `undefined` entries are ignored.
 */
export const useUserPresenceWatcher = (
  userIds: Array<string | undefined>,
  {
    interval = PRESENCE_POLL_INTERVAL_MS,
    limit = PRESENCE_POLL_LIMIT,
  }: { interval?: number; limit?: number } = {}
) => {
  const mx = useMatrixClient();
  const upsertUserPresence = useSetAtom(userPresenceAtom);
  const userIdToPresence = useAtomValue(userPresenceAtom);

  const joinedUserIds = useMemo(() => userIds.join(','), [userIds]);
  const targets = useMemo(() => {
    const seen = new Set<string>();
    const missing: string[] = [];
    joinedUserIds.split(',').forEach((userId) => {
      if (!userId || userId === mx.getUserId() || seen.has(userId)) return;
      seen.add(userId);
      // presence of these users arrives with /sync, only ask for the ones we don't know
      if (!userIdToPresence.has(userId)) missing.push(userId);
    });
    return missing.slice(0, limit);
  }, [joinedUserIds, userIdToPresence, limit, mx]);

  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  useEffect(() => {
    if (targets.length === 0) return undefined;

    const poll = () => {
      if (document.visibilityState === 'hidden') return;
      targetsRef.current.forEach((userId) => {
        pollUserPresence(mx, userId, (presence) =>
          upsertUserPresence({ type: 'UPSERT', presence })
        );
      });
    };

    poll();
    const timeout = window.setInterval(poll, interval);
    return () => window.clearInterval(timeout);
  }, [mx, upsertUserPresence, interval, targets]);
};

/** Convenience wrapper to poll presence of a single user, e.g. an opened profile. */
export const useUserPresenceWatch = (userId?: string) => {
  const userIds = useMemo(() => [userId], [userId]);
  useUserPresenceWatcher(userIds);
};

/** Whether presence indicators of other users should be rendered. */
export const useShowPresence = (): boolean => {
  const [showPresence] = useSetting(settingsAtom, 'showPresence');
  return showPresence;
};

/**
 * Presence of the logged in user.
 *
 * The presence chosen in the settings is applied to `/sync`, which is why it is preferred
 * over the value the homeserver reports for us.
 */
export const useOwnPresence = (): UserPresence | undefined => {
  const mx = useMatrixClient();
  const userId = mx.getUserId() ?? undefined;
  const synced = useUserPresence(userId);

  return useMemo(() => getOwnPresence(mx) ?? synced, [synced, mx]);
};

/**
 * Sets our own presence and `status_msg`.
 *
 * Both `PUT /presence/{userId}/status` and `set_presence` of `/sync` are updated, see
 * {@link setOwnPresence}.
 */
export const useSetOwnPresence = () => {
  const mx = useMatrixClient();
  const upsertUserPresence = useSetAtom(userPresenceAtom);

  return useCallback(
    async (presence: Presence, statusMsg?: string) => {
      const own = await setOwnPresence(mx, presence, statusMsg);
      if (own) upsertUserPresence({ type: 'UPSERT', presence: own });
      return own;
    },
    [mx, upsertUserPresence]
  );
};
