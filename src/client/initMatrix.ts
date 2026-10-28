import {
  createClient,
  MatrixClient,
  IndexedDBStore,
  IndexedDBCryptoStore,
  SetPresence,
} from 'matrix-js-sdk';

import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import { readStoredSyncPresence } from '../app/utils/presence';
import { setupEncryptedStateEventHandling } from './encryptedStateEvents';

type Session = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
};

export const initClient = async (session: Session): Promise<MatrixClient> => {
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: 'web-sync-store',
  });

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, 'crypto-store');

  const mx = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    cryptoCallbacks: cryptoCallbacks as any,
    verificationMethods: ['m.sas.v1'],
    // MSC4362 (simplified encrypted state events): rooms can opt into encrypting their
    // state. The flag is always on, so that rooms which already encrypt their state keep
    // working - whether a room encrypts state is decided by its `m.room.encryption` event.
    enableEncryptedStateEvents: true,
  });

  await indexedDBStore.startup();
  await mx.initRustCrypto();

  // MSC4362: keep room state usable for state events which are decrypted after they were
  // added to the room state
  setupEncryptedStateEventHandling(mx);

  mx.setMaxListeners(50);

  return mx;
};

export const startClient = async (mx: MatrixClient) => {
  await mx.startClient({
    lazyLoadMembers: true,
  });

  // A manually selected presence (e.g. busy) has to be re-applied after the sync loop has
  // been started, `set_presence` of `/sync` is what keeps it from flipping back to online.
  const storedPresence = readStoredSyncPresence();
  if (storedPresence) {
    await mx.setSyncPresence(storedPresence as string as SetPresence);
  }
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

export const logoutClient = async (mx: MatrixClient) => {
  pushSessionToSW();
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await mx.clearStores();
  window.localStorage.clear();
  window.location.reload();
};

export const clearLoginData = async () => {
  const dbs = await window.indexedDB.databases();

  dbs.forEach((idbInfo) => {
    const { name } = idbInfo;
    if (name) {
      window.indexedDB.deleteDatabase(name);
    }
  });

  window.localStorage.clear();
  window.location.reload();
};
