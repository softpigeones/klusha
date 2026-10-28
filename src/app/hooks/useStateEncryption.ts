import { useCallback, useEffect, useState } from 'react';
import { EventTimeline, MatrixEvent, Room, RoomStateEvent } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useMatrixClient } from './useMatrixClient';
import { useStateEventCallback } from './useStateEventCallback';

/**
 * Whether a room encrypts its state events (MSC4362).
 *
 * The value is read from the crypto stack, which is the source of truth used when
 * deciding whether an outgoing state event has to be encrypted. `undefined` means
 * "unknown" - either the room is not encrypted or the crypto stack is still starting.
 */
export const useStateEncryption = (room: Room): boolean | undefined => {
  const mx = useMatrixClient();
  const [enabled, setEnabled] = useState<boolean>();

  const load = useCallback(async () => {
    const crypto = mx.getCrypto();
    if (!crypto) {
      setEnabled(undefined);
      return;
    }
    try {
      setEnabled(await crypto.isStateEncryptionEnabledInRoom(room.roomId));
    } catch {
      setEnabled(undefined);
    }
  }, [mx, room.roomId]);

  useEffect(() => {
    load();
  }, [load]);

  // the crypto stack applies `m.room.encryption` while processing sync, ask it again
  // whenever the event of the room changes
  useStateEventCallback(
    mx,
    useCallback(
      (event: MatrixEvent) => {
        if (event.getRoomId() === room.roomId && event.getType() === StateEvent.RoomEncryption) {
          window.setTimeout(load, 0);
        }
      },
      [room.roomId, load]
    )
  );

  useEffect(() => {
    const handleStateUpdate = () => load();
    const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
    state?.on(RoomStateEvent.Update, handleStateUpdate);
    return () => {
      state?.removeListener(RoomStateEvent.Update, handleStateUpdate);
    };
  }, [room, load]);

  return enabled;
};
