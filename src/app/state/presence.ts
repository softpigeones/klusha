import produce from 'immer';
import { atom, useSetAtom } from 'jotai';
import { MatrixClient, User, UserEvent, UserEventHandlerMap } from 'matrix-js-sdk';
import { useEffect } from 'react';

/**
 * Presence states as defined by the Matrix specification.
 *
 * `Online` maps to the "Active" label, `Unavailable` to "Busy" and `Offline` to "Away".
 */
export enum Presence {
  Online = 'online',
  Unavailable = 'unavailable',
  Offline = 'offline',
}

export type UserPresence = {
  userId: string;
  presence: Presence;
  /** `status_msg` of the presence event, if the user set one. */
  status?: string;
  /**
   * Absolute timestamp (ms since epoch) of the last known activity of the user.
   * `0` when the homeserver never told us when the user was last active
   * (e.g. `federation_presence_outage_delay` / privacy settings hide it).
   */
  lastActiveTs: number;
  /** Whether the homeserver considers the `lastActiveTs` to be "right now". */
  currentlyActive: boolean;
  /** Timestamp (ms since epoch) of the moment we received this presence. */
  lastPresenceTs: number;
};

export type UserIdToPresence = Map<string, UserPresence>;

const toPresence = (presence: Presence | string | undefined): Presence => {
  if (presence === Presence.Online || presence === Presence.Unavailable) return presence;
  return Presence.Offline;
};

export const getUserPresence = (user: User): UserPresence => ({
  userId: user.userId,
  presence: toPresence(user.presence),
  status: user.presenceStatusMsg,
  lastActiveTs: user.getLastActiveTs(),
  currentlyActive: !!user.currentlyActive,
  lastPresenceTs: user.lastPresenceTs,
});

/**
 * Creates presence data from the content of a `m.presence` event.
 *
 * Used when polling `GET /_matrix/client/v3/presence/{userId}/status`, which - unlike
 * `/sync` - does not update the `User` objects of the SDK store.
 */
export const getPresenceFromContent = (
  userId: string,
  content: {
    presence?: string;
    status_msg?: string;
    last_active_ago?: number;
    currently_active?: boolean;
  }
): UserPresence => {
  const now = Date.now();
  const lastActiveAgo = typeof content.last_active_ago === 'number' ? content.last_active_ago : 0;

  return {
    userId,
    presence: toPresence(content.presence),
    status: typeof content.status_msg === 'string' ? content.status_msg : undefined,
    lastActiveTs: lastActiveAgo > 0 ? now - lastActiveAgo : 0,
    currentlyActive: !!content.currently_active,
    lastPresenceTs: now,
  };
};

export type UserPresenceUpsertAction = {
  type: 'UPSERT';
  presence: UserPresence;
};
export type UserPresenceBulkUpsertAction = {
  type: 'BULK_UPSERT';
  presences: UserPresence[];
};
export type UserPresenceDeleteAction = {
  type: 'DELETE';
  userId: string;
};
export type UserPresenceResetAction = {
  type: 'RESET';
};
export type UserPresenceAction =
  | UserPresenceUpsertAction
  | UserPresenceBulkUpsertAction
  | UserPresenceDeleteAction
  | UserPresenceResetAction;

const baseUserPresenceAtom = atom<UserIdToPresence>(new Map());

/**
 * Keeps presence of every user we ever received a presence event for.
 *
 * Presence arrives with `/sync` (ephemeral `m.presence` events) for every user that shares
 * a room with us, so this map is filled without the user having to open a profile or
 * switch rooms. Components subscribe to a single user id, which keeps re-renders local.
 */
export const userPresenceAtom = atom<UserIdToPresence, [UserPresenceAction], undefined>(
  (get) => get(baseUserPresenceAtom),
  (get, set, action) => {
    if (action.type === 'RESET') {
      set(baseUserPresenceAtom, new Map());
      return;
    }

    if (action.type === 'DELETE') {
      const prev = get(baseUserPresenceAtom);
      if (!prev.has(action.userId)) return;
      set(
        baseUserPresenceAtom,
        produce(prev, (draft) => {
          draft.delete(action.userId);
        })
      );
      return;
    }

    const presences = action.type === 'BULK_UPSERT' ? action.presences : [action.presence];
    const userIdToPresence = get(baseUserPresenceAtom);
    const changed = presences.filter((presence) => {
      const current = userIdToPresence.get(presence.userId);
      return (
        !current ||
        current.presence !== presence.presence ||
        current.status !== presence.status ||
        current.lastActiveTs !== presence.lastActiveTs ||
        current.currentlyActive !== presence.currentlyActive
      );
    });
    if (changed.length === 0) return;

    set(
      baseUserPresenceAtom,
      produce(userIdToPresence, (draft) => {
        changed.forEach((presence) => {
          draft.set(presence.userId, presence);
        });
      })
    );
  }
);

/**
 * Binds presence events of the client to {@link userPresenceAtom}.
 *
 * The SDK re-emits `User.*` events on the client for every user it creates
 * (see `User.createUser`), which means we get live presence updates from `/sync`
 * without holding a reference to a `User` object per component.
 *
 * An initial sync can carry the presence of hundreds of users and every atom update
 * replaces the whole map, therefore updates are collected and written in a single batch.
 */
export const useBindUserPresenceAtom = (
  mx: MatrixClient,
  presenceAtom: typeof userPresenceAtom
) => {
  const setUserPresence = useSetAtom(presenceAtom);

  useEffect(() => {
    let pending: Map<string, UserPresence> | undefined;
    let flushScheduled = false;

    const flush = () => {
      flushScheduled = false;
      if (!pending || pending.size === 0) {
        pending = undefined;
        return;
      }
      const presences = [...pending.values()];
      pending = undefined;
      setUserPresence({ type: 'BULK_UPSERT', presences });
    };

    const queue = (user: User) => {
      if (!pending) pending = new Map();
      pending.set(user.userId, getUserPresence(user));
      if (flushScheduled) return;
      flushScheduled = true;
      queueMicrotask(flush);
    };

    const handleUserPresence: UserEventHandlerMap[UserEvent.Presence] = (_event, user) => {
      queue(user);
    };

    // seed with whatever the store already knows (initial sync, restored store)
    setUserPresence({
      type: 'BULK_UPSERT',
      presences: mx.getUsers().map(getUserPresence),
    });

    mx.on(UserEvent.Presence, handleUserPresence);
    mx.on(UserEvent.CurrentlyActive, handleUserPresence);
    mx.on(UserEvent.LastPresenceTs, handleUserPresence);
    return () => {
      mx.removeListener(UserEvent.Presence, handleUserPresence);
      mx.removeListener(UserEvent.CurrentlyActive, handleUserPresence);
      mx.removeListener(UserEvent.LastPresenceTs, handleUserPresence);
    };
  }, [mx, setUserPresence]);
};
