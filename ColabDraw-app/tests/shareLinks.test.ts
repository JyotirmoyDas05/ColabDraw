import { describe, expect, it } from "vitest";

import {
  getCollaborationLink,
  getCollaborationLinkData,
  getShareLinkData,
  getViewOnlyCollaborationLink,
  isCollaborationLink,
  isShareLink,
} from "../data";

const ROOM_ID = "1744fd82cb73afbe9ca1";
const ROOM_KEY = "xuwizfwOALCZ6pjIp9YgKw";
const ORIGIN = window.location.origin;

describe("collaboration links", () => {
  it("parses an editable clean room link", () => {
    expect(
      getCollaborationLinkData(`${ORIGIN}/room/${ROOM_ID}#${ROOM_KEY}`),
    ).toEqual({
      roomId: ROOM_ID,
      roomKey: ROOM_KEY,
      isViewOnly: false,
    });
  });

  it("parses a view-only clean room link", () => {
    expect(
      getCollaborationLinkData(`${ORIGIN}/room/${ROOM_ID}#${ROOM_KEY},view`),
    ).toEqual({
      roomId: ROOM_ID,
      roomKey: ROOM_KEY,
      isViewOnly: true,
    });
  });

  it("round-trips both modes with clean URL structure", () => {
    expect(
      getCollaborationLinkData(
        getCollaborationLink({ roomId: ROOM_ID, roomKey: ROOM_KEY }),
      ),
    ).toEqual({ roomId: ROOM_ID, roomKey: ROOM_KEY, isViewOnly: false });

    expect(
      getCollaborationLinkData(
        getCollaborationLink({
          roomId: ROOM_ID,
          roomKey: ROOM_KEY,
          viewOnly: true,
        }),
      ),
    ).toEqual({ roomId: ROOM_ID, roomKey: ROOM_KEY, isViewOnly: true });
  });

  it("accepts clean room links and rejects non-collaboration links", () => {
    expect(isCollaborationLink(`${ORIGIN}/room/${ROOM_ID}#${ROOM_KEY}`)).toBe(
      true,
    );
    expect(
      isCollaborationLink(`${ORIGIN}/room/${ROOM_ID}#${ROOM_KEY},view`),
    ).toBe(true);
    expect(isCollaborationLink(`${ORIGIN}/share/${ROOM_ID}#${ROOM_KEY}`)).toBe(
      false,
    );
  });

  it("builds a view link from an edit link without duplicating the flag", () => {
    const editLink = `${ORIGIN}/room/${ROOM_ID}#${ROOM_KEY}`;
    const viewLink = `${editLink},view`;

    expect(getViewOnlyCollaborationLink(editLink)).toBe(viewLink);
    expect(getViewOnlyCollaborationLink(viewLink)).toBe(viewLink);
  });
});

describe("read-only share links", () => {
  it("parses a clean share link", () => {
    expect(getShareLinkData(`${ORIGIN}/share/${ROOM_ID}#${ROOM_KEY}`)).toEqual({
      id: ROOM_ID,
      key: ROOM_KEY,
    });
  });

  it("accepts share links and rejects non-share links", () => {
    expect(isShareLink(`${ORIGIN}/share/${ROOM_ID}#${ROOM_KEY}`)).toBe(true);
    expect(isShareLink(`${ORIGIN}/room/${ROOM_ID}#${ROOM_KEY}`)).toBe(false);
  });
});
