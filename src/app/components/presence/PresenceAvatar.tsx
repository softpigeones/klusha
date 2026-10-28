import React, { ReactNode } from 'react';
import { Align, ContainerColor, Position } from 'folds';
import { AvatarPresence, UserPresenceBadge } from './Presence';
import { useShowPresence, useUserPresence } from '../../hooks/useUserPresence';
import * as css from './styles.css';

type PresenceAvatarProps = {
  userId?: string;
  /** Container color of the surface the avatar is rendered on, used for the badge ring. */
  ringVariant?: ContainerColor;
  badgeSize?: '200' | '300' | '400' | '500';
  tooltipPosition?: Position;
  tooltipAlign?: Align;
  className?: string;
  children: ReactNode;
};

/**
 * Renders an avatar with the live presence badge of the user.
 *
 * Presence is read from the global presence store which is fed by `/sync`, therefore the
 * badge updates on its own without the room (or the profile) being re-opened. Nothing is
 * rendered around the avatar when presence indicators are turned off in the settings or
 * when the homeserver never told us anything about the user.
 */
export function PresenceAvatar({
  userId,
  ringVariant = 'Surface',
  badgeSize = '200',
  tooltipPosition,
  tooltipAlign,
  className,
  children,
}: PresenceAvatarProps) {
  const showPresence = useShowPresence();
  const presence = useUserPresence(showPresence ? userId : undefined);

  if (!presence) return children;

  return (
    <AvatarPresence
      className={[css.PresenceAvatarSized, className]
        .filter(Boolean)
        .join(' ')}
      variant={ringVariant}
      badge={
        <UserPresenceBadge
          presence={presence}
          size={badgeSize}
          tooltipPosition={tooltipPosition}
          tooltipAlign={tooltipAlign}
        />
      }
    >
      {children}
    </AvatarPresence>
  );
}
