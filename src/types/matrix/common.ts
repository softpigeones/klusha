import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { MsgType } from 'matrix-js-sdk';

export const MATRIX_BLUR_HASH_PROPERTY_NAME = 'xyz.amorgan.blurhash';
export const MATRIX_SPOILER_PROPERTY_NAME = 'page.codeberg.everypizza.msc4193.spoiler';
export const MATRIX_SPOILER_REASON_PROPERTY_NAME = 'page.codeberg.everypizza.msc4193.spoiler.reason';

// MSC4274: inline media galleries via msgtypes
export const MATRIX_GALLERY_MSGTYPE = 'm.gallery';
export const MATRIX_GALLERY_UNSTABLE_MSGTYPE = 'dm.filament.gallery';
export const isGalleryMsgType = (msgType: unknown): boolean =>
  msgType === MATRIX_GALLERY_MSGTYPE || msgType === MATRIX_GALLERY_UNSTABLE_MSGTYPE;

export type IImageInfo = {
  w?: number;
  h?: number;
  mimetype?: string;
  size?: number;
  [MATRIX_BLUR_HASH_PROPERTY_NAME]?: string;
};

export type IVideoInfo = {
  w?: number;
  h?: number;
  mimetype?: string;
  size?: number;
  duration?: number;
};

export type IAudioInfo = {
  mimetype?: string;
  size?: number;
  duration?: number;
};

export type IFileInfo = {
  mimetype?: string;
  size?: number;
};

export type IEncryptedFile = EncryptedAttachmentInfo & {
  url: string;
};

export type IThumbnailContent = {
  thumbnail_info?: IImageInfo;
  thumbnail_file?: IEncryptedFile;
  thumbnail_url?: string;
};

export type IImageContent = {
  msgtype: MsgType.Image;
  body?: string;
  filename?: string;
  url?: string;
  info?: IImageInfo & IThumbnailContent;
  file?: IEncryptedFile;
  [MATRIX_SPOILER_PROPERTY_NAME]?: boolean;
  [MATRIX_SPOILER_REASON_PROPERTY_NAME]?: string;
};

export type IVideoContent = {
  msgtype: MsgType.Video;
  body?: string;
  filename?: string;
  url?: string;
  info?: IVideoInfo & IThumbnailContent;
  file?: IEncryptedFile;
  [MATRIX_SPOILER_PROPERTY_NAME]?: boolean;
  [MATRIX_SPOILER_REASON_PROPERTY_NAME]?: string;
};

export type IAudioContent = {
  msgtype: MsgType.Audio;
  body?: string;
  filename?: string;
  url?: string;
  info?: IAudioInfo;
  file?: IEncryptedFile;
};

export type IFileContent = {
  msgtype: MsgType.File;
  body?: string;
  filename?: string;
  url?: string;
  info?: IFileInfo & IThumbnailContent;
  file?: IEncryptedFile;
};

export type ILocationContent = {
  msgtype: MsgType.Location;
  body?: string;
  geo_uri?: string;
  info?: IThumbnailContent;
};

export type IGalleryItemType = MsgType.Image | MsgType.Video | MsgType.Audio | MsgType.File;

// Same schema as the content of the matching msgtype, but keyed by `itemtype`
// instead of `msgtype`.
export type IGalleryItem = Omit<
  IImageContent | IVideoContent | IAudioContent | IFileContent,
  'msgtype'
> & {
  itemtype: IGalleryItemType;
};

export type IGalleryContent = {
  msgtype: typeof MATRIX_GALLERY_MSGTYPE | typeof MATRIX_GALLERY_UNSTABLE_MSGTYPE;
  body?: string;
  format?: string;
  formatted_body?: string;
  itemtypes?: IGalleryItem[];
};
