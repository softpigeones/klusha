import {
  Align,
  as,
  Badge,
  Box,
  color,
  ContainerColor,
  MainColor,
  Position,
  Text,
  Tooltip,
  TooltipProvider,
} from 'folds';
import React, { ReactNode, useId } from 'react';
import * as css from './styles.css';
import { Presence, UserPresence } from '../../state/presence';
import { usePresenceLabel } from '../../hooks/useUserPresence';
import { getLastActiveText } from '../../utils/presence';
import { BreakWord } from '../../styles/Text.css';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

const PresenceToColor: Record<Presence, MainColor> = {
  [Presence.Online]: 'Success',
  [Presence.Unavailable]: 'Warning',
  [Presence.Offline]: 'Secondary',
};

export const getPresenceColor = (presence: Presence): MainColor => PresenceToColor[presence];

/**
 * Text shown for the last activity of a user. Users which the server reports as
 * "currently active" do not need a timestamp, everybody else gets one with
 * seconds precision.
 */
export const usePresenceLastActiveText = (
  presence?: Presence,
  lastActiveTs?: number,
  currentlyActive?: boolean
): string | undefined => {
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');

  if (!presence || currentlyActive) return undefined;
  return getLastActiveText(lastActiveTs ?? 0, hour24Clock);
};

type PresenceTooltipContentProps = {
  presence: Presence;
  status?: string;
  lastActiveText?: string;
};
export function PresenceTooltipContent({
  presence,
  status,
  lastActiveText,
}: PresenceTooltipContentProps) {
  const label = usePresenceLabel();

  return (
    <Box className={css.PresenceTooltipContent} direction="Column" gap="100">
      <Box alignItems="Baseline" gap="100">
        <Text size="L400">{label[presence]}</Text>
        {status && <Text size="T200">•</Text>}
        {status && (
          <Text className={BreakWord} size="T200" priority="300">
            {status}
          </Text>
        )}
      </Box>
      {lastActiveText && (
        <Text size="T200" priority="300">
          {lastActiveText}
        </Text>
      )}
    </Box>
  );
}

type PresenceBadgeProps = {
  presence: Presence;
  status?: string;
  lastActiveTs?: number;
  currentlyActive?: boolean;
  size?: '200' | '300' | '400' | '500';
  tooltipPosition?: Position;
  tooltipAlign?: Align;
};
export function PresenceBadge({
  presence,
  status,
  lastActiveTs,
  currentlyActive,
  size,
  tooltipPosition = 'Right',
  tooltipAlign = 'Center',
}: PresenceBadgeProps) {
  const badgeLabelId = useId();
  const lastActiveText = usePresenceLastActiveText(presence, lastActiveTs, currentlyActive);

  return (
    <TooltipProvider
      position={tooltipPosition}
      align={tooltipAlign}
      offset={4}
      delay={200}
      tooltip={
        <Tooltip id={badgeLabelId}>
          <PresenceTooltipContent
            presence={presence}
            status={status}
            lastActiveText={lastActiveText}
          />
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <Badge
          aria-labelledby={badgeLabelId}
          ref={triggerRef}
          size={size}
          variant={PresenceToColor[presence]}
          fill={presence === Presence.Offline ? 'Soft' : 'Solid'}
          radii="Pill"
        />
      )}
    </TooltipProvider>
  );
}

type UserPresenceBadgeProps = {
  presence?: UserPresence;
  size?: '200' | '300' | '400' | '500';
  tooltipPosition?: Position;
  tooltipAlign?: Align;
};
/**
 * Renders the presence badge of a user, or nothing when no presence is known.
 * Not knowing anything about a user is different from the user being offline,
 * the homeserver may have presence disabled or hide last seen information.
 */
export function UserPresenceBadge({
  presence,
  size,
  tooltipPosition,
  tooltipAlign,
}: UserPresenceBadgeProps) {
  if (!presence) return null;

  return (
    <PresenceBadge
      size={size}
      tooltipPosition={tooltipPosition}
      tooltipAlign={tooltipAlign}
      {...presence}
    />
  );
}

type AvatarPresenceProps = {
  badge: ReactNode;
  variant?: ContainerColor;
};
export const AvatarPresence = as<'div', AvatarPresenceProps>(
  ({ as: AsAvatarPresence, badge, variant = 'Surface', children, ...props }, ref) => (
    <Box as={AsAvatarPresence} className={css.AvatarPresence} {...props} ref={ref}>
      {badge && (
        <div
          className={css.AvatarPresenceBadge}
          style={{ backgroundColor: color[variant].Container }}
        >
          {badge}
        </div>
      )}
      {children}
    </Box>
  )
);

type PresenceStatusChipProps = {
  presence: Presence;
  status: string;
};
/**
 * Renders the `status_msg` of a user inside a framed box, so that it is
 * recognizable as a temporary status message and not as part of the profile.
 */
export function PresenceStatusChip({ status }: PresenceStatusChipProps) {
  const badgeLabelId = useId();

  return (
    <Box aria-labelledby={badgeLabelId} className={css.PresenceStatusChip}>
      <Text id={badgeLabelId} className={BreakWord} size="T200" priority="300">
        {status}
      </Text>
    </Box>
  );
}
