import dayjs from 'dayjs';
import { MatrixClient, SetPresence } from 'matrix-js-sdk';
import { Presence, UserPresence, getUserPresence } from '../state/presence';

/**
 * `set_presence` of `/sync` is only applied while the sync loop is running,
 * therefore a manually chosen presence is persisted and re-applied on client start.
 */
export const SYNC_PRESENCE_STORAGE_KEY = 'cinny_sync_presence';

/**
 * Maximum length of `status_msg` of `PUT /_matrix/client/v3/presence/{userId}/status`.
 */
export const MAX_PRESENCE_STATUS_LENGTH = 255;

export const PRESENCE_LIST: Presence[] = [Presence.Online, Presence.Unavailable, Presence.Offline];

export const getPresenceLabel = (presence: Presence): string => {
  if (presence === Presence.Online) return 'Active';
  if (presence === Presence.Unavailable) return 'Busy';
  return 'Away';
};

export const isValidPresence = (presence: unknown): presence is Presence =>
  presence === Presence.Online ||
  presence === Presence.Unavailable ||
  presence === Presence.Offline;

export const readStoredSyncPresence = (): Presence | undefined => {
  try {
    const presence = window.localStorage.getItem(SYNC_PRESENCE_STORAGE_KEY);
    return isValidPresence(presence) ? presence : undefined;
  } catch {
    return undefined;
  }
};

export const storeSyncPresence = (presence: Presence) => {
  try {
    window.localStorage.setItem(SYNC_PRESENCE_STORAGE_KEY, presence);
  } catch {
    // ignore, the storage may be unavailable (e.g. private mode)
  }
};

/**
 * Builds presence data of the current user.
 *
 * The homeserver does not send a presence event back to the user which changed its own
 * presence, and the SDK only updates `presenceStatusMsg` when a presence event carries a
 * non empty `status_msg`. Without mirroring the change locally, the UI would keep showing
 * a cleared status until the next reload.
 */
export const buildOwnPresence = (
  mx: MatrixClient,
  presence: Presence,
  statusMsg?: string
): UserPresence | undefined => {
  const userId = mx.getUserId();
  if (!userId) return undefined;

  const now = Date.now();
  const user = mx.getUser(userId);

  return {
    userId,
    presence,
    status: statusMsg,
    lastActiveTs: now,
    currentlyActive: presence === Presence.Online,
    lastPresenceTs: user?.lastPresenceTs || now,
  };
};

/**
 * Reads presence of the current user.
 *
 * The presence which was explicitly chosen in the settings wins over the value the
 * homeserver reports: syncing counts as activity, so the server would otherwise announce
 * us as "online" until `set_presence` of the next `/sync` request was applied.
 */
export const getOwnPresence = (mx: MatrixClient): UserPresence | undefined => {
  const userId = mx.getUserId();
  if (!userId) return undefined;

  const stored = readStoredSyncPresence();
  const user = mx.getUser(userId);
  const synced = user ? getUserPresence(user) : undefined;

  if (!stored) return synced;

  return {
    userId,
    presence: stored,
    status: synced?.status ?? user?.presenceStatusMsg,
    lastActiveTs: synced?.lastActiveTs ?? 0,
    currentlyActive: stored === Presence.Online ? true : !!synced?.currentlyActive,
    lastPresenceTs: synced?.lastPresenceTs ?? 0,
  };
};

/**
 * Sets our own presence.
 *
 * Both calls are required:
 * - `PUT /presence/{userId}/status` is the only way to set `status_msg`.
 * - `/sync` is sent with `set_presence=online` semantics by the homeserver, so without
 *   `setSyncPresence` the next sync would flip a manually chosen presence back to online.
 */
export const setOwnPresence = async (
  mx: MatrixClient,
  presence: Presence,
  statusMsg?: string
): Promise<UserPresence | undefined> => {
  await mx.setPresence({ presence, status_msg: statusMsg ?? '' });
  await mx.setSyncPresence(presence as string as SetPresence);
  storeSyncPresence(presence);

  return buildOwnPresence(mx, presence, statusMsg);
};

/**
 * Formats an absolute timestamp with seconds precision, e.g. `28 Oct 2026, 14:03:22`.
 */
export const formatLastActiveTs = (ts: number, hour24Clock: boolean): string =>
  dayjs(ts).format(hour24Clock ? 'DD MMM YYYY, HH:mm:ss' : 'DD MMM YYYY, hh:mm:ss A');

/**
 * Returns the "Last seen" text of a user or `undefined` when the homeserver did not
 * tell us when the user was last active.
 */
export const getLastActiveText = (
  lastActiveTs: number,
  hour24Clock: boolean
): string | undefined => {
  if (!lastActiveTs || lastActiveTs <= 0) return undefined;
  return `Last seen ${formatLastActiveTs(lastActiveTs, hour24Clock)}`;
};
