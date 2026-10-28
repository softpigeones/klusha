import {
  EventType,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  MatrixEventHandlerMap,
  RoomState,
} from 'matrix-js-sdk';
import { MSC4362_UNENCRYPTED_STATE_EVENTS } from '../types/matrix/room';

/**
 * MSC4362 (simplified encrypted state events).
 *
 * An encrypted state event arrives as `m.room.encrypted` with a packed state key
 * (`"<real type>:<real state key>"`). The SDK decrypts state events of `/sync` before it
 * injects them into the room state, so they end up under their real type and `Room.name`,
 * the topic, the avatar, ... work as usual.
 *
 * Events which are added to a room state before their decryption finished (pagination,
 * the `state` block of a sync response, events restored from the store) would stay under
 * `m.room.encrypted` forever, because a `RoomState` is indexed by
 * `event.getType()`/`event.getStateKey()` at insertion time. This listener re-applies such
 * events once they are decrypted, which makes the room state - and every Cinny hook reading
 * it (`useStateEvent`, `useRoomName`, `useRoomTopic`, ...) - update.
 *
 * @returns a function which removes the listener again
 */
export const setupEncryptedStateEventHandling = (mx: MatrixClient): (() => void) => {
  const reapplyDecryptedState = (roomState: RoomState, event: MatrixEvent) => {
    const type = event.getType();

    // the event is still encrypted (or failed to decrypt), keep it out of the state
    if (event.isEncrypted() || event.isDecryptionFailure()) return;
    // state which is never encrypted per MSC4362 also never needs this fix up
    if (MSC4362_UNENCRYPTED_STATE_EVENTS.includes(type)) return;
    if (!event.isState()) return;

    const stateKey = event.getStateKey();
    if (typeof stateKey !== 'string') return;
    // already indexed under the right type, nothing to do
    if (roomState.getStateEvents(type, stateKey)?.getId() === event.getId()) return;

    roomState.setStateEvents([event]);
  };

  const handleDecrypted: MatrixEventHandlerMap[MatrixEventEvent.Decrypted] = (event) => {
    if (!event.isState() || event.getWireType() !== EventType.RoomMessageEncrypted) return;

    const roomId = event.getRoomId();
    if (!roomId) return;

    const room = mx.getRoom(roomId);
    if (room) reapplyDecryptedState(room.currentState, event);
    if (room && room.oldState !== room.currentState) {
      reapplyDecryptedState(room.oldState, event);
    }
  };

  mx.on(MatrixEventEvent.Decrypted, handleDecrypted);

  return () => {
    mx.removeListener(MatrixEventEvent.Decrypted, handleDecrypted);
  };
};
