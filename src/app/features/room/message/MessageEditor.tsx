import React, {
  KeyboardEventHandler,
  MouseEventHandler,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Line,
  PopOut,
  RectCords,
  Spinner,
  Text,
  as,
  color,
  config,
} from 'folds';
import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { IContent, IMentions, MatrixEvent, MsgType, RelationType, Room } from 'matrix-js-sdk';
import { isKeyHotkey } from 'is-hotkey';
import {
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  AutocompleteQuery,
  CustomEditor,
  EmoticonAutocomplete,
  RoomMentionAutocomplete,
  Toolbar,
  UserMentionAutocomplete,
  createEmoticonElement,
  customHtmlEqualsPlainText,
  getAutocompleteQuery,
  getPrevWordRange,
  htmlToEditorInput,
  moveCursor,
  plainToEditorInput,
  toMatrixCustomHTML,
  toPlainText,
  trimCustomHtml,
  useEditor,
  getMentions,
} from '../../../components/editor';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { UseStateProvider } from '../../../components/UseStateProvider';
import { EmojiBoard } from '../../../components/emoji-board';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getEditedEvent, getMentionContent, trimReplyFromFormattedBody } from '../../../utils/room';
import { mobileOrTablet } from '../../../utils/user-agent';
import { useComposingCheck } from '../../../hooks/useComposingCheck';
import { encryptFile } from '../../../utils/matrix';
import { getDataTransferFiles } from '../../../utils/dom';
import { safeFile } from '../../../utils/mimeTypes';
import { TUploadItem } from '../../../state/room/roomInputDrafts';
import { RenderMediaContent, isMediaMsgType } from '../../../components/RenderMediaContent';
import {
  isGalleryMsgType,
  MATRIX_SPOILER_PROPERTY_NAME,
  MATRIX_SPOILER_REASON_PROPERTY_NAME,
} from '../../../../types/matrix/common';
import {
  getAudioMsgContent,
  getFileMsgContent,
  getImageMsgContent,
  getVideoMsgContent,
} from '../msgContent';

const MEDIA_CONTENT_KEYS = [
  'url',
  'file',
  'info',
  'filename',
  'itemtypes',
  MATRIX_SPOILER_PROPERTY_NAME,
  MATRIX_SPOILER_REASON_PROPERTY_NAME,
];

const pickMediaContent = (c: IContent): IContent => {
  const picked: IContent = { msgtype: c.msgtype };
  MEDIA_CONTENT_KEYS.forEach((key) => {
    if (c[key] !== undefined) picked[key] = c[key];
  });
  return picked;
};

type MessageEditorProps = {
  roomId: string;
  room: Room;
  mEvent: MatrixEvent;
  imagePackRooms?: Room[];
  onCancel: () => void;
};
export const MessageEditor = as<'div', MessageEditorProps>(
  ({ room, roomId, mEvent, imagePackRooms, onCancel, ...props }, ref) => {
    const mx = useMatrixClient();
    const editor = useEditor();
    const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
    const [globalToolbar] = useSetting(settingsAtom, 'editorToolbar');
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [toolbar, setToolbar] = useState(globalToolbar);
    const isComposing = useComposingCheck();

    const [autocompleteQuery, setAutocompleteQuery] =
      useState<AutocompleteQuery<AutocompletePrefix>>();

    const evtId = mEvent.getId()!;
    const evtTimeline = room.getTimelineForEvent(evtId);
    const editedEvent =
      evtTimeline && getEditedEvent(evtId, mEvent, evtTimeline.getTimelineSet());
    const content: IContent = editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent();

    const [mediaPatch, setMediaPatch] = useState<IContent>();
    const media = mediaPatch ?? pickMediaContent(content);
    const isMedia = isMediaMsgType(media.msgtype ?? '');
    const hadCaption = isGalleryMsgType(content.msgtype)
      ? !!content.body
      : !!content.filename && content.filename !== content.body;

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [replaceIndex, setReplaceIndex] = useState<number>();

    const getPrevBodyAndFormattedBody = useCallback((): [
      string | undefined,
      string | undefined,
      IMentions | undefined
    ] => {
      const { body, formatted_body: customHtml }: Record<string, unknown> = content;

      const mMentions: IMentions | undefined = content['m.mentions'];

      return [
        typeof body === 'string' ? body : undefined,
        typeof customHtml === 'string' ? customHtml : undefined,
        mMentions,
      ];
    }, [room, mEvent]);

    const [saveState, save] = useAsyncCallback(
      useCallback(async () => {
        const plainText = toPlainText(editor.children, isMarkdown).trim();
        const customHtml = trimCustomHtml(
          toMatrixCustomHTML(editor.children, {
            allowTextFormatting: true,
            allowBlockMarkdown: isMarkdown,
            allowInlineMarkdown: isMarkdown,
          })
        );

        const [prevBody, prevCustomHtml, prevMentions] = getPrevBodyAndFormattedBody();

        if (plainText === '' && (!mediaPatch || media.msgtype === MsgType.Text)) return undefined;
        if (prevBody && !mediaPatch) {
          if (prevCustomHtml && trimReplyFromFormattedBody(prevCustomHtml) === customHtml) {
            return undefined;
          }
          if (
            !prevCustomHtml &&
            prevBody === plainText &&
            customHtmlEqualsPlainText(customHtml, plainText)
          ) {
            return undefined;
          }
        }

        const body =
          plainText === '' || (!hadCaption && plainText === content.body)
            ? media.filename ?? plainText
            : plainText;

        const newContent: IContent = {
          ...media,
          body,
        };

        const mentionData = getMentions(mx, roomId, editor);

        prevMentions?.user_ids?.forEach((prevMentionId) => {
          mentionData.users.add(prevMentionId);
        });

        const mMentions = getMentionContent(Array.from(mentionData.users), mentionData.room);
        newContent['m.mentions'] = mMentions;

        if (!customHtmlEqualsPlainText(customHtml, plainText)) {
          newContent.format = 'org.matrix.custom.html';
          newContent.formatted_body = customHtml;
        }

        const editContent: IContent = {
          ...newContent,
          body: `* ${body}`,
          'm.new_content': newContent,
          'm.relates_to': {
            event_id: mEvent.getId(),
            rel_type: RelationType.Replace,
          },
        };

        return mx.sendMessage(roomId, editContent);
      }, [
        mx,
        editor,
        roomId,
        mEvent,
        isMarkdown,
        getPrevBodyAndFormattedBody,
        media,
        mediaPatch,
        hadCaption,
        content,
      ])
    );

    const [replaceState, replaceMedia] = useAsyncCallback(
      useCallback(
        async (file: File, index: number) => {
          const safe = safeFile(file);
          const encrypted = room.hasEncryptionStateEvent();
          const item: TUploadItem = encrypted
            ? { ...(await encryptFile(safe)), metadata: { markedAsSpoiler: false } }
            : {
                file: safe,
                originalFile: safe,
                encInfo: undefined,
                metadata: { markedAsSpoiler: false },
              };

          const upload = await mx.uploadContent(item.file, { includeFilename: !encrypted });
          const mxc = upload.content_uri;
          if (!mxc) throw new Error('Upload failed');

          let built: IContent;
          if (item.file.type.startsWith('image')) {
            built = await getImageMsgContent(mx, item, mxc);
          } else if (item.file.type.startsWith('video')) {
            built = await getVideoMsgContent(mx, item, mxc);
          } else if (item.file.type.startsWith('audio')) {
            built = getAudioMsgContent(item, mxc);
          } else {
            built = getFileMsgContent(item, mxc);
          }

          setMediaPatch((prev) => {
            const cur = prev ?? pickMediaContent(content);
            if (isGalleryMsgType(cur.msgtype) && Array.isArray(cur.itemtypes)) {
              const { msgtype, ...rest } = built;
              const nextItem = { ...rest, itemtype: msgtype };
              return {
                ...cur,
                itemtypes: cur.itemtypes.map((it: unknown, i: number) =>
                  i === index ? nextItem : it
                ),
              };
            }
            return pickMediaContent(built);
          });
        },
        [mx, room, content]
      )
    );

    const handleReplaceMedia = useCallback((index: number) => setReplaceIndex(index), []);

    const startReplace = useCallback(
      (file: File) => {
        if (replaceIndex === undefined) return;
        setReplaceIndex(undefined);
        replaceMedia(file, replaceIndex);
      },
      [replaceIndex, replaceMedia]
    );

    useEffect(() => {
      if (replaceIndex === undefined) return undefined;
      const handlePaste = (evt: ClipboardEvent) => {
        const files = evt.clipboardData ? getDataTransferFiles(evt.clipboardData) : undefined;
        if (!files || files.length === 0) return;
        evt.preventDefault();
        evt.stopPropagation();
        setReplaceIndex(undefined);
        replaceMedia(files[0], replaceIndex);
      };
      document.addEventListener('paste', handlePaste, true);
      return () => document.removeEventListener('paste', handlePaste, true);
    }, [replaceIndex, replaceMedia]);

    const handleRemoveMedia = useCallback(
      (index: number) => {
        setReplaceIndex(undefined);
        setMediaPatch((prev) => {
          const cur = prev ?? pickMediaContent(content);
          if (isGalleryMsgType(cur.msgtype) && Array.isArray(cur.itemtypes)) {
            const left = cur.itemtypes.filter((_: unknown, i: number) => i !== index);
            if (left.length > 1) return { ...cur, itemtypes: left };
            const [last] = left;
            if (left.length === 1 && typeof last === 'object' && last !== null) {
              const { itemtype, ...rest } = last;
              return pickMediaContent({
                ...rest,
                msgtype: itemtype,
                filename: rest.filename ?? rest.body,
              });
            }
          }
          return { msgtype: MsgType.Text };
        });
      },
      [content]
    );

    const handleSave = useCallback(() => {
      if (saveState.status !== AsyncStatus.Loading && replaceState.status !== AsyncStatus.Loading) {
        save();
      }
    }, [saveState, replaceState, save]);

    const handleKeyDown: KeyboardEventHandler = useCallback(
      (evt) => {
        if (
          (isKeyHotkey('mod+enter', evt) || (!enterForNewline && isKeyHotkey('enter', evt))) &&
          !isComposing(evt)
        ) {
          evt.preventDefault();
          handleSave();
        }
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          onCancel();
        }
      },
      [onCancel, handleSave, enterForNewline, isComposing]
    );

    const handleKeyUp: KeyboardEventHandler = useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          return;
        }

        const prevWordRange = getPrevWordRange(editor);
        const query = prevWordRange
          ? getAutocompleteQuery<AutocompletePrefix>(editor, prevWordRange, AUTOCOMPLETE_PREFIXES)
          : undefined;
        setAutocompleteQuery(query);
      },
      [editor]
    );

    const handleCloseAutocomplete = useCallback(() => {
      ReactEditor.focus(editor);
      setAutocompleteQuery(undefined);
    }, [editor]);

    const handleEmoticonSelect = (key: string, shortcode: string) => {
      editor.insertNode(createEmoticonElement(key, shortcode));
      moveCursor(editor);
    };

    useEffect(() => {
      const [body, customHtml] = getPrevBodyAndFormattedBody();

      const initialValue =
        typeof customHtml === 'string'
          ? htmlToEditorInput(customHtml, isMarkdown)
          : plainToEditorInput(typeof body === 'string' ? body : '', isMarkdown);

      Transforms.select(editor, {
        anchor: Editor.start(editor, []),
        focus: Editor.end(editor, []),
      });

      editor.insertFragment(initialValue);
      if (!mobileOrTablet()) ReactEditor.focus(editor);
    }, [editor, getPrevBodyAndFormattedBody, isMarkdown]);

    useEffect(() => {
      if (saveState.status === AsyncStatus.Success) {
        onCancel();
      }
    }, [saveState, onCancel]);

    return (
      <div {...props} ref={ref}>
        {isMedia && (
          <RenderMediaContent
            msgType={media.msgtype ?? ''}
            getContent={<T,>() => ({ ...media, body: media.filename ?? content.body } as T)}
            mediaAutoLoad
            onRemove={handleRemoveMedia}
            onReplace={handleReplaceMedia}
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(evt) => {
            const file = evt.target.files?.[0];
            evt.target.value = '';
            if (file) startReplace(file);
          }}
        />
        {replaceIndex !== undefined && (
          <Box
            direction="Column"
            alignItems="Center"
            gap="200"
            style={{
              margin: config.space.S200,
              padding: config.space.S300,
              border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
              borderRadius: config.radii.R300,
            }}
            onDragOver={(evt: React.DragEvent) => evt.preventDefault()}
            onDrop={(evt: React.DragEvent) => {
              evt.preventDefault();
              const files = getDataTransferFiles(evt.dataTransfer);
              if (files && files[0]) startReplace(files[0]);
            }}
          >
            <Text size="T300" style={{ textAlign: 'center' }}>
              Paste a file (Ctrl+V), drop it here, or choose from disk
            </Text>
            <Box gap="200">
              <Chip
                variant="Primary"
                radii="Pill"
                outlined
                onClick={() => fileInputRef.current?.click()}
              >
                <Text size="B300">Choose file</Text>
              </Chip>
              <Chip variant="SurfaceVariant" radii="Pill" onClick={() => setReplaceIndex(undefined)}>
                <Text size="B300">Cancel</Text>
              </Chip>
            </Box>
          </Box>
        )}
        {replaceState.status === AsyncStatus.Loading && (
          <Box alignItems="Center" gap="200" style={{ padding: config.space.S200 }}>
            <Spinner size="100" />
            <Text size="T200">Uploading...</Text>
          </Box>
        )}
        {replaceState.status === AsyncStatus.Error && (
          <Text size="T200" style={{ color: color.Critical.Main, padding: config.space.S200 }}>
            Failed to replace file
          </Text>
        )}
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
            imagePackRooms={imagePackRooms || []}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        <CustomEditor
          editor={editor}
          placeholder="Edit message..."
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          bottom={
            <>
              <Box
                style={{ padding: config.space.S200, paddingTop: 0 }}
                alignItems="End"
                justifyContent="SpaceBetween"
                gap="100"
              >
                <Box gap="Inherit">
                  <Chip
                    onClick={handleSave}
                    variant="Primary"
                    radii="Pill"
                    disabled={
                      saveState.status === AsyncStatus.Loading ||
                      replaceState.status === AsyncStatus.Loading
                    }
                    outlined
                    before={
                      saveState.status === AsyncStatus.Loading ? (
                        <Spinner variant="Primary" fill="Soft" size="100" />
                      ) : undefined
                    }
                  >
                    <Text size="B300">Save</Text>
                  </Chip>
                  <Chip onClick={onCancel} variant="SurfaceVariant" radii="Pill">
                    <Text size="B300">Cancel</Text>
                  </Chip>
                </Box>
                <Box gap="Inherit">
                  <IconButton
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                    onClick={() => setToolbar(!toolbar)}
                  >
                    <Icon size="400" src={toolbar ? Icons.AlphabetUnderline : Icons.Alphabet} />
                  </IconButton>
                  <UseStateProvider initial={undefined}>
                    {(anchor: RectCords | undefined, setAnchor) => (
                      <PopOut
                        anchor={anchor}
                        alignOffset={-8}
                        position="Top"
                        align="End"
                        content={
                          <EmojiBoard
                            imagePackRooms={imagePackRooms ?? []}
                            returnFocusOnDeactivate={false}
                            onEmojiSelect={handleEmoticonSelect}
                            onCustomEmojiSelect={handleEmoticonSelect}
                            requestClose={() => {
                              setAnchor((v) => {
                                if (v) {
                                  if (!mobileOrTablet()) ReactEditor.focus(editor);
                                  return undefined;
                                }
                                return v;
                              });
                            }}
                          />
                        }
                      >
                        <IconButton
                          aria-pressed={anchor !== undefined}
                          onClick={
                            ((evt) =>
                              setAnchor(
                                evt.currentTarget.getBoundingClientRect()
                              )) as MouseEventHandler<HTMLButtonElement>
                          }
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                        >
                          <Icon size="400" src={Icons.Smile} filled={anchor !== undefined} />
                        </IconButton>
                      </PopOut>
                    )}
                  </UseStateProvider>
                </Box>
              </Box>
              {toolbar && (
                <div>
                  <Line variant="SurfaceVariant" size="300" />
                  <Toolbar />
                </div>
              )}
            </>
          }
        />
      </div>
    );
  }
);
