import {
  ICreateRoomOpts,
  ICreateRoomStateEvent,
  JoinRule,
  MatrixClient,
  RestrictedAllowType,
  Room,
} from 'matrix-js-sdk';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import {
  MSC4362_ENCRYPT_STATE_EVENTS_PROPERTY,
  RoomType,
  StateEvent,
} from '../../../types/matrix/room';
import { getViaServers } from '../../plugins/via-servers';
import { getMxIdServer } from '../../utils/matrix';
import { CreateRoomAccess } from './types';

export const createRoomCreationContent = (
  type: RoomType | undefined,
  allowFederation: boolean,
  additionalCreators: string[] | undefined
): object => {
  const content: Record<string, any> = {};
  if (typeof type === 'string') {
    content.type = type;
  }
  if (allowFederation === false) {
    content['m.federate'] = false;
  }
  if (Array.isArray(additionalCreators)) {
    content.additional_creators = additionalCreators;
  }

  return content;
};

export const createRoomJoinRulesState = (
  access: CreateRoomAccess,
  parent: Room | undefined,
  knock: boolean
) => {
  let content: RoomJoinRulesEventContent = {
    join_rule: knock ? JoinRule.Knock : JoinRule.Invite,
  };

  if (access === CreateRoomAccess.Public) {
    content = {
      join_rule: JoinRule.Public,
    };
  }

  if (access === CreateRoomAccess.Restricted && parent) {
    content = {
      join_rule: knock ? ('knock_restricted' as JoinRule) : JoinRule.Restricted,
      allow: [
        {
          type: RestrictedAllowType.RoomMembership,
          room_id: parent.roomId,
        },
      ],
    };
  }

  return {
    type: StateEvent.RoomJoinRules,
    state_key: '',
    content,
  };
};

export const createRoomParentState = (parent: Room) => ({
  type: StateEvent.SpaceParent,
  state_key: parent.roomId,
  content: {
    canonical: true,
    via: getViaServers(parent),
  },
});

const createSpacePowerLevelsOverride = () => ({
  events_default: 50,
});

/**
 * @param stateEncryption MSC4362, encrypt room state (name, topic, avatar, ...) as well.
 */
export const createRoomEncryptionState = (stateEncryption?: boolean) => {
  const content: Record<string, unknown> = {
    algorithm: 'm.megolm.v1.aes-sha2',
  };
  if (stateEncryption) {
    content[MSC4362_ENCRYPT_STATE_EVENTS_PROPERTY] = true;
  }

  return {
    type: StateEvent.RoomEncryption,
    state_key: '',
    content,
  };
};

export const createRoomCallState = () => ({
  type: 'org.matrix.msc3401.call',
  state_key: '',
  content: {},
});

export const createVoiceRoomPowerLevelsOverride = () => ({
  events: {
    [StateEvent.GroupCallMemberPrefix]: 0,
  },
});

export type CreateRoomData = {
  version: string;
  type?: RoomType;
  parent?: Room;
  /** MSC4362, requires `encryption` to be enabled. */
  stateEncryption?: boolean;
  access: CreateRoomAccess;
  name: string;
  topic?: string;
  aliasLocalPart?: string;
  encryption?: boolean;
  knock: boolean;
  allowFederation: boolean;
  additionalCreators?: string[];
};
const ROOM_ENCRYPTION_POLL_INTERVAL = 500;
const ROOM_ENCRYPTION_TIMEOUT = 30 * 1000;

/**
 * Waits until the `m.room.encryption` event of a newly created room arrived.
 *
 * State events of a room with encrypted state (MSC4362) are only encrypted once the SDK
 * processed the encryption event, sending them earlier would leak name and topic.
 */
export const waitForRoomEncryption = (mx: MatrixClient, roomId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const started = Date.now();

    const check = () => {
      const room = mx.getRoom(roomId);
      if (room?.hasEncryptionStateEvent()) {
        resolve();
        return true;
      }
      if (Date.now() - started > ROOM_ENCRYPTION_TIMEOUT) {
        reject(new Error('Timed out waiting for room encryption to be enabled.'));
        return true;
      }
      return false;
    };

    if (check()) return;

    const timeout = window.setInterval(() => {
      if (check()) window.clearInterval(timeout);
    }, ROOM_ENCRYPTION_POLL_INTERVAL);
  });

export const createRoom = async (mx: MatrixClient, data: CreateRoomData): Promise<string> => {
  const initialState: ICreateRoomStateEvent[] = [];
  const stateEncryption = !!data.encryption && !!data.stateEncryption;

  if (data.encryption) {
    initialState.push(createRoomEncryptionState(stateEncryption));
  }

  if (data.parent) {
    initialState.push(createRoomParentState(data.parent));
  }

  if (data.type === RoomType.Call) {
    initialState.push(createRoomCallState());
  }

  initialState.push(createRoomJoinRulesState(data.access, data.parent, data.knock));

  // With encrypted state (MSC4362) the name and topic can not be part of the creation
  // request, they are sent - encrypted - after the room enabled encryption.
  const options: ICreateRoomOpts = {
    room_version: data.version,
    name: stateEncryption ? undefined : data.name,
    topic: stateEncryption ? undefined : data.topic,
    room_alias_name: data.aliasLocalPart,
    creation_content: createRoomCreationContent(
      data.type,
      data.allowFederation,
      data.additionalCreators
    ),
    power_level_content_override:
      data.type === RoomType.Call ? createVoiceRoomPowerLevelsOverride() : undefined,
    initial_state: initialState,
  };

  if (data.type === RoomType.Space) {
    options.power_level_content_override = createSpacePowerLevelsOverride();
  }

  const result = await mx.createRoom(options);

  if (stateEncryption) {
    await waitForRoomEncryption(mx, result.room_id);
    if (data.name) await mx.setRoomName(result.room_id, data.name);
    if (data.topic) await mx.setRoomTopic(result.room_id, data.topic);
  }

  if (data.parent) {
    await mx.sendStateEvent(
      data.parent.roomId,
      StateEvent.SpaceChild as any,
      {
        auto_join: false,
        suggested: false,
        via: [getMxIdServer(mx.getUserId() ?? '') ?? ''],
      },
      result.room_id
    );
  }

  return result.room_id;
};
