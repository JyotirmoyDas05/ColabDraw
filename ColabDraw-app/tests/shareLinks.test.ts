import { describe, expect, it } from "vitest";

import {
  getCollaborationLink,
  getCollaborationLinkData,
  getViewOnlyCollaborationLink,
  isCollaborationLink,
} from "../data";

const ROOM_ID = "1744fd82cb73afbe9ca1";
const ROOM_KEY = "xuwizfwOALCZ6pjIp9YgKw";
const ORIGIN = `${window.location.origin}${window.location.pathname}`;

describe("collaboration links", () => {
  it("parses an editable link", () => {
    expect(
      getCollaborationLinkData(`${ORIGIN}#room=${ROOM_ID},${ROOM_KEY}`),
    ).toEqual({
      roomId: ROOM_ID,
      roomKey: ROOM_KEY,
      isViewOnly: false,
    });
  });

  it("parses a view-only link", () => {
    expect(
      getCollaborationLinkData(`${ORIGIN}#room=${ROOM_ID},${ROOM_KEY},view`),
    ).toEqual({
      roomId: ROOM_ID,
      roomKey: ROOM_KEY,
      isViewOnly: true,
    });
  });

  it("round-trips both modes", () => {
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

  it("accepts both links as collaboration links", () => {
    expect(isCollaborationLink(`${ORIGIN}#room=${ROOM_ID},${ROOM_KEY}`)).toBe(
      true,
    );
    expect(
      isCollaborationLink(`${ORIGIN}#room=${ROOM_ID},${ROOM_KEY},view`),
    ).toBe(true);
    expect(isCollaborationLink(`${ORIGIN}#json=${ROOM_ID},${ROOM_KEY}`)).toBe(
      false,
    );
  });

  it("builds a view link from an edit link without duplicating the flag", () => {
    const editLink = `${ORIGIN}#room=${ROOM_ID},${ROOM_KEY}`;
    const viewLink = `${editLink},view`;

    expect(getViewOnlyCollaborationLink(editLink)).toBe(viewLink);
    expect(getViewOnlyCollaborationLink(viewLink)).toBe(viewLink);
  });
});
