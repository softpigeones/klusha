import React, { useEffect, useRef } from 'react';
import { MsgType } from 'matrix-js-sdk';
import classNames from 'classnames';
import { Box, Icon, IconButton, Icons, config } from 'folds';
import { decode as decodeBlurhash } from 'blurhash';
import {
  AudioContent,
  BrokenContent,
  DownloadFile,
  FileContent,
  ImageContent,
  MAudio,
  MFile,
  MImage,
  MVideo,
  ReadPdfFile,
  ReadTextFile,
  ThumbnailContent,
  VideoContent,
} from './message';
import { Image, MediaControl, Video } from './media';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './Pdf-viewer';
import { TextViewer } from './text-viewer';
import {
  IGalleryContent,
  IGalleryItem,
  IImageContent,
  isGalleryMsgType,
  MATRIX_SPOILER_PROPERTY_NAME,
  MATRIX_SPOILER_REASON_PROPERTY_NAME,
} from '../../types/matrix/common';
import * as galleryCss from './message/Gallery.css';

/* -------------------------------------------------------------------------- */
/*  MSC4549: Audio metadata for `m.audio` events                              */
/* -------------------------------------------------------------------------- */

export type AudioMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  cover_art?: string;
  cover_art_file?: Record<string, unknown>;
  cover_art_info?: Record<string, unknown>;
  cover_art_blurhash?: string;
};

const MSC4549_STABLE_KEY = 'audio_metadata';
const MSC4549_UNSTABLE_KEY = 'org.matrix.msc4549.audio_metadata';

/**
 * Extract MSC4549 audio metadata from an `m.audio` event's `info` object.
 * Supports both the unstable (pre-spec) and stable property names.
 */
export const getAudioMetadata = (info: unknown): AudioMetadata | undefined => {
  if (!info || typeof info !== 'object') return undefined;
  const infoObj = info as Record<string, unknown>;
  const raw = infoObj[MSC4549_UNSTABLE_KEY] ?? infoObj[MSC4549_STABLE_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as AudioMetadata;
};

/**
 * Renders a BlurHash into a canvas used as a cover-art placeholder.
 * Per MSC4549, clients that cannot decode a BlurHash (including an invalid
 * value) SHOULD ignore it — hence the try/catch and silent failure.
 */
function BlurhashPlaceholder({
  hash,
  width,
  height,
}: {
  hash: string;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const pixels = decodeBlurhash(hash, width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    } catch {
      // Ignore malformed BlurHash per MSC4549.
    }
  }, [hash, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    />
  );
}

function AudioMetadataDisplay({ metadata }: { metadata: AudioMetadata }) {
  const {
    title,
    artist,
    album,
    cover_art,
    cover_art_file,
    cover_art_info,
    cover_art_blurhash,
  } = metadata;

  const hasCover = !!(cover_art || cover_art_file);
  const hasBlurhash =
    typeof cover_art_blurhash === 'string' && cover_art_blurhash.length > 0;
  const hasText = !!(title || artist || album);

  if (!hasCover && !hasBlurhash && !hasText) return null;

  const coverSize = 56;
  const blurResolution = 32;

  return (
    <Box direction="Row" gap="200" alignItems="Center">
      {(hasCover || hasBlurhash) && (
        <div
          style={{
            position: 'relative',
            width: coverSize,
            height: coverSize,
            borderRadius: 8,
            overflow: 'hidden',
            flexShrink: 0,
            background: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          {hasBlurhash && (
            <BlurhashPlaceholder
              hash={cover_art_blurhash as string}
              width={blurResolution}
              height={blurResolution}
            />
          )}
          {hasCover && (
            <div style={{ position: 'absolute', inset: 0 }}>
              <ImageContent
                body={title ?? 'Cover art'}
                info={cover_art_info as never}
                mimeType={
                  (cover_art_info as { mimetype?: string } | undefined)?.mimetype
                }
                url={cover_art}
                encInfo={cover_art_file as never}
                renderImage={(p) => (
                  <Image
                    {...p}
                    alt={title ?? 'Cover art'}
                    title={title ?? 'Cover art'}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                )}
                renderViewer={(p) => <ImageViewer {...p} />}
              />
            </div>
          )}
        </div>
      )}
      {hasText && (
        <Box direction="Column" gap="0" style={{ flex: 1, minWidth: 0 }}>
          {title && (
            <span
              style={{
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </span>
          )}
          {artist && (
            <span
              style={{
                opacity: 0.8,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {artist}
            </span>
          )}
          {album && (
            <span
              style={{
                opacity: 0.6,
                fontSize: '0.9em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {album}
            </span>
          )}
        </Box>
      )}
    </Box>
  );
}

/* -------------------------------------------------------------------------- */

export const isMediaMsgType = (msgType: string): boolean =>
  msgType === MsgType.Image ||
  msgType === MsgType.Video ||
  msgType === MsgType.Audio ||
  msgType === MsgType.File ||
  isGalleryMsgType(msgType);

export type MediaActionHandler = (index: number) => void;

type MediaActionsProps = {
  onRemove?: () => void;
  onReplace?: () => void;
};

function MediaActions({ onRemove, onReplace }: MediaActionsProps) {
  if (!onRemove && !onReplace) return null;
  return (
    <Box
      gap="100"
      style={{
        position: 'absolute',
        top: config.space.S100,
        right: config.space.S100,
        zIndex: 1,
      }}
    >
      {onReplace && (
        <IconButton
          title="Replace"
          aria-label="Replace"
          variant="SurfaceVariant"
          size="300"
          radii="300"
          outlined
          onClick={onReplace}
        >
          <Icon size="100" src={Icons.Reload} />
        </IconButton>
      )}
      {onRemove && (
        <IconButton
          title="Remove"
          aria-label="Remove"
          variant="SurfaceVariant"
          size="300"
          radii="300"
          outlined
          onClick={onRemove}
        >
          <Icon size="100" src={Icons.Delete} />
        </IconButton>
      )}
    </Box>
  );
}

export type RenderMediaContentProps = {
  msgType: string;
  getContent: <T>() => T;
  mediaAutoLoad?: boolean;
  outlineAttachment?: boolean;
  onRemove?: MediaActionHandler;
  onReplace?: MediaActionHandler;
};

export function RenderMediaContent({
  msgType,
  getContent,
  mediaAutoLoad,
  outlineAttachment,
  onRemove,
  onReplace,
}: RenderMediaContentProps) {
  const hasActions = !!onRemove || !!onReplace;

  const withActions = (node: React.ReactElement) => {
    if (!hasActions) return node;
    return (
      <div style={{ position: 'relative', width: 'fit-content', maxWidth: '100%' }}>
        {node}
        <MediaActions
          onRemove={onRemove ? () => onRemove(0) : undefined}
          onReplace={onReplace ? () => onReplace(0) : undefined}
        />
      </div>
    );
  };

  const renderFile = () => (
    <MFile
      content={getContent()}
      renderFileContent={({ body, mimeType, info, encInfo, url }) => (
        <FileContent
          body={body}
          mimeType={mimeType}
          renderAsPdfFile={() => (
            <ReadPdfFile
              body={body}
              mimeType={mimeType}
              url={url}
              encInfo={encInfo}
              renderViewer={(p) => <PdfViewer {...p} />}
            />
          )}
          renderAsTextFile={() => (
            <ReadTextFile
              body={body}
              mimeType={mimeType}
              url={url}
              encInfo={encInfo}
              renderViewer={(p) => <TextViewer {...p} />}
            />
          )}
        >
          <DownloadFile body={body} mimeType={mimeType} url={url} encInfo={encInfo} info={info} />
        </FileContent>
      )}
      outlined={outlineAttachment}
    />
  );

  if (msgType === MsgType.Image) {
    return withActions(
      <MImage
        content={getContent()}
        renderImageContent={(props) => (
          <ImageContent
            {...props}
            autoPlay={mediaAutoLoad}
            renderImage={(p) => <Image {...p} loading="lazy" />}
            renderViewer={(p) => <ImageViewer {...p} />}
          />
        )}
        outlined={outlineAttachment}
      />
    );
  }

  if (msgType === MsgType.Video) {
    return withActions(
      <MVideo
        content={getContent()}
        renderAsFile={renderFile}
        renderVideoContent={({ body, info, ...props }) => (
          <VideoContent
            body={body}
            info={info}
            {...props}
            renderThumbnail={
              mediaAutoLoad
                ? () => (
                    <ThumbnailContent
                      info={info}
                      renderImage={(src) => (
                        <Image alt={body} title={body} src={src} loading="lazy" />
                      )}
                    />
                  )
                : undefined
            }
            renderVideo={(p) => <Video {...p} />}
          />
        )}
        outlined={outlineAttachment}
      />
    );
  }

  if (msgType === MsgType.Audio) {
    // MSC4549: Pull audio metadata out of the event's `info` object.
    const audioContent = getContent() as { info?: unknown };
    const audioMetadata = getAudioMetadata(audioContent?.info);

    return withActions(
      <MAudio
        content={getContent()}
        renderAsFile={renderFile}
        renderAudioContent={(props) => (
          <AudioContent
            {...props}
            renderMediaControl={(p) => (
              <Box direction="Column" gap="200" style={{ width: '100%' }}>
                {audioMetadata && <AudioMetadataDisplay metadata={audioMetadata} />}
                <MediaControl {...p} />
              </Box>
            )}
          />
        )}
        outlined={outlineAttachment}
      />
    );
  }

  if (msgType === MsgType.File) {
    return withActions(renderFile());
  }

  if (isGalleryMsgType(msgType)) {
    const content: IGalleryContent = getContent();
    const { itemtypes } = content;
    if (!Array.isArray(itemtypes)) return <BrokenContent />;

    const items = itemtypes.flatMap((item, index) =>
      typeof item === 'object' && item !== null ? [{ item: item as IGalleryItem, index }] : []
    );
    const tiles = items.filter(({ item }) => item.itemtype === MsgType.Image);
    const others = items.filter(({ item }) => item.itemtype !== MsgType.Image);

    return (
      <>
        {tiles.length > 0 && (
          <div className={galleryCss.Gallery}>
            {tiles.map(({ item, index }, tileIndex) => {
              const image = item as IGalleryItem & Omit<IImageContent, 'msgtype'>;
              const mxcUrl = image.file?.url ?? image.url;
              if (typeof mxcUrl !== 'string') return null;
              const wide = tiles.length % 2 === 1 && tileIndex === 0 && tiles.length > 1;
              return (
                <div
                  key={index}
                  className={classNames(galleryCss.GalleryTile, wide && galleryCss.GalleryTileWide)}
                  style={hasActions ? { position: 'relative' } : undefined}
                >
                  <ImageContent
                    body={image.body || 'Image'}
                    info={image.info}
                    mimeType={image.info?.mimetype}
                    url={mxcUrl}
                    encInfo={image.file}
                    autoPlay={mediaAutoLoad}
                    markedAsSpoiler={image[MATRIX_SPOILER_PROPERTY_NAME]}
                    spoilerReason={image[MATRIX_SPOILER_REASON_PROPERTY_NAME]}
                    renderImage={(p) => <Image {...p} loading="lazy" />}
                    renderViewer={(p) => <ImageViewer {...p} />}
                  />
                  <MediaActions
                    onRemove={onRemove ? () => onRemove(index) : undefined}
                    onReplace={onReplace ? () => onReplace(index) : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
        {others.length > 0 && (
          <Box
            direction="Column"
            gap="200"
            alignItems="Start"
            style={tiles.length > 0 ? { marginTop: config.space.S200 } : undefined}
          >
            {others.map(({ item, index }) => (
              <RenderMediaContent
                key={index}
                msgType={item.itemtype}
                getContent={(() => ({ ...item, msgtype: item.itemtype })) as <T>() => T}
                mediaAutoLoad={mediaAutoLoad}
                outlineAttachment={outlineAttachment}
                onRemove={onRemove ? () => onRemove(index) : undefined}
                onReplace={onReplace ? () => onReplace(index) : undefined}
              />
            ))}
          </Box>
        )}
      </>
    );
  }

  return null;
}
