import {
  Badge,
  Box,
  Button,
  color,
  config,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import React, { useCallback, useState } from 'react';
import { EventType, MatrixError } from 'matrix-js-sdk';
import { RoomEncryptionEventContent } from 'matrix-js-sdk/lib/types';
import FocusTrap from 'focus-trap-react';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../../room-settings/styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { MSC4362_ENCRYPT_STATE_EVENTS_PROPERTY, StateEvent } from '../../../../types/matrix/room';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useRoom } from '../../../hooks/useRoom';
import { useStateEncryption } from '../../../hooks/useStateEncryption';
import { useStateEvent } from '../../../hooks/useStateEvent';
import { stopPropagation } from '../../../utils/keyboard';
import { RoomPermissionsAPI } from '../../../hooks/useRoomPermissions';

const ROOM_ENC_ALGO = 'm.megolm.v1.aes-sha2';

type RoomEncryptionProps = {
  permissions: RoomPermissionsAPI;
};
export function RoomEncryption({ permissions }: RoomEncryptionProps) {
  const mx = useMatrixClient();
  const room = useRoom();

  const canEnable = permissions.stateEvent(StateEvent.RoomEncryption, mx.getSafeUserId());
  const content = useStateEvent(room, StateEvent.RoomEncryption)?.getContent<
    RoomEncryptionEventContent & { [MSC4362_ENCRYPT_STATE_EVENTS_PROPERTY]?: boolean }
  >();
  const enabled = content?.algorithm === ROOM_ENC_ALGO;

  // MSC4362, the crypto stack is the source of truth for outgoing state events,
  // the content of `m.room.encryption` tells us what the room asked for.
  const cryptoStateEncryption = useStateEncryption(room);
  const stateEncrypted =
    cryptoStateEncryption ?? content?.[MSC4362_ENCRYPT_STATE_EVENTS_PROPERTY] === true;

  const [enableState, enable] = useAsyncCallback(
    useCallback(async () => {
      await mx.sendStateEvent(room.roomId, EventType.RoomEncryption, {
        algorithm: ROOM_ENC_ALGO,
      });
    }, [mx, room.roomId])
  );

  const enabling = enableState.status === AsyncStatus.Loading;

  const [prompt, setPrompt] = useState(false);

  const handleEnable = () => {
    enable();
    setPrompt(false);
  };

  const [enableStateEncState, enableStateEncryption] = useAsyncCallback<
    void,
    Error | MatrixError,
    []
  >(
    useCallback(async () => {
      const encryptionContent: RoomEncryptionEventContent = {
        ...content,
        algorithm: ROOM_ENC_ALGO,
        [MSC4362_ENCRYPT_STATE_EVENTS_PROPERTY]: true,
      };
      await mx.sendStateEvent(room.roomId, EventType.RoomEncryption, encryptionContent);
    }, [mx, room.roomId, content])
  );

  const enablingStateEncryption = enableStateEncState.status === AsyncStatus.Loading;

  const [statePrompt, setStatePrompt] = useState(false);

  const handleEnableStateEncryption = () => {
    enableStateEncryption();
    setStatePrompt(false);
  };

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <SettingTile
        title="Room Encryption"
        description={
          enabled
            ? 'Messages in this room are protected by end-to-end encryption.'
            : 'Once enabled, encryption cannot be disabled!'
        }
        after={
          enabled ? (
            <Badge size="500" variant="Success" fill="Solid" radii="300">
              <Text size="L400">Enabled</Text>
            </Badge>
          ) : (
            <Button
              size="300"
              variant="Primary"
              fill="Solid"
              radii="300"
              disabled={!canEnable}
              onClick={() => setPrompt(true)}
              before={enabling && <Spinner size="100" variant="Primary" fill="Solid" />}
            >
              <Text size="B300">Enable</Text>
            </Button>
          )
        }
      >
        {enableState.status === AsyncStatus.Error && (
          <Text style={{ color: color.Critical.Main }} size="T200">
            {(enableState.error as MatrixError).message}
          </Text>
        )}
        {prompt && (
          <Overlay open backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: () => setPrompt(false),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Dialog variant="Surface">
                  <Header
                    style={{
                      padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                      borderBottomWidth: config.borderWidth.B300,
                    }}
                    variant="Surface"
                    size="500"
                  >
                    <Box grow="Yes">
                      <Text size="H4">Enable Encryption</Text>
                    </Box>
                    <IconButton size="300" onClick={() => setPrompt(false)} radii="300">
                      <Icon src={Icons.Cross} />
                    </IconButton>
                  </Header>
                  <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                    <Text priority="400">
                      Are you sure? Once enabled, encryption cannot be disabled!
                    </Text>
                    <Button type="submit" variant="Primary" onClick={handleEnable}>
                      <Text size="B400">Enable E2E Encryption</Text>
                    </Button>
                  </Box>
                </Dialog>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
      </SettingTile>
      {enabled && (
        <SettingTile
          title="Encrypt Room Metadata"
          description={
            stateEncrypted
              ? 'Room state such as name, topic and avatar is end-to-end encrypted (MSC4362).'
              : 'Encrypt room state such as name, topic and avatar (MSC4362). Once enabled, it cannot be disabled!'
          }
          after={
            stateEncrypted ? (
              <Badge size="500" variant="Success" fill="Solid" radii="300">
                <Text size="L400">Enabled</Text>
              </Badge>
            ) : (
              <Button
                size="300"
                variant="Primary"
                fill="Solid"
                radii="300"
                disabled={!canEnable || enablingStateEncryption}
                onClick={() => setStatePrompt(true)}
                before={
                  enablingStateEncryption && <Spinner size="100" variant="Primary" fill="Solid" />
                }
              >
                <Text size="B300">Enable</Text>
              </Button>
            )
          }
        >
          {enableStateEncState.status === AsyncStatus.Error && (
            <Text style={{ color: color.Critical.Main }} size="T200">
              {(enableStateEncState.error as MatrixError).message}
            </Text>
          )}
          {statePrompt && (
            <Overlay open backdrop={<OverlayBackdrop />}>
              <OverlayCenter>
                <FocusTrap
                  focusTrapOptions={{
                    initialFocus: false,
                    onDeactivate: () => setStatePrompt(false),
                    clickOutsideDeactivates: true,
                    escapeDeactivates: stopPropagation,
                  }}
                >
                  <Dialog variant="Surface">
                    <Header
                      style={{
                        padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                        borderBottomWidth: config.borderWidth.B300,
                      }}
                      variant="Surface"
                      size="500"
                    >
                      <Box grow="Yes">
                        <Text size="H4">Encrypt Room Metadata</Text>
                      </Box>
                      <IconButton size="300" onClick={() => setStatePrompt(false)} radii="300">
                        <Icon src={Icons.Cross} />
                      </IconButton>
                    </Header>
                    <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                      <Box direction="Column" gap="200">
                        <Text priority="400">
                          Room name, topic, avatar and other state events will be end-to-end
                          encrypted. The homeserver and clients without support for MSC4362 will not
                          be able to read them.
                        </Text>
                        <Text priority="400">
                          Members which join later may not be able to read state which was set
                          before they joined. Once enabled, it cannot be disabled!
                        </Text>
                      </Box>
                      <Button type="submit" variant="Primary" onClick={handleEnableStateEncryption}>
                        <Text size="B400">Encrypt Room Metadata</Text>
                      </Button>
                    </Box>
                  </Dialog>
                </FocusTrap>
              </OverlayCenter>
            </Overlay>
          )}
        </SettingTile>
      )}
    </SequenceCard>
  );
}
