import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

export const Gallery = style([
  DefaultReset,
  {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: config.space.S100,
    width: toRem(400),
    maxWidth: '100%',
    borderRadius: config.radii.R400,
    overflow: 'hidden',
  },
]);

export const GalleryTile = style([
  DefaultReset,
  {
    position: 'relative',
    aspectRatio: '1 / 1',
    overflow: 'hidden',
  },
]);

// With an odd number of tiles the first one spans the full row.
export const GalleryTileWide = style({
  gridColumn: '1 / -1',
  aspectRatio: '2 / 1',
});
