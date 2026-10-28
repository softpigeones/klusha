import React, {
  KeyboardEventHandler,
  RefObject,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import { EventType, IContent, MatrixClient, MsgType, RelationType, Room } from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { Transforms, Editor } from 'slate';
import {
  Box,
  Dialog,
  Icon,
  IconButton,
  Icons,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  Scroll,
  Text,
  config,
  toRem,
} from 'folds';

// MSC4549: extract audio metadata (ID3/Vorbis/etc.) and compute cover-art blurhash.
import { parseBlob as parseAudioMetadata } from 'music-metadata';
import { encode as encodeBlurhash } from 'blurhash';

import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  CustomEditor,
  Toolbar,
  toMatrixCustomHTML,
  toPlainText,
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  AutocompleteQuery,
  getAutocompleteQuery,
  getPrevWordRange,
  resetEditor,
  RoomMentionAutocomplete,
  UserMentionAutocomplete,
  EmoticonAutocomplete,
  createEmoticonElement,
  moveCursor,
  resetEditorHistory,
  customHtmlEqualsPlainText,
  trimCustomHtml,
  isEmptyEditor,
  getBeginCommand,
  trimCommand,
  getMentions,
} from '../../components/editor';
import { EmojiBoard, EmojiBoardTab } from '../../components/emoji-board';
import { UseStateProvider } from '../../components/UseStateProvider';
import {
  TUploadContent,
  encryptFile,
  getImageInfo,
  getMxIdLocalPart,
  mxcUrlToHttp,
} from '../../utils/matrix';
import { useTypingStatusUpdater } from '../../hooks/useTypingStatusUpdater';
import { useFilePicker } from '../../hooks/useFilePicker';
import { useFilePasteHandler } from '../../hooks/useFilePasteHandler';
import { useFileDropZone } from '../../hooks/useFileDrop';
import {
  TUploadItem,
  TUploadMetadata,
  roomIdToMsgDraftAtomFamily,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from '../../state/room/roomInputDrafts';
import { UploadCardRenderer } from '../../components/upload-card';
import {
  UploadBoard,
  UploadBoardContent,
  UploadBoardHeader,
  UploadBoardImperativeHandlers,
} from '../../components/upload-board';
import {
  Upload,
  UploadStatus,
  UploadSuccess,
  createUploadFamilyObserverAtom,
} from '../../state/upload';
import { getImageUrlBlob, loadImageElement } from '../../utils/dom';
import { safeFile } from '../../utils/mimeTypes';
import { fulfilledPromiseSettledResult } from '../../utils/common';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import {
  getAudioMsgContent,
  getFileMsgContent,
  getImageMsgContent,
  getVideoMsgContent,
} from './msgContent';
import { getMemberDisplayName, getMentionContent, trimReplyFromBody } from '../../utils/room';
import { CommandAutocomplete } from './CommandAutocomplete';
import { Command, SHRUG, TABLEFLIP, UNFLIP, useCommands } from '../../hooks/useCommands';
import { mobileOrTablet } from '../../utils/user-agent';
import { useElementSizeObserver } from '../../hooks/useElementSizeObserver';
import { ReplyLayout, ThreadIndicator } from '../../components/message';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import colorMXID from '../../../util/colorMXID';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { useComposingCheck } from '../../hooks/useComposingCheck';
import { MATRIX_GALLERY_UNSTABLE_MSGTYPE } from '../../../types/matrix/common';

// Each gallery item adds roughly 1 KB to the event; the event limit is 64 KiB.
const MAX_GALLERY_ITEMS = 50;

/**
 * MSC4549: Extract audio metadata from an uploaded file and (optionally)
 * upload the embedded cover art, returning a payload suitable for
 * `info["org.matrix.msc4549.audio_metadata"]`.
 *
 * The unstable key is used because the MSC is not yet in the spec; switch
 * to `audio_metadata` once MSC4549 is merged.
 *
 * Returns `undefined` if the file has no usable metadata — callers should
 * then send the plain `m.audio` event unchanged.
 */
async function extractMSC4549AudioMetadata(
  fileItem: TUploadItem,
  mx: MatrixClient,
  room: Room
): Promise<Record<string, unknown> | undefined> {
  let metadata;
  try {
    // Parse the *original* (unencrypted) file: `fileItem.file` may be the
    // encrypted blob when the room is encrypted.
    metadata = await parseAudioMetadata(fileItem.originalFile, { duration: false });
  } catch (err) {
    // Unknown container / no tags — nothing to add.
    return undefined;
  }

  const result: Record<string, unknown> = {};

  if (metadata.common.title) result.title = metadata.common.title;
  if (metadata.common.artist) result.artist = metadata.common.artist;
  if (metadata.common.album) result.album = metadata.common.album;

  const picture = metadata.common.picture?.[0];
  if (picture) {
    try {
      const blob = new Blob([picture.data as BlobPart], { type: picture.format });
      const ext = (picture.format.split('/')[1] || 'jpg').split(';')[0];
      const coverFile = new File([blob], `cover.${ext}`, { type: picture.format });

      if (room.hasEncryptionStateEvent()) {
        const encrypted = await encryptFile(coverFile);
        const uploaded = await mx.uploadContent(encrypted.file);
        result.cover_art_file = {
          url: uploaded.content_uri,
          ...encrypted.encInfo,
        };
      } else {
        const uploaded = await mx.uploadContent(coverFile);
        result.cover_art = uploaded.content_uri;
      }

      result.cover_art_info = {
        mimetype: picture.format,
        ...(picture.width ? { w: picture.width } : {}),
        ...(picture.height ? { h: picture.height } : {}),
        size: blob.size,
      };

      // MSC4549 `cover_art_blurhash`: compute from the same image.
      try {
        result.cover_art_blurhash = await computeBlurhash(blob);
      } catch {
        // Non-fatal: receiving clients will just skip the placeholder.
      }
    } catch (err) {
      // Cover art upload / encryption failed — keep text metadata, drop cover.
      // eslint-disable-next-line no-console
      console.warn('[MSC4549] Failed to upload cover art:', err);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/** Decode-to-canvas → encode as a compact BlurHash. */
function computeBlurhash(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No 2D context'));
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        resolve(encodeBlurhash(data, size, size, 4, 3));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for BlurHash'));
    };
    img.src = url;
  });
}

interface RoomInputProps {
  editor: Editor;
  fileDropContainerRef: RefObject<HTMLElement>;
  roomId: string;
  room: Room;
}
export const RoomInput = forwardRef<HTMLDivElement, RoomInputProps>(
  ({ editor, fileDropContainerRef, roomId, room }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
    const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
    // MSC4549: toggle for attaching audio metadata to outgoing `m.audio`
    // events. Default is ON — the setting lets users opt out. Add
    // `msc4549AudioMetadata: boolean` to the Settings type (default `true`)
    // so this key resolves via `useSetting`.
    const [msc4549AudioMetadataSetting] = useSetting(settingsAtom, 'msc4549AudioMetadata');
    const msc4549AudioMetadata = msc4549AudioMetadataSetting ?? true;

    const direct = useIsDirectRoom();
    const commands = useCommands(mx, room);
    const emojiBtnRef = useRef<HTMLButtonElement>(null);
    const roomToParents = useAtomValue(roomToParentsAtom);
    const powerLevels = usePowerLevelsContext();
    const creators = useRoomCreators(room);

    const [msgDraft, setMsgDraft] = useAtom(roomIdToMsgDraftAtomFamily(roomId));
    const [replyDraft, setReplyDraft] = useAtom(roomIdToReplyDraftAtomFamily(roomId));
    const replyUserID = replyDraft?.userId;

    const powerLevelTags = usePowerLevelTags(room, powerLevels);
    const creatorsTag = useRoomCreatorsTag();
    const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
    const theme = useTheme();
    const accessibleTagColors = useAccessiblePowerTagColors(
      theme.kind,
      creatorsTag,
      powerLevelTags
    );

    const replyPowerTag = replyUserID ? getMemberPowerTag(replyUserID) : undefined;
    const replyPowerColor = replyPowerTag?.color
      ? accessibleTagColors.get(replyPowerTag.color)
      : undefined;
    const replyUsernameColor =
      legacyUsernameColor || direct ? colorMXID(replyUserID ?? '') : replyPowerColor;

    const [uploadBoard, setUploadBoard] = useState(true);
    const [sendAsGallery, setSendAsGallery] = useState(false);
    const [selectedFiles, setSelectedFiles] = useAtom(roomIdToUploadItemsAtomFamily(roomId));
    const uploadFamilyObserverAtom = createUploadFamilyObserverAtom(
      roomUploadAtomFamily,
      selectedFiles.map((f) => f.file)
    );
    const uploadBoardHandlers = useRef<UploadBoardImperativeHandlers>();

    const pendingCaptionRef = useRef<{
      body: string;
      formattedBody?: string;
      relatesTo?: Record<string, any>;
      mentions?: any;
    } | null>(null);

    const imagePackRooms: Room[] = useImagePackRooms(roomId, roomToParents);

    const [toolbar, setToolbar] = useSetting(settingsAtom, 'editorToolbar');
    const [autocompleteQuery, setAutocompleteQuery] =
      useState<AutocompleteQuery<AutocompletePrefix>>();

    const sendTypingStatus = useTypingStatusUpdater(mx, roomId);

    const handleFiles = useCallback(
      async (files: File[]) => {
        setUploadBoard(true);
        const safeFiles = files.map(safeFile);
        const fileItems: TUploadItem[] = [];

        if (room.hasEncryptionStateEvent()) {
          const encryptFiles = fulfilledPromiseSettledResult(
            await Promise.allSettled(safeFiles.map((f) => encryptFile(f)))
          );
          encryptFiles.forEach((ef) =>
            fileItems.push({
              ...ef,
              metadata: {
                markedAsSpoiler: false,
              },
            })
          );
        } else {
          safeFiles.forEach((f) =>
            fileItems.push({
              file: f,
              originalFile: f,
              encInfo: undefined,
              metadata: {
                markedAsSpoiler: false,
              },
            })
          );
        }
        setSelectedFiles({
          type: 'PUT',
          item: fileItems,
        });
      },
      [setSelectedFiles, room]
    );
    const pickFile = useFilePicker(handleFiles, true);
    const handlePaste = useFilePasteHandler(handleFiles);
    const dropZoneVisible = useFileDropZone(fileDropContainerRef, handleFiles);
    const [hideStickerBtn, setHideStickerBtn] = useState(document.body.clientWidth < 500);

    const isComposing = useComposingCheck();

    useElementSizeObserver(
      useCallback(() => fileDropContainerRef.current, [fileDropContainerRef]),
      useCallback((width) => setHideStickerBtn(width < 500), [])
    );

    useEffect(() => {
      Transforms.insertFragment(editor, msgDraft);
    }, [editor, msgDraft]);

    useEffect(
      () => () => {
        if (!isEmptyEditor(editor)) {
          const parsedDraft = JSON.parse(JSON.stringify(editor.children));
          setMsgDraft(parsedDraft);
        } else {
          setMsgDraft([]);
        }
        resetEditor(editor);
        resetEditorHistory(editor);
      },
      [roomId, editor, setMsgDraft]
    );

    const handleFileMetadata = useCallback(
      (fileItem: TUploadItem, metadata: TUploadMetadata) => {
        setSelectedFiles({
          type: 'REPLACE',
          item: fileItem,
          replacement: { ...fileItem, metadata },
        });
      },
      [setSelectedFiles]
    );

    const handleRemoveUpload = useCallback(
      (upload: TUploadContent | TUploadContent[]) => {
        const uploads = Array.isArray(upload) ? upload : [upload];
        setSelectedFiles({
          type: 'DELETE',
          item: selectedFiles.filter((f) => uploads.find((u) => u === f.file)),
        });
        uploads.forEach((u) => roomUploadAtomFamily.remove(u));
      },
      [setSelectedFiles, selectedFiles]
    );

    const handleCancelUpload = (uploads: Upload[]) => {
      uploads.forEach((upload) => {
        if (upload.status === UploadStatus.Loading) {
          mx.cancelUpload(upload.promise);
        }
      });
      handleRemoveUpload(uploads.map((upload) => upload.file));
    };

    const handleSendUpload = async (uploads: UploadSuccess[]) => {
      const caption = pendingCaptionRef.current;
      pendingCaptionRef.current = null;

      const contentsPromises = uploads.map(async (upload) => {
        const fileItem = selectedFiles.find((f) => f.file === upload.file);
        if (!fileItem) throw new Error('Broken upload');

        if (fileItem.file.type.startsWith('image')) {
          return getImageMsgContent(mx, fileItem, upload.mxc);
        }
        if (fileItem.file.type.startsWith('video')) {
          return getVideoMsgContent(mx, fileItem, upload.mxc);
        }
        if (fileItem.file.type.startsWith('audio')) {
          const content = (await getAudioMsgContent(fileItem, upload.mxc)) as IContent & {
            info?: Record<string, any>;
          };
          if (msc4549AudioMetadata) {
            try {
              const audioMeta = await extractMSC4549AudioMetadata(fileItem, mx, room);
              if (audioMeta) {
                content.info = {
                  ...(content.info ?? {}),
                  // Unstable prefix per MSC4549 until it is merged into the spec.
                  'org.matrix.msc4549.audio_metadata': audioMeta,
                };
              }
            } catch (err) {
              // Never block the audio message itself on metadata extraction.
              // eslint-disable-next-line no-console
              console.warn('[MSC4549] Audio metadata extraction failed:', err);
            }
          }
          return content;
        }
        return getFileMsgContent(fileItem, upload.mxc);
      });
      handleCancelUpload(uploads);
      const contents = fulfilledPromiseSettledResult(await Promise.allSettled(contentsPromises));

      if (sendAsGallery && contents.length > 1) {
        // MSC4274: until accepted, the unstable msgtype is used. Chunked to
        // stay well below the 64 KiB event size limit.
        for (let i = 0; i < contents.length; i += MAX_GALLERY_ITEMS) {
          const itemtypes = contents.slice(i, i + MAX_GALLERY_ITEMS).map((content) => {
            const { msgtype, ...item } = content;
            return { ...item, itemtype: msgtype };
          });
          mx.sendMessage(roomId, {
            msgtype: MATRIX_GALLERY_UNSTABLE_MSGTYPE,
            body: caption?.body ?? '',
            ...(caption?.formattedBody
              ? {
                  format: 'org.matrix.custom.html',
                  formatted_body: caption.formattedBody,
                }
              : {}),
            ...(caption?.relatesTo ? { 'm.relates_to': caption.relatesTo } : {}),
            ...(caption?.mentions ? { 'm.mentions': caption.mentions } : {}),
            itemtypes,
          } as any);
        }
        return;
      }

      contents.forEach((content, index) => {
        if (index === 0 && caption) {
          const mediaContent: any = { ...content };

          if (caption.body) {
            if (!mediaContent.filename) {
              mediaContent.filename = mediaContent.body;
            }
            mediaContent.body = caption.body;
            if (caption.formattedBody) {
              mediaContent.format = 'org.matrix.custom.html';
              mediaContent.formatted_body = caption.formattedBody;
            }
          }
          if (caption.relatesTo) {
            mediaContent['m.relates_to'] = caption.relatesTo;
          }
          if (caption.mentions) {
            mediaContent['m.mentions'] = caption.mentions;
          }
          mx.sendMessage(roomId, mediaContent);
        } else {
          mx.sendMessage(roomId, content as any);
        }
      });
    };

    const submit = useCallback(() => {
      const hasFiles = selectedFiles.length > 0;

      const commandName = getBeginCommand(editor);
      let plainText = toPlainText(editor.children, isMarkdown).trim();
      let customHtml = trimCustomHtml(
        toMatrixCustomHTML(editor.children, {
          allowTextFormatting: true,
          allowBlockMarkdown: isMarkdown,
          allowInlineMarkdown: isMarkdown,
        })
      );
      let msgType = MsgType.Text;

      if (!hasFiles) {
        if (commandName) {
          plainText = trimCommand(commandName, plainText);
          customHtml = trimCommand(commandName, customHtml);
        }
        if (commandName === Command.Me) {
          msgType = MsgType.Emote;
        } else if (commandName === Command.Notice) {
          msgType = MsgType.Notice;
        } else if (commandName === Command.Shrug) {
          plainText = `${SHRUG} ${plainText}`;
          customHtml = `${SHRUG} ${customHtml}`;
        } else if (commandName === Command.TableFlip) {
          plainText = `${TABLEFLIP} ${plainText}`;
          customHtml = `${TABLEFLIP} ${customHtml}`;
        } else if (commandName === Command.UnFlip) {
          plainText = `${UNFLIP} ${plainText}`;
          customHtml = `${UNFLIP} ${customHtml}`;
        } else if (commandName) {
          const commandContent = commands[commandName as Command];
          if (commandContent) {
            commandContent.exe(plainText);
          }
          resetEditor(editor);
          resetEditorHistory(editor);
          sendTypingStatus(false);
          return;
        }
      }

      if (!hasFiles && plainText === '') return;

      const mentionData = getMentions(mx, roomId, editor);
      if (replyDraft && replyDraft.userId !== mx.getUserId()) {
        mentionData.users.add(replyDraft.userId);
      }
      const mMentions = getMentionContent(
        Array.from(mentionData.users),
        mentionData.room
      );

      let relatesTo: Record<string, any> | undefined;
      if (replyDraft) {
        relatesTo = {
          'm.in_reply_to': { event_id: replyDraft.eventId },
        };
        if (replyDraft.relation?.rel_type === RelationType.Thread) {
          relatesTo.event_id = replyDraft.relation.event_id;
          relatesTo.rel_type = RelationType.Thread;
          relatesTo.is_falling_back = false;
        }
      }

      if (hasFiles) {
        pendingCaptionRef.current = {
          body: plainText,
          formattedBody:
            customHtml && !customHtmlEqualsPlainText(customHtml, plainText)
              ? customHtml
              : undefined,
          relatesTo,
          mentions: mMentions,
        };

        uploadBoardHandlers.current?.handleSend();

        resetEditor(editor);
        resetEditorHistory(editor);
        setReplyDraft(undefined);
        sendTypingStatus(false);
        return;
      }

      const content: IContent = {
        msgtype: msgType,
        body: plainText,
        'm.mentions': mMentions,
      };

      if (relatesTo || !customHtmlEqualsPlainText(customHtml, plainText)) {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = customHtml;
      }
      if (relatesTo) {
        content['m.relates_to'] = relatesTo;
      }

      mx.sendMessage(roomId, content as any);
      resetEditor(editor);
      resetEditorHistory(editor);
      setReplyDraft(undefined);
      sendTypingStatus(false);
    }, [
      mx,
      roomId,
      editor,
      replyDraft,
      sendTypingStatus,
      setReplyDraft,
      isMarkdown,
      commands,
      selectedFiles,
    ]);

    const handleKeyDown: KeyboardEventHandler = useCallback(
      (evt) => {
        if (
          (isKeyHotkey('mod+enter', evt) || (!enterForNewline && isKeyHotkey('enter', evt))) &&
          !isComposing(evt)
        ) {
          evt.preventDefault();
          submit();
        }
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          if (autocompleteQuery) {
            setAutocompleteQuery(undefined);
            return;
          }
          setReplyDraft(undefined);
        }
      },
      [submit, setReplyDraft, enterForNewline, autocompleteQuery, isComposing]
    );

    const handleKeyUp: KeyboardEventHandler = useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          return;
        }

        if (!hideActivity) {
          sendTypingStatus(!isEmptyEditor(editor));
        }

        const prevWordRange = getPrevWordRange(editor);
        const query = prevWordRange
          ? getAutocompleteQuery<AutocompletePrefix>(editor, prevWordRange, AUTOCOMPLETE_PREFIXES)
          : undefined;
        setAutocompleteQuery(query);
      },
      [editor, sendTypingStatus, hideActivity]
    );

    const handleCloseAutocomplete = useCallback(() => {
      setAutocompleteQuery(undefined);
      ReactEditor.focus(editor);
    }, [editor]);

    const handleEmoticonSelect = (key: string, shortcode: string) => {
      editor.insertNode(createEmoticonElement(key, shortcode));
      moveCursor(editor);
    };

    const handleStickerSelect = async (mxc: string, shortcode: string, label: string) => {
      const stickerUrl = mxcUrlToHttp(mx, mxc, useAuthentication);
      if (!stickerUrl) return;

      const info = await getImageInfo(
        await loadImageElement(stickerUrl),
        await getImageUrlBlob(stickerUrl)
      );

      mx.sendEvent(roomId, EventType.Sticker, {
        body: label,
        url: mxc,
        info,
      });
    };

    return (
      <div ref={ref}>
        {selectedFiles.length > 0 && (
          <UploadBoard
            header={
              <UploadBoardHeader
                open={uploadBoard}
                onToggle={() => setUploadBoard(!uploadBoard)}
                uploadFamilyObserverAtom={uploadFamilyObserverAtom}
                onSend={handleSendUpload}
                imperativeHandlerRef={uploadBoardHandlers}
                onCancel={handleCancelUpload}
                gallery={sendAsGallery}
                onToggleGallery={() => setSendAsGallery(!sendAsGallery)}
              />
            }
          >
            {uploadBoard && (
              <Scroll size="300" hideTrack visibility="Hover">
                <UploadBoardContent>
                  {Array.from(selectedFiles)
                    .reverse()
                    .map((fileItem, index) => (
                      <UploadCardRenderer
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        isEncrypted={!!fileItem.encInfo}
                        fileItem={fileItem}
                        setMetadata={handleFileMetadata}
                        onRemove={handleRemoveUpload}
                      />
                    ))}
                </UploadBoardContent>
              </Scroll>
            )}
          </UploadBoard>
        )}
        <Overlay
          open={dropZoneVisible}
          backdrop={<OverlayBackdrop />}
          style={{ pointerEvents: 'none' }}
        >
          <OverlayCenter>
            <Dialog variant="Primary">
              <Box
                direction="Column"
                justifyContent="Center"
                alignItems="Center"
                gap="500"
                style={{ padding: toRem(60) }}
              >
                <Icon size="600" src={Icons.File} />
                <Text size="H4" align="Center">
                  {`Drop Files in "${room?.name || 'Room'}"`}
                </Text>
                <Text align="Center">Drag and drop files here or click for selection dialog</Text>
              </Box>
            </Dialog>
          </OverlayCenter>
        </Overlay>
        {autocompleteQuery?.prefix === AutocompletePrefix.RoomMention && (
          <RoomMentionAutocomplete
            roomId={roomId}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.UserMention && (
          <UserMentionAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Emoticon && (
          <EmoticonAutocomplete
            imagePackRooms={imagePackRooms}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Command && (
          <CommandAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        <CustomEditor
          editableName="RoomInput"
          editor={editor}
          placeholder="Send a message..."
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPaste={handlePaste}
          top={
            replyDraft && (
              <div>
                <Box
                  alignItems="Center"
                  gap="300"
                  style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
                >
                  <IconButton
                    onClick={() => setReplyDraft(undefined)}
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                  >
                    <Icon src={Icons.Cross} size="50" />
                  </IconButton>
                  <Box direction="Row" gap="200" alignItems="Center">
                    {replyDraft.relation?.rel_type === RelationType.Thread && <ThreadIndicator />}
                    <ReplyLayout
                      userColor={replyUsernameColor}
                      username={
                        <Text size="T300" truncate>
                          <b>
                            {getMemberDisplayName(room, replyDraft.userId) ??
                              getMxIdLocalPart(replyDraft.userId) ??
                              replyDraft.userId}
                          </b>
                        </Text>
                      }
                    >
                      <Text size="T300" truncate>
                        {trimReplyFromBody(replyDraft.body)}
                      </Text>
                    </ReplyLayout>
                  </Box>
                </Box>
              </div>
            )
          }
          before={
            <IconButton
              onClick={() => pickFile('*')}
              variant="SurfaceVariant"
              size="300"
              radii="300"
            >
              <Icon src={Icons.PlusCircle} />
            </IconButton>
          }
          after={
            <>
              <IconButton
                variant="SurfaceVariant"
                size="300"
                radii="300"
                onClick={() => setToolbar(!toolbar)}
              >
                <Icon src={toolbar ? Icons.AlphabetUnderline : Icons.Alphabet} />
              </IconButton>
              <UseStateProvider initial={undefined}>
                {(emojiBoardTab: EmojiBoardTab | undefined, setEmojiBoardTab) => (
                  <PopOut
                    offset={16}
                    alignOffset={-44}
                    position="Top"
                    align="End"
                    anchor={
                      emojiBoardTab === undefined
                        ? undefined
                        : emojiBtnRef.current?.getBoundingClientRect() ?? undefined
                    }
                    content={
                      <EmojiBoard
                        tab={emojiBoardTab}
                        onTabChange={setEmojiBoardTab}
                        imagePackRooms={imagePackRooms}
                        returnFocusOnDeactivate={false}
                        onEmojiSelect={handleEmoticonSelect}
                        onCustomEmojiSelect={handleEmoticonSelect}
                        onStickerSelect={handleStickerSelect}
                        requestClose={() => {
                          setEmojiBoardTab((t) => {
                            if (t) {
                              if (!mobileOrTablet()) ReactEditor.focus(editor);
                              return undefined;
                            }
                            return t;
                          });
                        }}
                      />
                    }
                  >
                    {!hideStickerBtn && (
                      <IconButton
                        aria-pressed={emojiBoardTab === EmojiBoardTab.Sticker}
                        onClick={() => setEmojiBoardTab(EmojiBoardTab.Sticker)}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                      >
                        <Icon
                          src={Icons.Sticker}
                          filled={emojiBoardTab === EmojiBoardTab.Sticker}
                        />
                      </IconButton>
                    )}
                    <IconButton
                      ref={emojiBtnRef}
                      aria-pressed={
                        hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                      }
                      onClick={() => setEmojiBoardTab(EmojiBoardTab.Emoji)}
                      variant="SurfaceVariant"
                      size="300"
                      radii="300"
                    >
                      <Icon
                        src={Icons.Smile}
                        filled={
                          hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                        }
                      />
                    </IconButton>
                  </PopOut>
                )}
              </UseStateProvider>
              <IconButton onClick={submit} variant="SurfaceVariant" size="300" radii="300">
                <Icon src={Icons.Send} />
              </IconButton>
            </>
          }
          bottom={
            toolbar && (
              <div>
                <Line variant="SurfaceVariant" size="300" />
                <Toolbar />
              </div>
            )
          }
        />
      </div>
    );
  }
);
