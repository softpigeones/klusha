import { MatrixClient } from 'matrix-js-sdk';
import { allInvitesAtom, useBindAllInvitesAtom } from '../room-list/inviteList';
import { allRoomsAtom, useBindAllRoomsAtom } from '../room-list/roomList';
import { mDirectAtom, useBindMDirectAtom } from '../mDirectList';
import { roomToUnreadAtom, useBindRoomToUnreadAtom } from '../room/roomToUnread';
import { roomToParentsAtom, useBindRoomToParentsAtom } from '../room/roomToParents';
import { roomIdToTypingMembersAtom, useBindRoomIdToTypingMembersAtom } from '../typingMembers';
import { userPresenceAtom, useBindUserPresenceAtom } from '../presence';

export const useBindAtoms = (mx: MatrixClient) => {
  useBindMDirectAtom(mx, mDirectAtom);
  useBindAllInvitesAtom(mx, allInvitesAtom);
  useBindAllRoomsAtom(mx, allRoomsAtom);
  useBindRoomToParentsAtom(mx, roomToParentsAtom);
  useBindRoomToUnreadAtom(mx, roomToUnreadAtom);

  useBindRoomIdToTypingMembersAtom(mx, roomIdToTypingMembersAtom);

  useBindUserPresenceAtom(mx, userPresenceAtom);
};
