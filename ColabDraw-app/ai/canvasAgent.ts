import {
  COLOR_PALETTE,
  DEFAULT_STICKY_NOTE_SIZE,
  FONT_FAMILY,
  FONT_SIZES,
  ROUNDNESS,
  getStrokeWidthByKey,
  randomId,
} from "@excalidraw/common";
import {
  CaptureUpdateAction,
  Scene,
  alignElements,
  convertToExcalidrawElements,
  distributeElements,
  duplicateElements,
  fixBindingsAfterDeletion,
  getBoundTextElement,
  getCommonBounds,
  getVisibleSceneBounds,
  isArrowElement,
  isFrameLikeElement,
  newElementWith,
  newFreeDrawElement,
  newImageElement,
  newTextElement,
  positionElementsOnGrid,
  redrawTextBoundingBox,
  updateBoundElements,
} from "@excalidraw/element";
import { exportToBlob } from "@excalidraw/excalidraw";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  LibraryItem,
} from "@excalidraw/excalidraw/types";

import { LibraryIndexedDBAdapter } from "../data/LocalData";

import {
  describeLibraryItems,
  findLibraryItem,
  onlineLibraryContext,
  resolveOnlineItem,
} from "./libraryItems";

import {
  boundsOf,
  measureImage,
  relaxPath,
  simplifyPath,
  smoothPath,
  traceImage,
} from "./drawing";

import type { FunctionCall, GeminiPart } from "./aiClient";
import type { Point } from "./drawing";
import type { NamedLibraryItem } from "./libraryItems";

// ---------------------------------------------------------------------------
// vocabulary: the whiteboard's own styling options, by name
// ---------------------------------------------------------------------------

const COLORS = [
  "black",
  "white",
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

const TONES = { light: 1, medium: 2, strong: 3 } as const;
const SIZES = { small: 0.7, medium: 1, large: 1.4, huge: 2 } as const;
const THICKNESS = { thin: "thin", medium: "medium", bold: "bold" } as const;
const SLOPPINESS = { architect: 0, artist: 1, cartoonist: 2 } as const;
const FONTS = {
  "hand-drawn": FONT_FAMILY.Excalifont,
  normal: FONT_FAMILY.Nunito,
  code: FONT_FAMILY.Cascadia,
  comic: FONT_FAMILY["Comic Shanns"],
  display: FONT_FAMILY["Lilita One"],
} as const;
const FONT_SIZE_NAMES = {
  small: FONT_SIZES.sm,
  medium: FONT_SIZES.md,
  large: FONT_SIZES.lg,
  xl: FONT_SIZES.xl,
} as const;
const ARROWHEADS = [
  "none",
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  // entity-relationship cardinality heads
  "cardinality_one",
  "cardinality_many",
  "cardinality_one_or_many",
  "cardinality_exactly_one",
  "cardinality_zero_or_one",
  "cardinality_zero_or_many",
] as const;

const FILL_STYLES = ["hachure", "cross-hatch", "solid", "none"] as const;
const LINE_STYLES = ["solid", "dashed", "dotted"] as const;
const SIDES = ["right", "left", "above", "below"] as const;
type Side = typeof SIDES[number];
type ArrowheadName = typeof ARROWHEADS[number];

const ARRANGEMENTS = [
  "align_left",
  "align_center",
  "align_right",
  "align_top",
  "align_middle",
  "align_bottom",
  "distribute_horizontally",
  "distribute_vertically",
  "row",
  "column",
  "grid",
] as const;

export type CanvasOp = {
  op:
    | "add"
    | "connect"
    | "update"
    | "delete"
    | "frame"
    | "mermaid"
    | "library"
    | "group"
    | "arrange"
    | "duplicate"
    | "reorder"
    | "canvas"
    | "image"
    | "trace"
    | "smooth"
    | "freehand";
  id?: string;
  shape?: "rectangle" | "ellipse" | "diamond" | "sticky" | "text" | "line";
  label?: string;
  near?: string;
  side?: Side;
  from?: string;
  to?: string;
  color?: ColorName;
  background?: ColorName | "transparent";
  tone?: keyof typeof TONES;
  fill?: typeof FILL_STYLES[number];
  /** line style: solid, dashed or dotted */
  stroke?: typeof LINE_STYLES[number];
  thickness?: keyof typeof THICKNESS;
  sloppiness?: keyof typeof SLOPPINESS;
  rounded?: boolean;
  opacity?: number;
  font?: keyof typeof FONTS;
  fontSize?: keyof typeof FONT_SIZE_NAMES;
  textAlign?: "left" | "center" | "right";
  size?: keyof typeof SIZES;
  stretch?: "wide" | "tall" | "square";
  angle?: number;
  arrowType?: "sharp" | "curved" | "elbow";
  startArrowhead?: ArrowheadName;
  endArrowhead?: ArrowheadName;
  ids?: string[];
  replaces?: string[];
  code?: string;
  name?: string;
  how?: typeof ARRANGEMENTS[number];
  count?: number;
  position?: "front" | "back";
  /** 1-based number of a picture the user attached */
  picture?: number;
  /** x,y pairs of a hand-drawn path */
  points?: number[];
  closed?: boolean;
  amount?: "light" | "medium" | "strong";
  detail?: "low" | "medium" | "high";
  grid?: boolean;
  /** also draw an arrow from the `near` element to this new one */
  /** online library (libraries.excalidraw.com) the item comes from */
  library?: string;
  /** existing element this library item takes the place of */
  replace?: string;
  link?: boolean;
  linkLabel?: string;
  linkArrowhead?: ArrowheadName;
};

/** a picture attached to the message: `url` is the original file, for the board */
export type PictureRef = { name: string; mimeType: string; url: string };

export type CanvasAgentResponse = { reply: string; ops: CanvasOp[] };

// ---------------------------------------------------------------------------
// function declarations the model calls
// ---------------------------------------------------------------------------

const S = (description: string, extra: object = {}) => ({
  type: "STRING",
  description,
  ...extra,
});
const N = (description: string) => ({ type: "NUMBER", description });
const B = (description: string) => ({ type: "BOOLEAN", description });
const IDS = (description: string) => ({
  type: "ARRAY",
  items: S("Element id"),
  description,
});

const PLACEMENT = {
  near: S("Id of the element to place it next to"),
  side: S("Which side of near", { enum: [...SIDES] }),
};

/** one call instead of add + connect */
const LINK = {
  link: B("Also draw an arrow from the near element to this new one"),
  linkLabel: S("Text on that arrow"),
  linkArrowhead: S("Head at the new element's end of that arrow", {
    enum: [...ARROWHEADS],
  }),
};

const SHAPE_STYLE = {
  color: S(
    "Tints the whole shape: outline in the strong shade, fill in a light shade. Pick meaningful colors (red errors, green success, blue services, yellow notes...).",
    { enum: [...COLORS] },
  ),
  background: S("Fill color on its own, independent of the outline color", {
    enum: [...COLORS, "transparent"],
  }),
  tone: S("How strong the fill is (default light)", {
    enum: Object.keys(TONES),
  }),
  fill: S("Fill pattern: hachure and cross-hatch are hand-drawn", {
    enum: [...FILL_STYLES],
  }),
  style: S("Outline style", { enum: [...LINE_STYLES] }),
  thickness: S("Outline thickness", { enum: Object.keys(THICKNESS) }),
  sloppiness: S(
    "architect = clean lines, artist = slightly wobbly, cartoonist = very hand-drawn",
    { enum: Object.keys(SLOPPINESS) },
  ),
  rounded: B("Rounded corners"),
  opacity: N("0 (invisible) to 100"),
  angle: N("Rotation in degrees"),
};

const TEXT_STYLE = {
  font: S(
    "hand-drawn (default), normal (clean sans), code (monospace), comic, display (chunky headlines)",
    { enum: Object.keys(FONTS) },
  ),
  fontSize: S("Text size", { enum: Object.keys(FONT_SIZE_NAMES) }),
  textAlign: S("Text alignment", { enum: ["left", "center", "right"] }),
};

const SIZE = {
  size: S("Overall size relative to normal (text: scales the font)", {
    enum: Object.keys(SIZES),
  }),
  stretch: S("Make it wider, taller or square", {
    enum: ["wide", "tall", "square"],
  }),
};

const ARROW_STYLE = {
  arrowType: S("sharp (straight), curved or elbow (right angles)", {
    enum: ["sharp", "curved", "elbow"],
  }),
  startArrowhead: S("Head at the start of the arrow", {
    enum: [...ARROWHEADS],
  }),
  endArrowhead: S("Head at the end of the arrow", { enum: [...ARROWHEADS] }),
};

/** One small function per action: models call these far more reliably than they fill one big schema. */
export const CANVAS_FUNCTIONS = [
  {
    name: "add_element",
    description:
      "Add a shape, sticky note, text or plain line to the board, styled like the whiteboard's own tools.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: S("Your new id for it (n1, n2...), so later calls can use it"),
        shape: S(
          "rectangle: process or component. ellipse: start/end or actor. diamond: decision. sticky: note, comment or an answer written on the board. text: title or free text. line: a divider.",
          {
            enum: ["rectangle", "ellipse", "diamond", "sticky", "text", "line"],
          },
        ),
        label: S("Its text, under six words for shapes"),
        ...PLACEMENT,
        ...LINK,
        ...SIZE,
        ...SHAPE_STYLE,
        ...TEXT_STYLE,
      },
      required: ["id", "shape"],
    },
  },
  {
    name: "connect",
    description: "Draw an arrow (or a plain line) from one element to another.",
    parameters: {
      type: "OBJECT",
      properties: {
        from: S("Id where the arrow starts"),
        to: S("Id where the arrow ends"),
        label: S("Optional text on the arrow"),
        color: SHAPE_STYLE.color,
        style: SHAPE_STYLE.style,
        thickness: SHAPE_STYLE.thickness,
        sloppiness: SHAPE_STYLE.sloppiness,
        ...ARROW_STYLE,
        ...TEXT_STYLE,
      },
      required: ["from", "to"],
    },
  },
  {
    name: "update_element",
    description:
      "Change an EXISTING element in place: text, colors, fill, outline, size, font, rotation, arrow style, or move it next to another element. Use this instead of drawing again whenever the user asks to change something already on the board.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: S("Id of the element to change (e1, e2...)"),
        label: S("New text"),
        ...PLACEMENT,
        ...SIZE,
        ...SHAPE_STYLE,
        ...TEXT_STYLE,
        ...ARROW_STYLE,
      },
      required: ["id"],
    },
  },
  {
    name: "delete_elements",
    description: "Remove elements from the board.",
    parameters: {
      type: "OBJECT",
      properties: { ids: IDS("Elements to remove") },
      required: ["ids"],
    },
  },
  {
    name: "create_frame",
    description: "Group elements into a named frame (a titled section).",
    parameters: {
      type: "OBJECT",
      properties: { ids: IDS("Elements inside the frame"), name: S("Title") },
      required: ["ids", "name"],
    },
  },
  {
    name: "group_elements",
    description: "Group elements so they select and move together.",
    parameters: {
      type: "OBJECT",
      properties: { ids: IDS("Elements to group") },
      required: ["ids"],
    },
  },
  {
    name: "arrange_elements",
    description:
      "Tidy existing elements: align them, distribute them evenly, or lay them out as a row, column or grid.",
    parameters: {
      type: "OBJECT",
      properties: {
        ids: IDS("Elements to arrange"),
        how: S("Arrangement", { enum: [...ARRANGEMENTS] }),
      },
      required: ["ids", "how"],
    },
  },
  {
    name: "duplicate_elements",
    description:
      "Copy elements (with the arrows between them) and place the copy next to something.",
    parameters: {
      type: "OBJECT",
      properties: {
        ids: IDS("Elements to copy"),
        count: N("How many copies (default 1)"),
        id: S("Your id for the first copied element"),
        ...PLACEMENT,
      },
      required: ["ids"],
    },
  },
  {
    name: "reorder_elements",
    description: "Bring elements to the front or send them behind others.",
    parameters: {
      type: "OBJECT",
      properties: {
        ids: IDS("Elements to reorder"),
        position: S("front or back", { enum: ["front", "back"] }),
      },
      required: ["ids", "position"],
    },
  },
  {
    name: "set_canvas",
    description: "Change the whiteboard background color or show the grid.",
    parameters: {
      type: "OBJECT",
      properties: {
        background: S("Board background (a light tint)", {
          enum: [...COLORS],
        }),
        grid: B("Show the dotted grid"),
      },
    },
  },
  {
    name: "draw_mermaid",
    description:
      "Draw a complete diagram from Mermaid code (flowchart, sequenceDiagram or classDiagram), laid out automatically. Use it for a brand-new diagram of four or more steps, or to rebuild an existing diagram from scratch (then list what it replaces). Never use it to tweak a diagram that is already on the board.",
    parameters: {
      type: "OBJECT",
      properties: {
        code: S("Mermaid source, no code fences"),
        replaces: IDS(
          'ONLY when the user asked to redo, rebuild or restructure the diagram already on the board: the ids of that diagram; they are deleted and the new one takes their place. Never set it for a new, unrelated diagram. ["all"] means everything listed in CANVAS.',
        ),
        color: SHAPE_STYLE.color,
        fill: SHAPE_STYLE.fill,
        thickness: SHAPE_STYLE.thickness,
        sloppiness: SHAPE_STYLE.sloppiness,
      },
      required: ["code"],
    },
  },
  {
    name: "insert_library_item",
    description:
      "Insert one of the user's saved library items (listed under Library in CANVAS) such as icons, symbols or ready-made components.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: S("Library item name"),
        library: S(
          "Name of an online library from CANVAS (not installed yet); omit for the user's own library",
        ),
        id: S("Your new id for it (n1, n2...)"),
        replace: S(
          "Id of an existing shape this item replaces: it is drawn in that shape's place at a matching size, the shape is removed, and its arrows and label move to the item",
        ),
        ...PLACEMENT,
        ...LINK,
        size: SIZE.size,
      },
      required: ["name"],
    },
  },
  {
    name: "insert_image",
    description:
      "Put one of the pictures the user attached onto the board as an image, exactly as it is (logos, photos, screenshots, SVGs).",
    parameters: {
      type: "OBJECT",
      properties: {
        picture: N("Number of the attached picture (1 is the first)"),
        id: S("Your new id for it (n1, n2...)"),
        ...PLACEMENT,
        size: SIZE.size,
      },
      required: ["picture"],
    },
  },
  {
    name: "trace_image",
    description:
      "Redraw an attached picture by hand with the pencil tool: its outlines become editable freehand strokes. Use it for 'draw this logo', 'sketch this', 'hand-draw it'.",
    parameters: {
      type: "OBJECT",
      properties: {
        picture: N("Number of the attached picture (1 is the first)"),
        detail: S("How many strokes and how fine", {
          enum: ["low", "medium", "high"],
        }),
        id: S("Your new id for it (n1, n2...)"),
        ...PLACEMENT,
        size: SIZE.size,
        color: SHAPE_STYLE.color,
        thickness: SHAPE_STYLE.thickness,
      },
      required: ["picture"],
    },
  },
  {
    name: "smooth_drawing",
    description:
      "Clean up an existing hand drawing or line in place: steadier lines, fewer wobbles, same shape. Use it for 'improve', 'clean up', 'smooth out' a drawing or outline.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: S("Id of the hand-drawing (e1...)"),
        amount: S("How much to clean up", {
          enum: ["light", "medium", "strong"],
        }),
      },
      required: ["id"],
    },
  },
  {
    name: "draw_freehand",
    description:
      "Draw a freehand line yourself with the pencil tool, from a path you describe. Use it to redraw or invent a simple shape or outline. Prefer smooth_drawing to clean up what is already drawn, and trace_image for an attached picture.",
    parameters: {
      type: "OBJECT",
      properties: {
        points: {
          type: "ARRAY",
          items: { type: "NUMBER" },
          description:
            "The path as x,y pairs in one flat list, in a 0 to 100 box: [x1,y1,x2,y2,...]. Use 30 to 120 points for an outline, following its real shape.",
        },
        closed: B("Join the end back to the start"),
        replace: S(
          "Id of an existing drawing this replaces; the new line fills the same area and the old one is removed",
        ),
        id: S("Your new id for it (n1, n2...)"),
        ...PLACEMENT,
        size: SIZE.size,
        color: SHAPE_STYLE.color,
        thickness: SHAPE_STYLE.thickness,
      },
      required: ["points"],
    },
  },
];

export const functionCallToOps = ({ name, args }: FunctionCall): CanvasOp[] => {
  const { style, ...rest } = args;
  const withStyle = { ...rest, stroke: style } as Partial<CanvasOp>;
  switch (name) {
    case "add_element":
      return [{ op: "add", ...withStyle }];
    case "connect":
      return [{ op: "connect", ...withStyle }];
    case "update_element":
      return [{ op: "update", ...withStyle }];
    case "delete_elements":
      return (args.ids ?? []).map((id: string) => ({ op: "delete", id }));
    case "create_frame":
      return [{ op: "frame", ids: args.ids, label: args.name }];
    case "group_elements":
      return [{ op: "group", ids: args.ids }];
    case "arrange_elements":
      return [{ op: "arrange", ids: args.ids, how: args.how }];
    case "duplicate_elements":
      return [{ op: "duplicate", ...rest }];
    case "reorder_elements":
      return [{ op: "reorder", ids: args.ids, position: args.position }];
    case "set_canvas":
      return [{ op: "canvas", ...rest }];
    case "draw_mermaid":
      return [{ op: "mermaid", ...withStyle }];
    case "insert_library_item":
      return [{ op: "library", ...rest }];
    case "insert_image":
      return [{ op: "image", ...rest }];
    case "trace_image":
      return [{ op: "trace", ...rest }];
    case "smooth_drawing":
      return [{ op: "smooth", ...rest }];
    case "draw_freehand":
      return [{ op: "freehand", ...rest }];
    default:
      return [];
  }
};

export const CANVAS_SYSTEM_PROMPT = `You are the assistant inside ColabDraw, a hand-drawn whiteboard built on Excalidraw. You see the board as a list of elements and change it by calling functions that use the whiteboard's own tools: shapes, sticky notes, text, arrows, frames, groups, fonts, colors, fills and the user's library. You never use pixel coordinates.

Each user message ends with a CANVAS section listing what is selected (or on screen) with ids (e1, e2...), text, colors and styles. Use those ids to refer to existing elements. Give new elements your own ids (n1, n2...) so later calls can connect to them. All calls in one reply are applied together as one undo step.

EDITING VS CREATING (most important):
- If the CANVAS already shows elements related to the request, CHANGE THOSE. "Make it blue", "rename X", "add a step after Y", "remove Z", "make it bigger", "use dashed arrows", "tidy this up", "change the font": use update_element, add_element + connect, delete_elements, arrange_elements. Never draw a second copy of something that is already there.
- If the user wants an existing diagram restructured or rebuilt ("redo this", "rebuild it top-down", "start over with this layout"), call draw_mermaid ONCE with replaces listing exactly the element ids of that diagram; the old drawing is removed.
- A request for a NEW diagram about something else ("draw a ... diagram of X") must never delete anything: call draw_mermaid WITHOUT replaces; it is placed in free space next to the existing work. Use replaces only when the user is clearly talking about what is already on the board.
- Do every part of the request: if it says add something and connect it, call both add (or insert) and connect.
- Elements are only visible if listed in CANVAS. If the user refers to something you cannot see, say so briefly.

HOW TO ANSWER:
- Always reply with one or two friendly sentences of text as well; in voice mode they are spoken aloud.
- Questions ("explain this", "what's wrong here", "solve this"): answer in text and call nothing, unless asked to write it on the board (then add a sticky note).
- Brand-new diagram, flow or process of four or more steps on an empty area: draw_mermaid once. Small additions: add_element and connect.

PICTURES AND DRAWINGS:
- Pictures the user attached are numbered in the message ("Attached pictures: 1 = ..."). You can see them. To put one on the board unchanged, call insert_image. To redraw one by hand with the pencil tool ("draw this logo", "sketch it"), call trace_image. Do not rebuild a picture out of rectangles and ellipses.
- Elements listed as hand-drawing are freehand strokes. To improve or clean up a hand drawing or outline, call smooth_drawing on it (light, medium or strong). Use draw_freehand to redraw a simple shape yourself, replacing the old one. Never answer a request about a drawing or picture by adding a flowchart.

MAKING GOOD, DISTINCT DIAGRAMS:
- Use the vocabulary: rectangle = component, ellipse = start/end or actor, diamond = decision, sticky = note/annotation, text = title/label, frames = titled sections, groups = things that belong together.
- Color with meaning (green success/done, red error/danger, blue services, yellow notes/warnings, violet data, orange external), not decoration; keep to 3-4 colors. Use fill patterns, thickness, font and size to show hierarchy: a large "display" or "hand-drawn" title, bold outlines for the main path, dashed lines for optional or async flows, a different arrowhead for a different relation (diamond for composition, cardinality heads for database (ER) relations, circle for events).
- Add a title and a short legend or sticky-note annotation when it helps. Wrap sections in frames. Use library items when one fits (icons, symbols). If CANVAS lists Online libraries that fit what the user asked for, call insert_library_item with library set to that library's name and name set to one of its items; it is saved to their library automatically. The user can ask you to swap shapes for icons ("use icons instead of boxes"): call insert_library_item once per shape with replace set to that shape's id; the icon takes its place, keeps its arrows and its text. Do that instead of saying you can't.
- Omit style options to match the user's current style; only override when asked or when it carries meaning.
- Keep labels short. Only touch what the user asked about. If the request is ambiguous, make a sensible choice.`;

// ---------------------------------------------------------------------------
// reading the board
// ---------------------------------------------------------------------------

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

const keyOf = <T extends Record<string, unknown>>(
  table: T,
  value: unknown,
): keyof T | undefined =>
  (Object.keys(table) as (keyof T)[]).find((key) => table[key] === value);

const CONTEXT_ELEMENT_LIMIT = 80;

const loadLibrary = async (): Promise<NamedLibraryItem[]> =>
  describeLibraryItems(
    ((await LibraryIndexedDBAdapter.load())?.libraryItems ??
      []) as LibraryItem[],
  );

export type CanvasContext = {
  text: string;
  /** alias (e1) → element id */
  aliases: Map<string, string>;
  /** hand drawings or images the model can only understand from a picture */
  visualElements: NonDeletedExcalidrawElement[];
};

const describeElement = (
  element: ExcalidrawElement,
  alias: string,
  aliasOf: Map<string, string>,
  elementsMap: Map<string, ExcalidrawElement>,
) => {
  const label = labelOf(element, elementsMap);
  const stroke = colorNameOf(element.strokeColor);
  const background =
    element.backgroundColor === "transparent"
      ? null
      : colorNameOf(element.backgroundColor) ?? "custom";
  const parts: (string | false | null | undefined)[] = [
    alias,
    element.type === "freedraw" ? "hand-drawing" : element.type,
    label && JSON.stringify(label),
  ];
  if (isArrowElement(element)) {
    const from = element.startBinding?.elementId;
    const to = element.endBinding?.elementId;
    // a bound shape that isn't listed (not selected) is named by its text instead
    const endpoint = (id: string | undefined) => {
      if (!id) {
        return "nothing";
      }
      const target = elementsMap.get(id);
      return (
        aliasOf.get(id) ??
        (target
          ? JSON.stringify(labelOf(target, elementsMap) || target.type)
          : "nothing")
      );
    };
    parts.push(
      `from ${endpoint(from)} to ${endpoint(to)}`,
      element.elbowed ? "elbow" : element.roundness ? "curved" : null,
      element.startArrowhead && `start-${element.startArrowhead}`,
      element.endArrowhead && element.endArrowhead !== "arrow"
        ? `end-${element.endArrowhead}`
        : !element.endArrowhead && "no-head",
    );
  } else {
    parts.push(
      `at (${round(element.x)},${round(element.y)}) size ${round(
        element.width,
      )}x${round(element.height)}`,
    );
  }
  if (element.type === "text") {
    const font = keyOf(FONTS, element.fontFamily);
    parts.push(
      `${round(element.fontSize)}px`,
      font && font !== "hand-drawn" ? font : null,
    );
  }
  parts.push(
    stroke && stroke !== "black" ? `${stroke} outline` : null,
    background ? `${background} fill` : null,
    background && element.fillStyle !== "solid" ? `${element.fillStyle}` : null,
    element.strokeStyle !== "solid" ? element.strokeStyle : null,
    element.strokeWidth > 2 ? "bold" : element.strokeWidth < 2 ? "thin" : null,
    element.roughness !== SLOPPINESS.artist
      ? keyOf(SLOPPINESS, element.roughness)
      : null,
    element.roundness &&
      (element.type === "rectangle" || element.type === "diamond")
      ? "rounded"
      : null,
    element.opacity < 100 ? `${element.opacity}% opacity` : null,
    element.angle ? `rotated ${round((element.angle * 180) / Math.PI)}°` : null,
    element.groupIds.length ? "grouped" : null,
    element.locked ? "locked" : null,
    element.frameId && aliasOf.has(element.frameId)
      ? `in ${aliasOf.get(element.frameId)}`
      : null,
  );
  return parts.filter(Boolean).join(" ");
};

/** Describes the selection (or what's on screen) as compact text for the model. */
export const buildCanvasContext = async (
  api: ExcalidrawImperativeAPI,
  /** the user's request, used to look for matching online libraries */
  userText?: string,
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
  const pool = (selected.length ? selected : visible).filter(
    (element) => !(element.type === "text" && element.containerId),
  );
  const described = [...pool]
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

  const lines = described.map((element) =>
    describeElement(element, aliasOf.get(element.id)!, aliasOf, elementsMap),
  );

  const hiddenCount = selected.length ? 0 : elements.length - visible.length;
  const library = await loadLibrary();
  const online = userText
    ? await onlineLibraryContext(
        userText,
        described.map((element) => labelOf(element, elementsMap)).join(" "),
      )
    : "";
  const sloppiness = keyOf(SLOPPINESS, appState.currentItemRoughness);

  const text = [
    "CANVAS",
    selected.length
      ? `The user selected ${selected.length} element(s); "this" means the selection.`
      : "Nothing is selected; these are the elements on screen.",
    pool.length > described.length
      ? `(showing the ${described.length} nearest of ${pool.length})`
      : "",
    lines.length ? lines.join("\n") : "(the visible board is empty)",
    hiddenCount ? `(${hiddenCount} more elements are off screen)` : "",
    `Current style: ${appState.currentItemFillStyle} fill, ${
      sloppiness ?? "artist"
    } sloppiness, ${
      colorNameOf(appState.currentItemStrokeColor) ?? "custom"
    } ink.`,
    library.length
      ? `Library:\n${library
          .map(({ name, description }) => `- "${name}" (${description})`)
          .join("\n")}`
      : "",
    online,
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
// styling
// ---------------------------------------------------------------------------

// room for an arrow label between neighbours
const GAP = 140;

/** shade 0 (lightest) to 4 (strongest) of a palette color */
const shadeOf = (color: ColorName, index: number): string => {
  const shades = COLOR_PALETTE[color];
  if (Array.isArray(shades)) {
    return shades[index];
  }
  if (color === "black") {
    return [
      COLOR_PALETTE.gray[0],
      COLOR_PALETTE.gray[1],
      COLOR_PALETTE.gray[2],
      COLOR_PALETTE.gray[3],
      COLOR_PALETTE.black,
    ][index];
  }
  return COLOR_PALETTE.white;
};

const roundnessFor = (type: string, rounded: boolean) => {
  if (!rounded) {
    return null;
  }
  switch (type) {
    case "rectangle":
      return { type: ROUNDNESS.ADAPTIVE_RADIUS };
    case "diamond":
    case "arrow":
    case "line":
      return { type: ROUNDNESS.PROPORTIONAL_RADIUS };
    default:
      return null;
  }
};

/**
 * Only the style fields the model actually asked for, as element updates.
 * `tintsFill`: a bare `color` also tints the fill (shapes), as in one-click palettes.
 */
const explicitStyle = (op: CanvasOp, type: string, tintsFill: boolean) => {
  const tone = TONES[op.tone ?? "light"];
  const patch: Record<string, unknown> = {};
  if (op.color) {
    patch.strokeColor = shadeOf(op.color, 4);
    if (tintsFill && !op.background && op.fill !== "none") {
      patch.backgroundColor = shadeOf(op.color, tone);
    }
  }
  if (op.background) {
    patch.backgroundColor =
      op.background === "transparent"
        ? "transparent"
        : shadeOf(op.background, tone);
  }
  if (op.fill === "none") {
    patch.backgroundColor = "transparent";
  } else if (op.fill) {
    patch.fillStyle = op.fill;
  }
  if (op.stroke) {
    patch.strokeStyle = op.stroke;
  }
  if (op.thickness) {
    patch.strokeWidth = getStrokeWidthByKey(
      type as ExcalidrawElement["type"],
      THICKNESS[op.thickness],
    );
  }
  if (op.sloppiness) {
    patch.roughness = SLOPPINESS[op.sloppiness];
  }
  if (op.opacity !== undefined && Number.isFinite(op.opacity)) {
    patch.opacity = Math.min(100, Math.max(0, op.opacity));
  }
  if (op.angle !== undefined && Number.isFinite(op.angle)) {
    patch.angle = (op.angle * Math.PI) / 180;
  }
  if (op.rounded !== undefined) {
    patch.roundness = roundnessFor(type, op.rounded);
  }
  return patch;
};

const explicitFont = (op: CanvasOp) => {
  const patch: Record<string, unknown> = {};
  if (op.font) {
    patch.fontFamily = FONTS[op.font];
  }
  if (op.fontSize) {
    patch.fontSize = FONT_SIZE_NAMES[op.fontSize];
  }
  if (op.textAlign) {
    patch.textAlign = op.textAlign;
  }
  return patch;
};

const arrowheadOf = (name: ArrowheadName | undefined) =>
  name === "none" ? null : name;

const defaultStyle = (appState: AppState, type: string) => ({
  strokeColor: appState.currentItemStrokeColor,
  backgroundColor: appState.currentItemBackgroundColor,
  fillStyle: appState.currentItemFillStyle,
  strokeWidth: getStrokeWidthByKey(
    type as ExcalidrawElement["type"],
    appState.currentItemStrokeWidthKey,
  ),
  strokeStyle: appState.currentItemStrokeStyle,
  roughness: appState.currentItemRoughness,
  opacity: appState.currentItemOpacity,
  roundness: roundnessFor(type, appState.currentItemRoundness === "round"),
});

const sizeFor = (op: CanvasOp, label = "") => {
  // wide enough that the longest word never breaks mid-word
  const longestWord = Math.max(
    ...label.split(/\s+/).map((word) => word.length),
  );
  const width = Math.min(
    Math.max(60 + label.length * 9, 40 + longestWord * 13, 140),
    280,
  );
  const k = SIZES[op.size ?? "medium"];
  let w: number;
  let h: number;
  switch (op.shape) {
    case "ellipse":
      [w, h] = [width + 30, 90];
      break;
    case "diamond":
      // a diamond's text area is about half its width
      [w, h] = [Math.round(width * 1.8), 140];
      break;
    case "sticky":
      [w, h] = [DEFAULT_STICKY_NOTE_SIZE, DEFAULT_STICKY_NOTE_SIZE];
      break;
    case "text":
      [w, h] = [Math.max(label.length * 11, 40), 30];
      break;
    case "line":
      [w, h] = [200, 0];
      break;
    default:
      [w, h] = [width, 80];
  }
  w *= k;
  h *= k;
  if (op.stretch === "wide") {
    w *= 1.5;
  } else if (op.stretch === "tall") {
    h *= 1.6;
  } else if (op.stretch === "square") {
    w = h = Math.max(w, h);
  }
  return { w: round(w), h: round(h) };
};

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// applying ops
// ---------------------------------------------------------------------------

export type ApplyResult = {
  added: number;
  changed: number;
  deleted: number;
  /** online library items saved to the user's library */
  libraryAdded: number;
  newElementIds: string[];
  failedOps?: { op: string; error: string }[];
};

/** one pencil stroke through absolute scene points */
const freehandElement = (
  points: Point[],
  style: Record<string, any>,
  groupIds: string[] = [],
) => {
  const { minX, minY, width, height } = boundsOf(points);
  return newFreeDrawElement({
    type: "freedraw",
    x: minX,
    y: minY,
    width,
    height,
    points: points.map(([px, py]) => [px - minX, py - minY]) as any,
    simulatePressure: true,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    opacity: style.opacity,
    roughness: style.roughness,
    groupIds,
  } as any);
};

export const applyCanvasOps = async (
  api: ExcalidrawImperativeAPI,
  ops: CanvasOp[],
  aliases: Map<string, string>,
  /** pictures attached to the message, numbered from 1 in the order given */
  pictures: PictureRef[] = [],
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
    libraryAdded: 0,
    newElementIds: [],
  };

  const ids = new Map(aliases);
  const resolve = (ref?: string) => (ref ? ids.get(ref) ?? null : null);
  const existing = (ref?: string) => {
    const id = resolve(ref);
    const element = id ? scene.getNonDeletedElement(id) : null;
    return element ?? null;
  };
  const existingAll = (refs?: string[]) =>
    (refs ?? [])
      .map((ref) => existing(ref))
      .filter(Boolean) as NonDeletedExcalidrawElement[];

  const [vx1, vy1, vx2, vy2] = getVisibleSceneBounds(appState);
  let occupied: (Box & { id?: string })[] = scene
    .getNonDeletedElements()
    .filter(
      (element) =>
        element.x < vx2 + 400 && element.x + element.width > vx1 - 400,
    )
    .map((element) => ({ ...boxOf(element), id: element.id }));
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

  const place = (
    size: { w: number; h: number },
    op: Pick<CanvasOp, "near" | "side">,
  ): Box => {
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
  const toFront = new Set<string>();
  const toBack = new Set<string>();
  const files: { id: FileId; mimeType: string; dataURL: string }[] = [];
  const nextAppState: Partial<AppState> = {};

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

  const boundTextOf = (element: ExcalidrawElement) =>
    getBoundTextElement(element, scene.getNonDeletedElementsMap());

  /** let later calls refer to an inserted group by its main shape, so arrows can bind to it */
  const registerInserted = (
    refId: string | undefined,
    placed: readonly ExcalidrawElement[],
  ) => {
    const bindable = placed.filter((element) =>
      ["rectangle", "ellipse", "diamond"].includes(element.type),
    );
    const main = [...(bindable.length ? bindable : placed)].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    if (refId && main) {
      ids.set(refId, main.id);
      newBoxes.set(main.id, boxOf(main));
    }
  };

  /** an element with its bound label, so deletes/moves/groups keep them together */
  const withLabel = (elements: readonly ExcalidrawElement[]) =>
    elements.flatMap((element) => {
      const text = boundTextOf(element);
      return text ? [element, text] : [element];
    });

  const moveBy = (
    element: NonDeletedExcalidrawElement,
    dx: number,
    dy: number,
  ) => {
    scene.mutateElement(element, { x: element.x + dx, y: element.y + dy });
    const text = boundTextOf(element);
    if (text) {
      scene.mutateElement(text, { x: text.x + dx, y: text.y + dy });
    }
    updateBoundElements(element, scene);
  };

  const fontDefaults = {
    fontFamily: appState.currentItemFontFamily,
    fontSize: appState.currentItemFontSize,
  };
  /** font props for a new text or label, with the model's overrides */
  const fontFor = (op: CanvasOp, scale = 1) => {
    const merged = { ...fontDefaults, ...explicitFont(op) } as {
      fontFamily: number;
      fontSize: number;
      textAlign?: string;
    };
    return {
      ...merged,
      fontSize: op.fontSize
        ? merged.fontSize
        : Math.max(8, round(merged.fontSize * scale)),
    };
  };

  /** style an existing text-like element and its label, then refit */
  const applyFont = (element: ExcalidrawElement, op: CanvasOp, scale = 1) => {
    const text =
      element.type === "text" ? element : (boundTextOf(element) as any);
    if (!text) {
      return;
    }
    const patch = explicitFont(op);
    if (scale !== 1 && !op.fontSize) {
      (patch as any).fontSize = Math.max(8, round(text.fontSize * scale));
    }
    if (Object.keys(patch).length) {
      scene.mutateElement(text, patch);
      redrawTextBoundingBox(
        text,
        element.type === "text" ? null : element,
        scene,
      );
    }
  };

  // models often batch deletes/updates as one op with an ids list
  const expandedOps = ops.flatMap((op) =>
    (op.op === "delete" || op.op === "update") && !op.id && op.ids
      ? op.ids.map((id) => ({ ...op, id }))
      : [op],
  );

  // the converter can only bind arrows to new rectangles, ellipses and diamonds
  const bindable = (id: string) => {
    const pending = skeletons.find((skeleton) => skeleton.id === id);
    return (
      !pending || ["rectangle", "ellipse", "diamond"].includes(pending.type)
    );
  };

  const doConnect = (op: CanvasOp, base: Record<string, unknown> = {}) => {
    const fromId = resolve(op.from);
    const toId = resolve(op.to);
    const fromBox = boxOfRef(op.from);
    const toBox = boxOfRef(op.to);
    if (!fromId || !toId || !fromBox || !toBox || fromId === toId) {
      result.failedOps ??= [];
      result.failedOps.push({
        op: "connect",
        error: `Could not connect: ${!fromId ? `source "${op.from}" not found` : !toId ? `target "${op.to}" not found` : "invalid endpoints"}`,
      });
      return;
    }
    for (const ref of [op.from, op.to]) {
      const refId = resolve(ref);
      const element =
        existing(ref) ?? extraElements.find((extra) => extra.id === refId);
      if (element) {
        proxyFor(element);
      }
    }
    const dx = toBox.x + toBox.w / 2 - (fromBox.x + fromBox.w / 2);
    const dy = toBox.y + toBox.h / 2 - (fromBox.y + fromBox.h / 2);
    const start = edgePoint(fromBox, dx, dy);
    const end = edgePoint(toBox, -dx, -dy);
    const style = {
      ...defaultStyle(appState, "arrow"),
      ...base,
      ...explicitStyle(op, "arrow", false),
    };
    const arrowType =
      op.arrowType ??
      (appState.currentItemArrowType === "round"
        ? "curved"
        : appState.currentItemArrowType);
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
      roundness: arrowType === "curved" ? roundnessFor("arrow", true) : null,
      elbowed: arrowType === "elbow",
      startArrowhead:
        op.startArrowhead !== undefined
          ? arrowheadOf(op.startArrowhead)
          : appState.currentItemStartArrowhead,
      endArrowhead:
        op.endArrowhead !== undefined
          ? arrowheadOf(op.endArrowhead)
          : appState.currentItemEndArrowhead ?? "arrow",
      start: bindable(fromId) ? { id: fromId } : undefined,
      end: bindable(toId) ? { id: toId } : undefined,
      label: op.label ? { text: op.label, ...fontFor(op) } : undefined,
    } as ExcalidrawElementSkeleton);
    result.added++;
  };

  // arrows and frames are built after everything else has moved, so they bind to final positions
  const deferred: (() => void)[] = [];
  const connect = (op: CanvasOp, base: Record<string, unknown> = {}) => {
    deferred.push(() => doConnect(op, base));
  };

  const linkToNear = (op: CanvasOp, alias: string) => {
    if (op.link && op.near) {
      connect({
        op: "connect",
        from: op.near,
        to: alias,
        label: op.linkLabel,
        endArrowhead: op.linkArrowhead,
      });
    }
  };

  for (const op of expandedOps) {
    switch (op.op) {
      case "add": {
        const id = randomId();
        const alias = op.id ?? `__n${id}`;
        ids.set(alias, id);
        linkToNear(op, alias);
        const shape = op.shape ?? "rectangle";
        const textScale = SIZES[op.size ?? "medium"];
        const box = place(sizeFor({ ...op, shape }, op.label), op);
        newBoxes.set(id, box);
        const type = shape === "sticky" ? "rectangle" : shape;
        const style = {
          ...defaultStyle(appState, type),
          ...explicitStyle(op, type, true),
        };
        const font = fontFor(op, textScale);
        const label = op.label
          ? {
              text: op.label,
              ...font,
              ...(op.textAlign ? { textAlign: op.textAlign } : null),
            }
          : undefined;
        if (shape === "text") {
          skeletons.push({
            type: "text",
            id,
            x: box.x,
            y: box.y,
            text: op.label ?? "",
            ...font,
            strokeColor: style.strokeColor,
            opacity: style.opacity,
            angle: (style as { angle?: number }).angle ?? 0,
          } as ExcalidrawElementSkeleton);
        } else if (shape === "sticky") {
          skeletons.push({
            type: "stickynote",
            id,
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
            ...(op.color || op.background
              ? { backgroundColor: style.backgroundColor }
              : null),
            ...(op.opacity !== undefined ? { opacity: style.opacity } : null),
            ...(op.angle !== undefined
              ? { angle: (style as { angle?: number }).angle }
              : null),
            label,
          } as ExcalidrawElementSkeleton);
        } else if (shape === "line") {
          skeletons.push({
            type: "line",
            id,
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
            strokeColor: style.strokeColor,
            strokeWidth: style.strokeWidth,
            strokeStyle: style.strokeStyle,
            roughness: style.roughness,
            opacity: style.opacity,
            angle: (style as { angle?: number }).angle ?? 0,
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
            label,
          } as ExcalidrawElementSkeleton);
        }
        result.added++;
        break;
      }
      case "connect": {
        connect(op);
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
              pending.label = {
                ...(pending.label ?? fontFor(op)),
                text: op.label,
              };
            }
          }
          Object.assign(pending, explicitStyle(op, pending.type, true));
          break;
        }
        const element = existing(op.id);
        if (!element) {
          result.failedOps ??= [];
          result.failedOps.push({
            op: "update",
            error: `Element "${op.id}" not found on canvas`,
          });
          break;
        }
        const isArrow = isArrowElement(element);
        // an existing arrow can't be switched to elbow in place: redraw it between the same elements
        if (isArrow && op.arrowType === "elbow" && !element.elbowed) {
          const startId = element.startBinding?.elementId;
          const endId = element.endBinding?.elementId;
          if (startId && endId) {
            const label = boundTextOf(element)?.originalText;
            ids.set(`@${startId}`, startId);
            ids.set(`@${endId}`, endId);
            toDelete.push(...withLabel([element]));
            connect(
              {
                ...op,
                op: "connect",
                from: `@${startId}`,
                to: `@${endId}`,
                label: op.label ?? label,
                startArrowhead:
                  op.startArrowhead ?? element.startArrowhead ?? "none",
                endArrowhead: op.endArrowhead ?? element.endArrowhead ?? "none",
              },
              {
                strokeColor: element.strokeColor,
                strokeWidth: element.strokeWidth,
                strokeStyle: element.strokeStyle,
                roughness: element.roughness,
                opacity: element.opacity,
              },
            );
            result.changed++;
            break;
          }
        }
        const patch = explicitStyle(op, element.type, !isArrow);
        // an arrow's curvature is its own setting, not a corner radius
        if (isArrow && op.arrowType && op.arrowType !== "elbow") {
          patch.roundness =
            op.arrowType === "curved" ? roundnessFor("arrow", true) : null;
        }
        if (isArrow) {
          if (op.startArrowhead !== undefined) {
            patch.startArrowhead = arrowheadOf(op.startArrowhead);
          }
          if (op.endArrowhead !== undefined) {
            patch.endArrowhead = arrowheadOf(op.endArrowhead);
          }
        }
        if (element.type === "text") {
          // text color is its stroke; fills don't apply
          delete patch.backgroundColor;
        }
        if (Object.keys(patch).length) {
          scene.mutateElement(element, patch as any);
          const text = boundTextOf(element);
          if (text && op.color) {
            scene.mutateElement(text, {
              strokeColor: patch.strokeColor as string,
            });
          }
        }
        // size: scale around the center
        if (op.size || op.stretch) {
          if (element.type === "text") {
            applyFont(element, op, SIZES[op.size ?? "medium"]);
          } else if (!isArrow) {
            const base = { w: element.width, h: element.height };
            const k = SIZES[op.size ?? "medium"];
            let w = base.w * k;
            let h = base.h * k;
            if (op.stretch === "wide") {
              w *= 1.5;
            } else if (op.stretch === "tall") {
              h *= 1.6;
            } else if (op.stretch === "square") {
              w = h = Math.max(w, h);
            }
            scene.mutateElement(element, {
              x: element.x - (w - base.w) / 2,
              y: element.y - (h - base.h) / 2,
              width: w,
              height: h,
            });
            const text = boundTextOf(element);
            if (text) {
              redrawTextBoundingBox(text, element, scene);
            }
            updateBoundElements(element, scene);
          }
        }
        if (op.font || op.fontSize || op.textAlign) {
          applyFont(element, op);
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
            let boundText = boundTextOf(element);
            if (!boundText) {
              const text = newTextElement({
                x: element.x,
                y: element.y,
                text: op.label,
                ...fontFor(op),
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
        if (op.near && !isArrow) {
          const target = place({ w: element.width, h: element.height }, op);
          moveBy(element, target.x - element.x, target.y - element.y);
        }
        result.changed++;
        break;
      }
      case "delete": {
        const element = existing(op.id);
        if (!element) {
          break;
        }
        toDelete.push(...withLabel([element]));
        result.deleted++;
        break;
      }
      case "frame": {
        deferred.push(() => {
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
          } else if ((op.ids ?? []).length > 0) {
            result.failedOps ??= [];
            result.failedOps.push({
              op: "frame",
              error: `Specified elements for frame "${op.label ?? ""}" were not found`,
            });
          }
        });
        break;
      }
      case "group": {
        const members = withLabel(existingAll(op.ids));
        if (members.length > 1) {
          const groupId = randomId();
          for (const member of members) {
            scene.mutateElement(member, {
              groupIds: [...member.groupIds, groupId],
            });
          }
          result.changed++;
        }
        break;
      }
      case "arrange": {
        const members = existingAll(op.ids).filter(
          (element) => !isArrowElement(element),
        );
        if (members.length < 2) {
          break;
        }
        const how = op.how ?? "grid";
        const [x1, y1, x2, y2] = getCommonBounds(withLabel(members));
        if (how.startsWith("align_")) {
          const [axis, position] = {
            align_left: ["x", "start"],
            align_center: ["x", "center"],
            align_right: ["x", "end"],
            align_top: ["y", "start"],
            align_middle: ["y", "center"],
            align_bottom: ["y", "end"],
          }[how as "align_left"] as ["x" | "y", "start" | "center" | "end"];
          alignElements(members, { axis, position }, scene, appState);
        } else if (how.startsWith("distribute_")) {
          distributeElements(
            members,
            scene.getNonDeletedElementsMap(),
            {
              space: "between",
              axis: how === "distribute_horizontally" ? "x" : "y",
            },
            appState,
            scene,
          );
        } else if (how === "row" || how === "column") {
          const horizontal = how === "row";
          const sorted = [...members].sort((a, b) =>
            horizontal ? a.x - b.x : a.y - b.y,
          );
          const crossCenter = horizontal ? (y1 + y2) / 2 : (x1 + x2) / 2;
          let cursor = horizontal ? x1 : y1;
          for (const element of sorted) {
            const size = horizontal ? element.width : element.height;
            const cross = horizontal ? element.height : element.width;
            const targetX = horizontal ? cursor : crossCenter - cross / 2;
            const targetY = horizontal ? crossCenter - cross / 2 : cursor;
            moveBy(element, targetX - element.x, targetY - element.y);
            cursor += size + 80;
          }
        } else {
          const units = members.map((element) => withLabel([element]));
          const placed = positionElementsOnGrid(
            units,
            (x1 + x2) / 2,
            (y1 + y2) / 2,
            80,
          );
          for (const moved of placed) {
            if (moved.type === "text" && (moved as any).containerId) {
              continue;
            }
            const original = scene.getNonDeletedElement(moved.id);
            if (original) {
              moveBy(original, moved.x - original.x, moved.y - original.y);
            }
          }
        }
        result.changed++;
        break;
      }
      case "duplicate": {
        const members = withLabel(existingAll(op.ids));
        if (!members.length) {
          break;
        }
        const memberIds = new Set(members.map((element) => element.id));
        // keep the arrows that run between the copied elements
        const arrows = scene
          .getNonDeletedElements()
          .filter(
            (element) =>
              isArrowElement(element) &&
              element.startBinding &&
              element.endBinding &&
              memberIds.has(element.startBinding.elementId) &&
              memberIds.has(element.endBinding.elementId),
          );
        const source = [...members, ...withLabel(arrows)];
        const [x1, y1, x2, y2] = getCommonBounds(source);
        let anchor = op.near ? op : { near: undefined, side: op.side };
        for (
          let copy = 0;
          copy < Math.min(Math.max(op.count ?? 1, 1), 8);
          copy++
        ) {
          const { duplicatedElements } = duplicateElements({
            type: "everything",
            elements: source,
            randomizeSeed: true,
          });
          const box = place({ w: x2 - x1, h: y2 - y1 }, anchor);
          anchor = { near: undefined, side: op.side };
          const placed = duplicatedElements.map((element) => ({
            ...element,
            x: element.x - x1 + box.x,
            y: element.y - y1 + box.y,
          }));
          extraElements.push(...placed);
          if (copy === 0) {
            registerInserted(op.id, placed);
          }
          result.added += duplicatedElements.filter(
            (element) => !(element.type === "text" && element.containerId),
          ).length;
        }
        break;
      }
      case "reorder": {
        const members = withLabel(existingAll(op.ids));
        for (const member of members) {
          (op.position === "back" ? toBack : toFront).add(member.id);
        }
        result.changed += members.length ? 1 : 0;
        break;
      }
      case "canvas": {
        if (op.background) {
          nextAppState.viewBackgroundColor = shadeOf(
            op.background as ColorName,
            0,
          );
        }
        if (op.grid !== undefined) {
          nextAppState.gridModeEnabled = op.grid;
        }
        result.changed++;
        break;
      }
      case "library": {
        let match = op.library
          ? undefined
          : findLibraryItem(await loadLibrary(), op.name ?? "");
        if (!match) {
          // not installed: take it from libraries.excalidraw.com and keep it
          const online = await resolveOnlineItem(op.library, op.name);
          if (online) {
            match = online.entry;
            await api.updateLibrary({
              libraryItems: [{ ...online.entry.item, name: online.entry.name }],
              merge: true,
            });
            result.libraryAdded++;
          }
        }
        if (!match) {
          result.failedOps ??= [];
          result.failedOps.push({
            op: "library",
            error: `Library item "${op.name ?? ""}" not found`,
          });
          break;
        }
        const { duplicatedElements } = duplicateElements({
          type: "everything",
          elements: match.item.elements,
          randomizeSeed: true,
        });
        const [x1, y1, x2, y2] = getCommonBounds(duplicatedElements);
        const target = op.replace ? existing(op.replace) : null;
        const itemSize = Math.max(x2 - x1, y2 - y1, 1);
        // replacing a shape: match its size unless a size was asked for
        const k =
          target && !op.size
            ? Math.min(
                2.5,
                Math.max(
                  0.3,
                  Math.max(90, Math.max(target.width, target.height) * 0.8) /
                    itemSize,
                ),
              )
            : SIZES[op.size ?? "medium"];
        const itemBox = { w: (x2 - x1) * k, h: (y2 - y1) * k };
        let box: Box;
        if (target) {
          box = {
            x: target.x + target.width / 2 - itemBox.w / 2,
            y: target.y + target.height / 2 - itemBox.h / 2,
            ...itemBox,
          };
          occupied = occupied.filter((entry) => entry.id !== target.id);
          occupied.push(box);
          lastPlaced = box;
        } else {
          box = place(itemBox, op);
        }
        const placed: ExcalidrawElement[] = [];
        for (const element of duplicatedElements) {
          placed.push({
            ...element,
            x: (element.x - x1) * k + box.x,
            y: (element.y - y1) * k + box.y,
            width: element.width * k,
            height: element.height * k,
            ...(element.type === "text"
              ? { fontSize: (element as any).fontSize * k }
              : null),
            ...("points" in element
              ? {
                  points: (element as any).points.map(([px, py]: number[]) => [
                    px * k,
                    py * k,
                  ]),
                }
              : null),
          } as ExcalidrawElement);
        }
        extraElements.push(...placed);
        const alias = op.id ?? `__lib${randomId()}`;
        registerInserted(alias, placed);
        linkToNear(op, alias);
        result.added++;
        if (target && op.replace) {
          const mainId = ids.get(alias)!;
          const oldLabel = boundTextOf(target)?.originalText;
          toDelete.push(...withLabel([target]));
          result.deleted++;
          // later calls that name the old shape now mean the icon
          ids.set(op.replace, mainId);
          ids.set(`@${target.id}`, mainId);
          for (const arrow of scene.getNonDeletedElements()) {
            if (
              !isArrowElement(arrow) ||
              toDelete.includes(arrow) ||
              (arrow.startBinding?.elementId !== target.id &&
                arrow.endBinding?.elementId !== target.id)
            ) {
              continue;
            }
            const startsHere = arrow.startBinding?.elementId === target.id;
            const otherId = startsHere
              ? arrow.endBinding?.elementId
              : arrow.startBinding?.elementId;
            if (!otherId || otherId === target.id) {
              continue;
            }
            if (!ids.has(`@${otherId}`)) {
              ids.set(`@${otherId}`, otherId);
            }
            toDelete.push(...withLabel([arrow]));
            connect(
              {
                op: "connect",
                from: startsHere ? alias : `@${otherId}`,
                to: startsHere ? `@${otherId}` : alias,
                label: boundTextOf(arrow)?.originalText,
                arrowType: arrow.elbowed
                  ? "elbow"
                  : arrow.roundness
                  ? "curved"
                  : "sharp",
                startArrowhead: arrow.startArrowhead ?? "none",
                endArrowhead: arrow.endArrowhead ?? "none",
              },
              {
                strokeColor: arrow.strokeColor,
                strokeWidth: arrow.strokeWidth,
                strokeStyle: arrow.strokeStyle,
                roughness: arrow.roughness,
                opacity: arrow.opacity,
              },
            );
          }
          // keep the old shape's name under the icon
          if (oldLabel) {
            const font = fontFor(op);
            skeletons.push({
              type: "text",
              id: randomId(),
              x:
                box.x +
                box.w / 2 -
                (oldLabel.length * font.fontSize * 0.55) / 2,
              y: box.y + box.h + 6,
              text: oldLabel,
              ...font,
            } as ExcalidrawElementSkeleton);
          }
        }
        break;
      }
      case "image": {
        const picture = pictures[(op.picture ?? 1) - 1];
        if (!picture) {
          break;
        }
        const natural = await measureImage(picture.url);
        const fit =
          (360 * SIZES[op.size ?? "medium"]) /
          Math.max(natural.width, natural.height);
        const width = round(natural.width * fit);
        const height = round(natural.height * fit);
        const box = place({ w: width, h: height }, op);
        const fileId = randomId() as FileId;
        files.push({
          id: fileId,
          mimeType: picture.mimeType,
          dataURL: picture.url,
        });
        const image = newImageElement({
          type: "image",
          fileId,
          status: "saved",
          x: box.x,
          y: box.y,
          width,
          height,
        });
        extraElements.push(image);
        registerInserted(op.id ?? `__img${image.id}`, [image]);
        result.added++;
        break;
      }
      case "trace": {
        const picture = pictures[(op.picture ?? 1) - 1];
        if (!picture) {
          break;
        }
        const traced = await traceImage(picture.url, op.detail ?? "medium");
        if (!traced.contours.length) {
          break;
        }
        const fit =
          (360 * SIZES[op.size ?? "medium"]) /
          Math.max(traced.width, traced.height);
        const box = place(
          { w: round(traced.width * fit), h: round(traced.height * fit) },
          op,
        );
        const style = {
          ...defaultStyle(appState, "freedraw"),
          ...explicitStyle(op, "freedraw", false),
        };
        const groupId = randomId();
        const strokes = traced.contours.map((contour) =>
          freehandElement(
            contour.map(
              ([px, py]): Point => [px * fit + box.x, py * fit + box.y],
            ),
            style,
            [groupId],
          ),
        );
        extraElements.push(...strokes);
        registerInserted(op.id ?? `__trace${groupId}`, strokes);
        result.added += strokes.length;
        break;
      }
      case "smooth": {
        const element = existing(op.id);
        if (
          !element ||
          (element.type !== "freedraw" && element.type !== "line")
        ) {
          break;
        }
        const points = element.points.map(([px, py]): Point => [px, py]);
        const { width, height } = boundsOf(points);
        const size = Math.max(width, height);
        const rounds = { light: 2, medium: 6, strong: 16 }[
          op.amount ?? "medium"
        ];
        // even out the wobble, then keep only the points the shape needs
        const cleaned = simplifyPath(
          smoothPath(relaxPath(points, rounds), 1),
          size * 0.004,
        );
        const bounds = boundsOf(cleaned);
        scene.mutateElement(element, {
          points: cleaned,
          width: bounds.width,
          height: bounds.height,
          ...(element.type === "freedraw"
            ? { pressures: [], simulatePressure: true }
            : null),
        } as any);
        result.changed++;
        break;
      }
      case "freehand": {
        const pairs: Point[] = [];
        for (let i = 0; i + 1 < (op.points?.length ?? 0); i += 2) {
          const x = Number(op.points![i]);
          const y = Number(op.points![i + 1]);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            pairs.push([x, y]);
          }
        }
        if (pairs.length < 2) {
          break;
        }
        if (op.closed) {
          pairs.push(pairs[0]);
        }
        const path = smoothPath(pairs, 1);
        const shape = boundsOf(path);
        const target = op.replace ? existing(op.replace) : null;
        let box: Box;
        if (target) {
          // the new line takes the old drawing's place and size
          box = boxOf(target);
          occupied = occupied.filter((entry) => entry.id !== target.id);
          occupied.push(box);
          lastPlaced = box;
          toDelete.push(target);
          result.deleted++;
        } else {
          const width = 300 * SIZES[op.size ?? "medium"];
          const aspect = shape.width ? shape.height / shape.width : 1;
          box = place(
            { w: round(width), h: round(Math.min(width * aspect, width * 3)) },
            op,
          );
        }
        const style = {
          ...defaultStyle(appState, "freedraw"),
          ...explicitStyle(op, "freedraw", false),
        };
        const stroke = freehandElement(
          path.map(
            ([px, py]): Point => [
              box.x + ((px - shape.minX) / (shape.width || 1)) * box.w,
              box.y + ((py - shape.minY) / (shape.height || 1)) * box.h,
            ],
          ),
          style,
        );
        extraElements.push(stroke);
        registerInserted(op.id ?? `__draw${stroke.id}`, [stroke]);
        result.added++;
        break;
      }
      case "mermaid": {
        let mermaidElements: ExcalidrawElement[] = [];
        try {
          mermaidElements = await mermaidToElements(api, op, appState);
        } catch (err: any) {
          result.failedOps ??= [];
          result.failedOps.push({
            op: "mermaid",
            error: err?.message || "Failed to parse Mermaid diagram syntax",
          });
          break;
        }
        if (!mermaidElements.length) {
          result.failedOps ??= [];
          result.failedOps.push({
            op: "mermaid",
            error: "Mermaid diagram produced no elements",
          });
          break;
        }
        const [x1, y1, x2, y2] = getCommonBounds(mermaidElements);
        const size = { w: x2 - x1, h: y2 - y1 };
        let box: Box;
        const replaced = (
          op.replaces?.includes("all")
            ? [...aliases.values()].map((id) => scene.getNonDeletedElement(id))
            : (op.replaces ?? []).map((ref) => existing(ref))
        ).filter(Boolean) as NonDeletedExcalidrawElement[];
        if (replaced.length) {
          // take the old drawing's place
          const targets = withLabel(replaced);
          const [rx1, ry1, rx2, ry2] = getCommonBounds(targets);
          const old = new Set(targets.map((element) => element.id));
          toDelete.push(
            ...targets.filter((element) => !toDelete.includes(element)),
          );
          result.deleted += replaced.filter(
            (element) => !(element.type === "text" && element.containerId),
          ).length;
          occupied = occupied.filter(
            (entry) => !entry.id || !old.has(entry.id),
          );
          box = {
            x: (rx1 + rx2) / 2 - size.w / 2,
            y: (ry1 + ry2) / 2 - size.h / 2,
            ...size,
          };
          occupied.push(box);
          lastPlaced = box;
        } else {
          // a new diagram goes to free space, never on top of the user's work
          box = place(size, { near: undefined, side: op.side });
        }
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

  for (const run of deferred) {
    run();
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
      // an inserted library item or copy: patch it in the pending list
      const index = extraElements.findIndex((extra) => extra.id === element.id);
      if (index >= 0) {
        extraElements[index] = {
          ...extraElements[index],
          boundElements: [
            ...(extraElements[index].boundElements ?? []),
            ...(element.boundElements ?? []),
          ],
        } as ExcalidrawElement;
      }
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
    const boundText = element.frameId ? boundTextOf(real) : null;
    if (boundText) {
      scene.mutateElement(boundText, { frameId: element.frameId });
    }
  }

  const newElements = [...created, ...extraElements];
  result.newElementIds = newElements
    .filter((element) => !(element.type === "text" && element.containerId))
    .map((element) => element.id);

  const deletedIds = new Set(toDelete.map((element) => element.id));
  let merged = [
    ...scene
      .getElementsIncludingDeleted()
      .map((element) =>
        deletedIds.has(element.id)
          ? newElementWith(element, { isDeleted: true })
          : element,
      ),
    ...newElements,
  ];
  if (toFront.size || toBack.size) {
    merged = [
      ...merged.filter((element) => toBack.has(element.id)),
      ...merged.filter(
        (element) => !toBack.has(element.id) && !toFront.has(element.id),
      ),
      ...merged.filter((element) => toFront.has(element.id)),
    ];
  }
  if (result.newElementIds.length) {
    nextAppState.selectedElementIds = Object.fromEntries(
      result.newElementIds.map((id) => [id, true]),
    );
  }
  if (files.length) {
    api.addFiles(
      files.map((file) => ({ ...file, created: Date.now() })) as any,
    );
  }
  api.updateScene({
    elements: merged,
    appState: Object.keys(nextAppState).length
      ? (nextAppState as AppState)
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
  op: CanvasOp,
  appState: AppState,
): Promise<ExcalidrawElement[]> => {
  const { parseMermaidToExcalidraw } = await import(
    "@excalidraw/mermaid-to-excalidraw"
  );
  const definition = (op.code ?? "")
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: any = null;
  let lastError: unknown = null;
  try {
    parsed = await parseMermaidToExcalidraw(definition);
  } catch (primaryError) {
    lastError = primaryError;
    try {
      parsed = await parseMermaidToExcalidraw(definition.replace(/"/g, "'"));
    } catch {
      try {
        const { getMermaidAutoFixCandidates } = await import(
          "@excalidraw/excalidraw/components/TTDDialog/utils/mermaidAutoFix"
        );
        const { getErrorMessage } = await import(
          "@excalidraw/excalidraw/components/TTDDialog/utils/mermaidError"
        );
        const errMsg = getErrorMessage(primaryError) || String(primaryError);
        const candidates = getMermaidAutoFixCandidates(definition, errMsg);
        for (const candidate of candidates) {
          try {
            parsed = await parseMermaidToExcalidraw(candidate);
            if (parsed?.elements?.length) {
              break;
            }
          } catch {
            // try next candidate
          }
        }
      } catch {
        // ignore autofix loading error
      }
    }
  }

  if (!parsed || !parsed.elements?.length) {
    const errorDetails =
      lastError instanceof Error
        ? lastError.message
        : String(lastError ?? "Syntax error");
    throw new Error(`Mermaid diagram parsing failed: ${errorDetails}`);
  }
  // the requested (or current) look; fonts stay as measured by the parser
  const style = explicitStyle(
    { ...op, rounded: undefined, angle: undefined },
    "rectangle",
    true,
  );
  const { backgroundColor, fillStyle, ...lineStyle } = style;
  const styled = parsed.elements.map((skeleton: any) => {
    const roughness = appState.currentItemRoughness;
    if (skeleton.type === "text") {
      return { ...skeleton, roughness };
    }
    const label =
      skeleton.label && style.strokeColor
        ? { label: { ...skeleton.label, strokeColor: style.strokeColor } }
        : null;
    if (skeleton.type === "arrow" || skeleton.type === "line") {
      return { ...skeleton, roughness, ...lineStyle, ...label };
    }
    return { ...skeleton, roughness, ...style, ...label };
  });
  void backgroundColor;
  void fillStyle;
  // non-flowchart types come back as an image
  if (parsed.files) {
    api.addFiles(Object.values(parsed.files));
  }
  return convertToExcalidrawElements(styled, { regenerateIds: true });
};
