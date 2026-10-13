import {
  COLOR_PALETTE,
  DEFAULT_STICKY_NOTE_SIZE,
  ROUNDNESS,
  STROKE_WIDTH,
  randomId,
} from "@excalidraw/common";
import {
  CaptureUpdateAction,
  Scene,
  convertToExcalidrawElements,
  duplicateElements,
  fixBindingsAfterDeletion,
  getBoundTextElement,
  getCommonBounds,
  getVisibleSceneBounds,
  isArrowElement,
  isFrameLikeElement,
  newElementWith,
  newTextElement,
  redrawTextBoundingBox,
  updateBoundElements,
} from "@excalidraw/element";
import { exportToBlob } from "@excalidraw/excalidraw";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  LibraryItem,
} from "@excalidraw/excalidraw/types";

import { LibraryIndexedDBAdapter } from "../data/LocalData";

import type { FunctionCall, GeminiPart } from "./aiClient";

const COLORS = [
  "black",
  "gray",
  "red",
  "pink",
  "grape",
  "violet",
  "blue",
  "cyan",
  "teal",
  "green",
  "yellow",
  "orange",
  "bronze",
] as const;
type ColorName = typeof COLORS[number];

export type CanvasOp = {
  op: "add" | "connect" | "update" | "delete" | "frame" | "mermaid" | "library";
  id?: string;
  shape?: "rectangle" | "ellipse" | "diamond" | "sticky" | "text";
  label?: string;
  near?: string;
  side?: "right" | "left" | "above" | "below";
  from?: string;
  to?: string;
  color?: ColorName;
  fill?: "hachure" | "cross-hatch" | "solid" | "none";
  stroke?: "solid" | "dashed" | "dotted";
  ids?: string[];
  code?: string;
  name?: string;
};

export type CanvasAgentResponse = { reply: string; ops: CanvasOp[] };

const S = (description: string, extra: object = {}) => ({
  type: "STRING",
  description,
  ...extra,
});

const PLACEMENT = {
  near: S("Id of the element to place it next to"),
  side: S("Which side of near", {
    enum: ["right", "left", "above", "below"],
  }),
};

const COLOR = S("Meaningful color, e.g. red for errors, green for success", {
  enum: [...COLORS],
});
const FILL = S("Fill style; omit to match the user's style", {
  enum: ["hachure", "cross-hatch", "solid", "none"],
});
const STYLE = S("Line style", { enum: ["solid", "dashed", "dotted"] });

/** One small function per action: models call these far more reliably than they fill one big schema. */
export const CANVAS_FUNCTIONS = [
  {
    name: "add_element",
    description: "Add a shape, sticky note or text to the board.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: S("Your new id for it (n1, n2...), so later calls can use it"),
        shape: S(
          "rectangle: process or component. ellipse: start/end or actor. diamond: decision. sticky: note or an answer written on the board. text: title or free text.",
          { enum: ["rectangle", "ellipse", "diamond", "sticky", "text"] },
        ),
        label: S("Its text, under six words for shapes"),
        ...PLACEMENT,
        color: COLOR,
        fill: FILL,
      },
      required: ["id", "shape", "label"],
    },
  },
  {
    name: "connect",
    description: "Draw an arrow from one element to another.",
    parameters: {
      type: "OBJECT",
      properties: {
        from: S("Id where the arrow starts"),
        to: S("Id where the arrow ends"),
        label: S("Optional text on the arrow"),
        style: STYLE,
        color: COLOR,
      },
      required: ["from", "to"],
    },
  },
  {
    name: "update_element",
    description:
      "Change an existing element's text, color or style, or move it next to another element.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: S("Id of the element to change"),
        label: S("New text"),
        color: COLOR,
        fill: FILL,
        style: STYLE,
        ...PLACEMENT,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_elements",
    description: "Remove elements from the board.",
    parameters: {
      type: "OBJECT",
      properties: { ids: { type: "ARRAY", items: S("Element id") } },
      required: ["ids"],
    },
  },
  {
    name: "create_frame",
    description: "Group elements into a named frame (a section of the board).",
    parameters: {
      type: "OBJECT",
      properties: {
        ids: { type: "ARRAY", items: S("Element id") },
        name: S("Frame title"),
      },
      required: ["ids", "name"],
    },
  },
  {
    name: "draw_mermaid",
    description:
      "Draw a complete new diagram from Mermaid code (flowchart, sequenceDiagram or classDiagram) in an empty spot. Use this for any new diagram, flow or process with four or more steps; it lays it out cleanly.",
    parameters: {
      type: "OBJECT",
      properties: { code: S("Mermaid source, no code fences") },
      required: ["code"],
    },
  },
  {
    name: "insert_library_item",
    description:
      "Insert one of the user's library items (names under Library).",
    parameters: {
      type: "OBJECT",
      properties: {
        name: S("Exact library item name"),
        id: S("Your new id for it (n1, n2...)"),
        ...PLACEMENT,
      },
      required: ["name"],
    },
  },
];

export const functionCallToOps = ({ name, args }: FunctionCall): CanvasOp[] => {
  const style = args.style as CanvasOp["stroke"];
  switch (name) {
    case "add_element":
      return [{ op: "add", ...args }];
    case "connect":
      return [{ op: "connect", ...args, stroke: style }];
    case "update_element":
      return [{ op: "update", ...args, stroke: style }];
    case "delete_elements":
      return (args.ids ?? []).map((id: string) => ({ op: "delete", id }));
    case "create_frame":
      return [{ op: "frame", ids: args.ids, label: args.name }];
    case "draw_mermaid":
      return [{ op: "mermaid", code: args.code }];
    case "insert_library_item":
      return [{ op: "library", ...args }];
    default:
      return [];
  }
};

export const CANVAS_SYSTEM_PROMPT = `You are the assistant inside ColabDraw, a hand-drawn whiteboard built on Excalidraw. You see the board as a list of elements and change it by calling functions. You never use pixel coordinates.

Each user message ends with a CANVAS section. Elements have short ids (e1, e2...); use them to refer to existing elements. Give new elements your own ids (n1, n2...) so later calls can connect to them. All calls in one reply are applied together as a single undo step.

- Always reply with one or two friendly sentences of text as well; in voice mode they are spoken aloud.
- Questions ("explain this", "what's wrong here", "solve this"): answer in text and call nothing, unless the user asks you to write it on the board (then add a sticky note).
- New diagrams, flows or processes of four or more steps: call draw_mermaid once. Small changes to what's on the board: add_element, connect, update_element, delete_elements, create_frame.
- Place new elements with near and side next to related ones.
- Omit color and fill to match the user's current style; use color only when asked or when it carries meaning.
- Keep labels short. Only touch what the user asked about. If the request is ambiguous, make a sensible choice.`;

const round = (n: number) => Math.round(n);

const colorNameOf = (hex: string) => {
  for (const name of COLORS) {
    const shades = COLOR_PALETTE[name];
    if (
      Array.isArray(shades) ? shades.includes(hex as never) : shades === hex
    ) {
      return name;
    }
  }
  return null;
};

type Box = { x: number; y: number; w: number; h: number };

const boxOf = (element: ExcalidrawElement): Box => ({
  x: element.x,
  y: element.y,
  w: element.width,
  h: element.height,
});

const labelOf = (
  element: ExcalidrawElement,
  elementsMap: Map<string, ExcalidrawElement>,
) => {
  if (element.type === "text") {
    return element.originalText;
  }
  if (isFrameLikeElement(element)) {
    return element.name ?? "";
  }
  return getBoundTextElement(element, elementsMap as any)?.originalText ?? "";
};

const LIBRARY_NAME_LIMIT = 40;
const CONTEXT_ELEMENT_LIMIT = 80;

const loadLibrary = async (): Promise<LibraryItem[]> =>
  ((await LibraryIndexedDBAdapter.load())?.libraryItems ?? []) as LibraryItem[];

export type CanvasContext = {
  text: string;
  /** alias (e1) → element id */
  aliases: Map<string, string>;
  /** hand drawings or images the model can only understand from a picture */
  visualElements: NonDeletedExcalidrawElement[];
};

/** Describes the selection (or what's on screen) as compact text for the model. */
export const buildCanvasContext = async (
  api: ExcalidrawImperativeAPI,
): Promise<CanvasContext> => {
  const appState = api.getAppState();
  const elements = api.getSceneElements();
  const elementsMap = api.getSceneElementsMapIncludingDeleted();
  const selected = elements.filter(
    (element) => appState.selectedElementIds[element.id],
  );
  const [vx1, vy1, vx2, vy2] = getVisibleSceneBounds(appState);
  const center = { x: (vx1 + vx2) / 2, y: (vy1 + vy2) / 2 };
  const visible = elements.filter(
    (element) =>
      element.x < vx2 &&
      element.x + element.width > vx1 &&
      element.y < vy2 &&
      element.y + element.height > vy1,
  );

  // bound labels are described through their container
  const described = (selected.length ? selected : visible)
    .filter((element) => !(element.type === "text" && element.containerId))
    .sort(
      (a, b) =>
        Math.hypot(a.x - center.x, a.y - center.y) -
        Math.hypot(b.x - center.x, b.y - center.y),
    )
    .slice(0, CONTEXT_ELEMENT_LIMIT);

  const aliases = new Map<string, string>();
  const aliasOf = new Map<string, string>();
  described.forEach((element, index) => {
    aliases.set(`e${index + 1}`, element.id);
    aliasOf.set(element.id, `e${index + 1}`);
  });

  const lines = described.map((element) => {
    const alias = aliasOf.get(element.id);
    const label = labelOf(element, elementsMap);
    const color = colorNameOf(element.strokeColor);
    const parts = [
      alias,
      element.type === "freedraw" ? "hand-drawing" : element.type,
      label && JSON.stringify(label),
    ];
    if (isArrowElement(element)) {
      const from = element.startBinding?.elementId;
      const to = element.endBinding?.elementId;
      parts.push(
        `from ${(from && aliasOf.get(from)) ?? "nothing"} to ${
          (to && aliasOf.get(to)) ?? "nothing"
        }`,
      );
    } else {
      parts.push(
        `at (${round(element.x)},${round(element.y)}) size ${round(
          element.width,
        )}x${round(element.height)}`,
      );
    }
    if (color && color !== "black") {
      parts.push(color);
    }
    if (element.frameId && aliasOf.has(element.frameId)) {
      parts.push(`in ${aliasOf.get(element.frameId)}`);
    }
    return parts.filter(Boolean).join(" ");
  });

  const library = (await loadLibrary())
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, LIBRARY_NAME_LIMIT);

  const text = [
    "CANVAS",
    selected.length
      ? `The user selected ${selected.length} element(s); "this" means the selection.`
      : "Nothing is selected; these are the elements on screen.",
    lines.length ? lines.join("\n") : "(the visible board is empty)",
    `Current style: ${appState.currentItemFillStyle} fill, ${
      ["architect", "artist", "cartoonist"][appState.currentItemRoughness] ??
      "artist"
    } sloppiness, ${
      colorNameOf(appState.currentItemStrokeColor) ?? "custom"
    } ink.`,
    library.length
      ? `Library: ${library.map((name) => `"${name}"`).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    text,
    aliases,
    visualElements: described.filter(
      (element) => element.type === "freedraw" || element.type === "image",
    ),
  };
};

/** A PNG of hand drawings so a multimodal model can read them (own key only). */
export const snapshotElements = async (
  api: ExcalidrawImperativeAPI,
  elements: readonly NonDeletedExcalidrawElement[],
): Promise<GeminiPart> => {
  const blob = await exportToBlob({
    elements,
    files: api.getFiles(),
    mimeType: "image/png",
    maxWidthOrHeight: 1024,
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
  });
  const data = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
  return { inlineData: { mimeType: "image/png", data } };
};

// ---------------------------------------------------------------------------
// applying ops
// ---------------------------------------------------------------------------

// room for an arrow label between neighbours
const GAP = 140;

const shadesOf = (color: ColorName) => {
  const shades = COLOR_PALETTE[color];
  return Array.isArray(shades)
    ? shades
    : [COLOR_PALETTE.gray[1], "", "", "", shades];
};

const styleFor = (appState: AppState, op: CanvasOp) => {
  const shades = op.color ? shadesOf(op.color) : null;
  const backgroundColor =
    op.fill === "none"
      ? "transparent"
      : shades
      ? shades[1]
      : appState.currentItemBackgroundColor;
  return {
    strokeColor: shades ? shades[4] : appState.currentItemStrokeColor,
    backgroundColor,
    fillStyle:
      op.fill && op.fill !== "none" ? op.fill : appState.currentItemFillStyle,
    strokeWidth: STROKE_WIDTH[appState.currentItemStrokeWidthKey],
    strokeStyle: op.stroke ?? appState.currentItemStrokeStyle,
    roughness: appState.currentItemRoughness,
    opacity: appState.currentItemOpacity,
  };
};

const sizeFor = (shape: CanvasOp["shape"], label = "") => {
  // wide enough that the longest word never breaks mid-word
  const longestWord = Math.max(
    ...label.split(/\s+/).map((word) => word.length),
  );
  const width = Math.min(
    Math.max(60 + label.length * 9, 40 + longestWord * 13, 140),
    280,
  );
  switch (shape) {
    case "ellipse":
      return { w: width + 30, h: 90 };
    case "diamond":
      // a diamond's text area is about half its width
      return { w: Math.round(width * 1.8), h: 140 };
    case "sticky":
      return { w: DEFAULT_STICKY_NOTE_SIZE, h: DEFAULT_STICKY_NOTE_SIZE };
    case "text":
      return { w: Math.max(label.length * 11, 40), h: 30 };
    default:
      return { w: width, h: 80 };
  }
};

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + 20 &&
  a.x + a.w + 20 > b.x &&
  a.y < b.y + b.h + 20 &&
  a.y + a.h + 20 > b.y;

const nextTo = (anchor: Box, size: { w: number; h: number }, side: string) => {
  switch (side) {
    case "left":
      return {
        x: anchor.x - GAP - size.w,
        y: anchor.y + (anchor.h - size.h) / 2,
      };
    case "above":
      return {
        x: anchor.x + (anchor.w - size.w) / 2,
        y: anchor.y - GAP - size.h,
      };
    case "below":
      return {
        x: anchor.x + (anchor.w - size.w) / 2,
        y: anchor.y + anchor.h + GAP,
      };
    default:
      return {
        x: anchor.x + anchor.w + GAP,
        y: anchor.y + (anchor.h - size.h) / 2,
      };
  }
};

/** Point where the ray from a box's center towards (dx, dy) leaves the box. */
const edgePoint = (box: Box, dx: number, dy: number) => {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const t = Math.min(
    dx ? box.w / 2 / Math.abs(dx) : Infinity,
    dy ? box.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * t, y: cy + dy * t };
};

export type ApplyResult = {
  added: number;
  changed: number;
  deleted: number;
  newElementIds: string[];
};

export const applyCanvasOps = async (
  api: ExcalidrawImperativeAPI,
  ops: CanvasOp[],
  aliases: Map<string, string>,
): Promise<ApplyResult> => {
  const appState = api.getAppState();
  // shallow clones: library helpers mutate in place and history needs the originals intact
  const scene = new Scene(
    api.getSceneElementsIncludingDeleted().map((element) => ({ ...element })),
  );
  const result: ApplyResult = {
    added: 0,
    changed: 0,
    deleted: 0,
    newElementIds: [],
  };

  const ids = new Map(aliases);
  const resolve = (ref?: string) => (ref ? ids.get(ref) ?? null : null);
  const existing = (ref?: string) => {
    const id = resolve(ref);
    const element = id ? scene.getNonDeletedElement(id) : null;
    return element ?? null;
  };

  const [vx1, vy1, vx2, vy2] = getVisibleSceneBounds(appState);
  const occupied: Box[] = scene
    .getNonDeletedElements()
    .filter(
      (element) =>
        element.x < vx2 + 400 && element.x + element.width > vx1 - 400,
    )
    .map(boxOf);
  const newBoxes = new Map<string, Box>();
  const selectedIds = Object.keys(appState.selectedElementIds);
  let lastPlaced: Box | null = null;

  const boxOfRef = (ref?: string): Box | null => {
    const id = resolve(ref);
    if (!id) {
      return null;
    }
    if (newBoxes.has(id)) {
      return newBoxes.get(id)!;
    }
    const element = scene.getNonDeletedElement(id);
    return element ? boxOf(element) : null;
  };

  const isFree = (box: Box) => !occupied.some((other) => overlaps(box, other));

  const place = (size: { w: number; h: number }, op: CanvasOp): Box => {
    const side = op.side ?? "right";
    let anchor = boxOfRef(op.near) ?? lastPlaced;
    if (!anchor && selectedIds.length) {
      const [x1, y1, x2, y2] = getCommonBounds(
        selectedIds
          .map((id) => scene.getNonDeletedElement(id))
          .filter(Boolean) as ExcalidrawElement[],
      );
      anchor = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    let box: Box = anchor
      ? { ...nextTo(anchor, size, side), ...size }
      : {
          x: (vx1 + vx2) / 2 - size.w / 2,
          y: (vy1 + vy2) / 2 - size.h / 2,
          ...size,
        };
    for (let i = 0; i < 20 && !isFree(box); i++) {
      box = { ...nextTo(box, size, side), ...size };
    }
    occupied.push(box);
    lastPlaced = box;
    return box;
  };

  const skeletons: ExcalidrawElementSkeleton[] = [];
  const frames: ExcalidrawElementSkeleton[] = [];
  const proxies = new Map<string, ExcalidrawElementSkeleton>();
  const toDelete: ExcalidrawElement[] = [];
  const extraElements: ExcalidrawElement[] = [];

  const proxyFor = (element: ExcalidrawElement) => {
    if (!proxies.has(element.id)) {
      proxies.set(element.id, {
        // only geometry matters: the result's binding data is copied onto the real element
        type:
          element.type === "ellipse" || element.type === "diamond"
            ? element.type
            : "rectangle",
        id: element.id,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        angle: element.angle,
        boundElements: [],
      } as ExcalidrawElementSkeleton);
    }
  };

  const fontProps = {
    fontFamily: appState.currentItemFontFamily,
    fontSize: appState.currentItemFontSize,
  };

  // models often batch deletes/updates as one op with an ids list
  const expandedOps = ops.flatMap((op) =>
    (op.op === "delete" || op.op === "update") && !op.id && op.ids
      ? op.ids.map((id) => ({ ...op, id }))
      : [op],
  );

  for (const op of expandedOps) {
    switch (op.op) {
      case "add": {
        const id = randomId();
        if (op.id) {
          ids.set(op.id, id);
        }
        const shape = op.shape ?? "rectangle";
        const box = place(sizeFor(shape, op.label), op);
        newBoxes.set(id, box);
        const style = styleFor(appState, op);
        if (shape === "text") {
          skeletons.push({
            type: "text",
            id,
            x: box.x,
            y: box.y,
            text: op.label ?? "",
            ...fontProps,
            strokeColor: style.strokeColor,
            opacity: style.opacity,
          });
        } else if (shape === "sticky") {
          skeletons.push({
            type: "stickynote",
            id,
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
            ...(op.color ? { backgroundColor: shadesOf(op.color)[1] } : null),
            label: op.label ? { text: op.label, ...fontProps } : undefined,
          } as ExcalidrawElementSkeleton);
        } else {
          skeletons.push({
            type: shape,
            id,
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
            ...style,
            roundness:
              shape === "rectangle" && appState.currentItemRoundness === "round"
                ? { type: ROUNDNESS.ADAPTIVE_RADIUS }
                : shape === "diamond" &&
                  appState.currentItemRoundness === "round"
                ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
                : null,
            label: op.label ? { text: op.label, ...fontProps } : undefined,
          } as ExcalidrawElementSkeleton);
        }
        result.added++;
        break;
      }
      case "connect": {
        const fromId = resolve(op.from);
        const toId = resolve(op.to);
        const fromBox = boxOfRef(op.from);
        const toBox = boxOfRef(op.to);
        if (!fromId || !toId || !fromBox || !toBox || fromId === toId) {
          break;
        }
        for (const ref of [op.from, op.to]) {
          const element = existing(ref);
          if (element) {
            proxyFor(element);
          }
        }
        const dx = toBox.x + toBox.w / 2 - (fromBox.x + fromBox.w / 2);
        const dy = toBox.y + toBox.h / 2 - (fromBox.y + fromBox.h / 2);
        const start = edgePoint(fromBox, dx, dy);
        const end = edgePoint(toBox, -dx, -dy);
        const style = styleFor(appState, { ...op, fill: undefined });
        skeletons.push({
          type: "arrow",
          id: randomId(),
          x: start.x,
          y: start.y,
          width: end.x - start.x,
          height: end.y - start.y,
          strokeColor: style.strokeColor,
          strokeWidth: style.strokeWidth,
          strokeStyle: style.strokeStyle,
          roughness: style.roughness,
          opacity: style.opacity,
          startArrowhead: appState.currentItemStartArrowhead,
          endArrowhead: appState.currentItemEndArrowhead ?? "arrow",
          start: { id: fromId },
          end: { id: toId },
          label: op.label ? { text: op.label, ...fontProps } : undefined,
        } as ExcalidrawElementSkeleton);
        result.added++;
        break;
      }
      case "update": {
        const pending = skeletons.find((s) => s.id === resolve(op.id)) as any;
        if (pending) {
          // the model added and then tweaked the same element
          if (op.label) {
            if (pending.type === "text") {
              pending.text = op.label;
            } else {
              pending.label = { text: op.label, ...fontProps };
            }
          }
          if (op.color || op.fill || op.stroke) {
            Object.assign(pending, styleFor(appState, op));
          }
          break;
        }
        const element = existing(op.id);
        if (!element) {
          break;
        }
        if (op.color || op.fill || op.stroke) {
          const style = styleFor(appState, op);
          scene.mutateElement(element, {
            ...(op.color ? { strokeColor: style.strokeColor } : null),
            ...(op.color || op.fill
              ? { backgroundColor: style.backgroundColor }
              : null),
            ...(op.fill && op.fill !== "none" ? { fillStyle: op.fill } : null),
            ...(op.stroke ? { strokeStyle: op.stroke } : null),
          });
          const boundText = getBoundTextElement(
            element,
            scene.getNonDeletedElementsMap(),
          );
          if (boundText && op.color) {
            scene.mutateElement(boundText, { strokeColor: style.strokeColor });
          }
        }
        if (op.label !== undefined) {
          if (isFrameLikeElement(element)) {
            scene.mutateElement(element, { name: op.label });
          } else if (element.type === "text") {
            scene.mutateElement(element, {
              text: op.label,
              originalText: op.label,
            });
            redrawTextBoundingBox(element, null, scene);
          } else {
            let boundText = getBoundTextElement(
              element,
              scene.getNonDeletedElementsMap(),
            );
            if (!boundText) {
              const text = newTextElement({
                x: element.x,
                y: element.y,
                text: op.label,
                ...fontProps,
                textAlign: "center",
                verticalAlign: "middle",
                containerId: element.id,
                strokeColor: element.strokeColor,
              });
              scene.insertElement(text);
              scene.mutateElement(element, {
                boundElements: [
                  ...(element.boundElements ?? []),
                  { type: "text", id: text.id },
                ],
              });
              boundText = text as any;
            }
            scene.mutateElement(boundText!, {
              text: op.label,
              originalText: op.label,
            });
            redrawTextBoundingBox(boundText!, element, scene);
          }
        }
        if (op.near && !isArrowElement(element)) {
          const target = place({ w: element.width, h: element.height }, op);
          scene.mutateElement(element, { x: target.x, y: target.y });
          const boundText = getBoundTextElement(
            element,
            scene.getNonDeletedElementsMap(),
          );
          if (boundText) {
            redrawTextBoundingBox(boundText, element, scene);
          }
          updateBoundElements(element, scene);
        }
        result.changed++;
        break;
      }
      case "delete": {
        const element = existing(op.id);
        if (!element) {
          break;
        }
        const boundText = getBoundTextElement(
          element,
          scene.getNonDeletedElementsMap(),
        );
        toDelete.push(element, ...(boundText ? [boundText] : []));
        result.deleted++;
        break;
      }
      case "frame": {
        const children = (op.ids ?? [])
          .map((ref) => {
            const element = existing(ref);
            if (element) {
              proxyFor(element);
            }
            return resolve(ref);
          })
          .filter(Boolean) as string[];
        if (children.length) {
          frames.push({
            type: "frame",
            id: randomId(),
            children,
            name: op.label,
          });
          result.added++;
        }
        break;
      }
      case "library": {
        const item = (await loadLibrary()).find(
          (libraryItem) =>
            libraryItem.name?.toLowerCase() === op.name?.toLowerCase(),
        );
        if (!item) {
          break;
        }
        const { duplicatedElements } = duplicateElements({
          type: "everything",
          elements: item.elements,
          randomizeSeed: true,
        });
        const [x1, y1, x2, y2] = getCommonBounds(duplicatedElements);
        const box = place({ w: x2 - x1, h: y2 - y1 }, op);
        for (const element of duplicatedElements) {
          extraElements.push({
            ...element,
            x: element.x - x1 + box.x,
            y: element.y - y1 + box.y,
          });
        }
        if (op.id && duplicatedElements[0]) {
          ids.set(op.id, duplicatedElements[0].id);
          newBoxes.set(duplicatedElements[0].id, box);
        }
        result.added++;
        break;
      }
      case "mermaid": {
        const mermaidElements = await mermaidToElements(
          api,
          op.code ?? "",
          appState,
        );
        if (!mermaidElements.length) {
          break;
        }
        const [x1, y1, x2, y2] = getCommonBounds(mermaidElements);
        // mermaid diagrams go to free space, never on top of the user's work
        const box = place(
          { w: x2 - x1, h: y2 - y1 },
          { ...op, near: undefined },
        );
        for (const element of mermaidElements) {
          extraElements.push({
            ...element,
            x: element.x - x1 + box.x,
            y: element.y - y1 + box.y,
          });
        }
        result.added += mermaidElements.filter(
          (element) => !(element.type === "text" && element.containerId),
        ).length;
        break;
      }
    }
  }

  if (toDelete.length) {
    fixBindingsAfterDeletion(scene.getElementsIncludingDeleted(), toDelete);
  }

  const converted = convertToExcalidrawElements(
    [...proxies.values(), ...skeletons, ...frames],
    { regenerateIds: false },
  );
  const created: ExcalidrawElement[] = [];
  for (const element of converted) {
    if (!proxies.has(element.id)) {
      created.push(element);
      continue;
    }
    // copy the new arrow bindings and frame membership onto the real element
    const real = scene.getNonDeletedElement(element.id);
    if (!real) {
      continue;
    }
    const known = new Set((real.boundElements ?? []).map((b) => b.id));
    const added = (element.boundElements ?? []).filter((b) => !known.has(b.id));
    scene.mutateElement(real, {
      ...(added.length
        ? { boundElements: [...(real.boundElements ?? []), ...added] }
        : null),
      ...(element.frameId ? { frameId: element.frameId } : null),
    });
    const boundText = element.frameId
      ? getBoundTextElement(real, scene.getNonDeletedElementsMap())
      : null;
    if (boundText) {
      scene.mutateElement(boundText, { frameId: element.frameId });
    }
  }

  const newElements = [...created, ...extraElements];
  result.newElementIds = newElements
    .filter((element) => !(element.type === "text" && element.containerId))
    .map((element) => element.id);

  const deletedIds = new Set(toDelete.map((element) => element.id));
  api.updateScene({
    elements: [
      ...scene
        .getElementsIncludingDeleted()
        .map((element) =>
          deletedIds.has(element.id)
            ? newElementWith(element, { isDeleted: true })
            : element,
        ),
      ...newElements,
    ],
    appState: result.newElementIds.length
      ? {
          selectedElementIds: Object.fromEntries(
            result.newElementIds.map((id) => [id, true]),
          ),
        }
      : undefined,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  if (newElements.length) {
    const [x1, y1, x2, y2] = getCommonBounds(newElements);
    if (x1 < vx1 || y1 < vy1 || x2 > vx2 || y2 > vy2) {
      requestAnimationFrame(() =>
        api.setViewport({
          target: newElements.filter((element) => !element.isDeleted),
          fit: "scale-down",
          animation: true,
        }),
      );
    }
  }

  return result;
};

const mermaidToElements = async (
  api: ExcalidrawImperativeAPI,
  code: string,
  appState: AppState,
): Promise<ExcalidrawElement[]> => {
  const { parseMermaidToExcalidraw } = await import(
    "@excalidraw/mermaid-to-excalidraw"
  );
  const definition = code
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = await parseMermaidToExcalidraw(definition);
  } catch {
    try {
      parsed = await parseMermaidToExcalidraw(definition.replace(/"/g, "'"));
    } catch {
      return [];
    }
  }
  // the user's sloppiness; fonts stay as measured by the parser
  const styled = parsed.elements.map((skeleton: any) => ({
    ...skeleton,
    roughness: appState.currentItemRoughness,
  }));
  // non-flowchart types come back as an image
  if (parsed.files) {
    api.addFiles(Object.values(parsed.files));
  }
  return convertToExcalidrawElements(styled, { regenerateIds: true });
};
