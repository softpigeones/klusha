import React, {
  ChangeEventHandler,
  FormEventHandler,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Button,
  Chip,
  color,
  config,
  Icon,
  IconButton,
  Icons,
  Input,
  Spinner,
  Text,
} from 'folds';
import { MatrixError } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import {
  Presence,
  UserPresence,
  useOwnPresence,
  usePresenceLabel,
  useSetOwnPresence,
} from '../../../hooks/useUserPresence';
import { MAX_PRESENCE_STATUS_LENGTH, PRESENCE_LIST } from '../../../utils/presence';
import { PresenceBadge } from '../../../components/presence';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAlive } from '../../../hooks/useAlive';

/**
 * Homeservers may disable presence completely (`presence.enabled: false`), in that case
 * `GET/PUT /presence/{userId}/status` answer with `M_UNRECOGNIZED` and the settings of
 * this block can not be used.
 */
const usePresenceSupported = (): boolean | undefined => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const [supported, setSupported] = useState<boolean>();

  useEffect(() => {
    let canceled = false;

    const check = async () => {
      const userId = mx.getUserId();
      if (!userId) return;
      try {
        await mx.getPresence(userId);
        if (!canceled && alive()) setSupported(true);
      } catch (error) {
        const unrecognized =
          error instanceof MatrixError &&
          (error.errcode === 'M_UNRECOGNIZED' ||
            error.httpStatus === 404 ||
            error.httpStatus === 405);
        if (!canceled && alive()) setSupported(!unrecognized);
      }
    };
    check();

    return () => {
      canceled = true;
    };
  }, [mx, alive]);

  return supported;
};

type PresenceSelectorProps = {
  value: Presence;
  onChange: (presence: Presence) => void;
  disabled?: boolean;
};
function PresenceSelector({ value, onChange, disabled }: PresenceSelectorProps) {
  const label = usePresenceLabel();

  return (
    <Box gap="200" wrap="Wrap">
      {PRESENCE_LIST.map((presence) => (
        <Chip
          key={presence}
          as="button"
          type="button"
          size="500"
          radii="Pill"
          variant={value === presence ? 'Primary' : 'SurfaceVariant'}
          aria-pressed={value === presence}
          disabled={disabled}
          onClick={() => onChange(presence)}
          before={<PresenceBadge presence={presence} size="200" />}
        >
          <Text size="B300">{label[presence]}</Text>
        </Chip>
      ))}
    </Box>
  );
}

/**
 * Presence settings of the logged in user.
 *
 * Selecting a presence is applied immediately, the status message (`status_msg`) is saved
 * with the form. Presence is published through `PUT /presence/{userId}/status` *and*
 * through `set_presence` of `/sync`, otherwise the next sync would report us as online.
 */
export function PresenceStatus() {
  const presenceSupported = usePresenceSupported();
  const ownPresence = useOwnPresence();
  const setOwnPresence = useSetOwnPresence();

  const [presence, setPresence] = useState<Presence>(ownPresence?.presence ?? Presence.Online);
  const [statusMsg, setStatusMsg] = useState(ownPresence?.status ?? '');

  const savedPresence = ownPresence?.presence;
  const savedStatusMsg = ownPresence?.status ?? '';
  useEffect(() => {
    if (savedPresence) setPresence(savedPresence);
  }, [savedPresence]);
  useEffect(() => {
    setStatusMsg(savedStatusMsg);
  }, [savedStatusMsg]);

  const statusRef = useRef(statusMsg);
  statusRef.current = statusMsg;

  const [presenceState, applyPresence] = useAsyncCallback<
    UserPresence | undefined,
    Error,
    [Presence]
  >(
    useCallback(
      (nextPresence: Presence) => setOwnPresence(nextPresence, statusRef.current),
      [setOwnPresence]
    )
  );
  const applyingPresence = presenceState.status === AsyncStatus.Loading;

  const [statusState, saveStatus] = useAsyncCallback<UserPresence | undefined, Error, [string]>(
    useCallback(
      (nextStatusMsg: string) => setOwnPresence(presence, nextStatusMsg),
      [setOwnPresence, presence]
    )
  );
  const savingStatus = statusState.status === AsyncStatus.Loading;

  const handlePresenceChange = (nextPresence: Presence) => {
    if (nextPresence === presence || applyingPresence) return;
    setPresence(nextPresence);
    applyPresence(nextPresence);
  };

  const handleStatusChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setStatusMsg(evt.currentTarget.value);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (savingStatus) return;
    saveStatus(statusMsg.trim());
  };

  const handleReset = () => {
    setStatusMsg(savedStatusMsg);
  };

  const getAsyncError = (state: typeof presenceState | typeof statusState) =>
    state.status === AsyncStatus.Error ? state.error : undefined;
  const error = getAsyncError(presenceState) ?? getAsyncError(statusState);
  const busy = applyingPresence || savingStatus || presenceSupported === false;
  const hasChanges = statusMsg !== savedStatusMsg;

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Presence</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Status"
          description={
            presenceSupported === false
              ? 'Your homeserver has presence disabled, therefore no presence or status can be published.'
              : 'Other users see your presence next to your avatar and your status message on your profile.'
          }
        >
          <Box direction="Column" grow="Yes" gap="200" style={{ marginTop: config.space.S200 }}>
            <PresenceSelector value={presence} onChange={handlePresenceChange} disabled={busy} />
            <Box as="form" onSubmit={handleSubmit} gap="200" aria-disabled={busy}>
              <Box grow="Yes" direction="Column">
                <Input
                  name="statusMsgInput"
                  style={{ width: '100%', paddingRight: config.space.S200 }}
                  variant="Secondary"
                  radii="300"
                  size="500"
                  placeholder="What's happening? (visible to other users)"
                  value={statusMsg}
                  onChange={handleStatusChange}
                  maxLength={MAX_PRESENCE_STATUS_LENGTH}
                  autoComplete="off"
                  readOnly={busy}
                  after={
                    hasChanges &&
                    !busy && (
                      <IconButton
                        type="button"
                        onClick={handleReset}
                        size="300"
                        radii="300"
                        variant="Secondary"
                        aria-label="Reset Status"
                      >
                        <Icon src={Icons.Cross} size="100" />
                      </IconButton>
                    )
                  }
                />
              </Box>
              <Box shrink="No">
                <Button
                  type="submit"
                  size="500"
                  variant={hasChanges ? 'Success' : 'Secondary'}
                  fill={hasChanges ? 'Solid' : 'Soft'}
                  outlined
                  radii="300"
                  disabled={!hasChanges || busy}
                >
                  {savingStatus && <Spinner variant="Success" fill="Solid" size="300" />}
                  <Text size="B400">Save</Text>
                </Button>
              </Box>
            </Box>
            <Text size="T200" priority="300">
              {`${statusMsg.length}/${MAX_PRESENCE_STATUS_LENGTH}`}
            </Text>
            {error && (
              <Text style={{ color: color.Critical.Main }} size="T200">
                {error.message}
              </Text>
            )}
          </Box>
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
