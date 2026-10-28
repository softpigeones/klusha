import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const AvatarPresence = style({
  display: 'flex',
  position: 'relative',
  flexShrink: 0,
});

export const AvatarPresenceBadge = style({
  position: 'absolute',
  bottom: 0,
  right: 0,
  transform: 'translate(25%, 25%)',
  zIndex: 1,

  display: 'flex',
  padding: config.borderWidth.B600,
  backgroundColor: 'inherit',
  borderRadius: config.radii.Pill,
  overflow: 'hidden',
});

/**
 * Applied by PresenceAvatar to keep the wrapper sized to the avatar.
 *
 * A plain `display: flex` wrapper stretches to the full row height
 * inside flex parents that use the default `align-items: stretch`.
 * Since the presence badge is absolutely positioned against this
 * wrapper, that would put the badge at the bottom of the row instead
 * of the avatar's bottom-right corner. The positioning context is
 * repeated here so PresenceAvatar no longer depends on an ancestor
 * providing one.
 */
export const PresenceAvatarSized = style({
  position: 'relative',
  width: 'fit-content',
  height: 'fit-content',
});

/**
 * Container for the `status_msg` of a user.
 *
 * It is rendered as a framed box on purpose, so that a status message is
 * never mistaken for the bio/description of the user.
 */
export const PresenceStatusChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S200,
  alignSelf: 'Start',
  maxWidth: '100%',

  padding: `${config.space.S100} ${config.space.S300}`,
  borderRadius: config.radii.R300,
  borderWidth: config.borderWidth.B300,
  borderStyle: 'solid',
  backgroundColor: color.SurfaceVariant.Container,
  borderColor: color.SurfaceVariant.ContainerLine,
  color: color.SurfaceVariant.OnContainer,
});

export const PresenceTooltipContent = style({
  maxWidth: toRem(250),
});
