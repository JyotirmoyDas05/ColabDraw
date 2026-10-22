import { describe, expect, it, vi } from "vitest";

import Portal from "../collab/Portal";

vi.mock("@excalidraw/excalidraw/data/encryption", () => ({
  encryptData: async () => ({
    encryptedBuffer: new Uint8Array([1]).buffer,
    iv: new Uint8Array(12),
  }),
}));

const fakeSocket = () => ({
  id: "client-1",
  connect: vi.fn(),
  close: vi.fn(),
  sendUpdate: vi.fn(),
  setFollowing: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
});

const fakeCollab = () => ({
  state: { username: "alice" },
  setCollaborators: vi.fn(),
  getSceneElementsIncludingDeleted: () => [],
  excalidrawAPI: {
    getSceneElementsIncludingDeleted: () => [],
    getFiles: () => ({}),
    getAppState: () => ({ selectedElementIds: {} }),
    updateScene: vi.fn(),
  },
  fileManager: {
    saveFiles: async () => {},
    shouldUpdateImageElementStatus: () => false,
  },
});

const opened = () => {
  const socket = fakeSocket();
  const collab = fakeCollab();
  const portal = new Portal(collab as any);
  portal.socket = socket as any;
  portal.roomId = "room-1";
  portal.roomKey = "key";
  portal.socketInitialized = true;
  return { portal, socket, collab };
};

describe("Portal", () => {
  it("broadcasts a scene as a non-volatile update", async () => {
    const { portal, socket } = opened();

    await portal.broadcastScene("SCENE_UPDATE" as any, [], true);

    expect(socket.sendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        volatile: false,
        followersOnly: false,
      },
    );
  });

  it("broadcasts scene bounds to followers only", async () => {
    const { portal, socket } = opened();

    await portal.broadcastVisibleSceneBounds({
      sceneBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    });

    expect(socket.sendUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        volatile: true,
        followersOnly: true,
      },
    );
  });

  it("never broadcasts as a viewer", async () => {
    const { portal, socket } = opened();
    portal.isViewOnly = true;

    await portal.broadcastScene("SCENE_UPDATE" as any, [], true);

    expect(socket.sendUpdate).not.toHaveBeenCalled();
  });
});
