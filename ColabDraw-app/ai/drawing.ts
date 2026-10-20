export type Point = [number, number];

// ---------------------------------------------------------------------------
// cleaning up strokes
// ---------------------------------------------------------------------------

const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared),
      )
    : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** Ramer-Douglas-Peucker: drops points that barely change the line's shape. */
export const simplifyPath = (points: Point[], tolerance: number): Point[] => {
  if (points.length < 3) {
    return points;
  }
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = 0;
    let index = -1;
    for (let i = from + 1; i < to; i++) {
      const distance = distanceToSegment(points[i], points[from], points[to]);
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (index >= 0 && worst > tolerance) {
      keep[index] = true;
      stack.push([from, index], [index, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
};

/** Chaikin corner cutting: rounds off jaggies, keeping both ends where they are. */
export const smoothPath = (points: Point[], rounds: number): Point[] => {
  let current = points;
  for (let round = 0; round < rounds && current.length > 2; round++) {
    const next: Point[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const [ax, ay] = current[i];
      const [bx, by] = current[i + 1];
      next.push(
        [ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25],
        [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75],
      );
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
};

/** Pulls each point toward its neighbours' midpoint, evening out wobble. Ends stay put. */
export const relaxPath = (points: Point[], rounds: number): Point[] => {
  let current = points;
  for (let round = 0; round < rounds; round++) {
    const from = current;
    current = from.map((p, i) =>
      i === 0 || i === from.length - 1
        ? p
        : [
            p[0] * 0.5 + (from[i - 1][0] + from[i + 1][0]) * 0.25,
            p[1] * 0.5 + (from[i - 1][1] + from[i + 1][1]) * 0.25,
          ],
    );
  }
  return current;
};

export const boundsOf = (points: Point[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

export const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The picture couldn't be read."));
    image.src = url;
  });

/** natural size, with a sane default for vector files that don't state one */
export const measureImage = async (url: string) => {
  const image = await loadImage(url);
  return {
    width: image.naturalWidth || 300,
    height: image.naturalHeight || 300,
  };
};

const drawScaled = (image: HTMLImageElement, longestSide: number) => {
  const width = image.naturalWidth || 300;
  const height = image.naturalHeight || 300;
  const scale = longestSide / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  return { canvas, context };
};

/** A small data URL of a picture, for the chat history. */
export const makeThumbnail = async (url: string, longestSide = 128) => {
  const image = await loadImage(url);
  const { canvas, context } = drawScaled(image, longestSide);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

/** Gemini reads png, jpeg and webp; anything else (SVG, GIF, BMP...) goes in as a png. */
export const toModelImage = async (url: string, mimeType: string) => {
  if (["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
    return { mimeType, data: url.split(",")[1] };
  }
  const image = await loadImage(url);
  const { canvas, context } = drawScaled(image, 1024);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    mimeType: "image/png",
    data: canvas.toDataURL("image/png").split(",")[1],
  };
};

// ---------------------------------------------------------------------------
// tracing: turn a picture's shapes into pencil strokes
// ---------------------------------------------------------------------------

/** Otsu's method: the brightness that best splits dark from light. */
const otsuThreshold = (values: Uint8ClampedArray) => {
  const histogram = new Array<number>(256).fill(0);
  for (const value of values) {
    histogram[value]++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }
  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let threshold = 128;
  for (let i = 0; i < 256; i++) {
    weightBackground += histogram[i];
    if (!weightBackground) {
      continue;
    }
    const weightForeground = values.length - weightBackground;
    if (!weightForeground) {
      break;
    }
    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return threshold;
};

/** true where the picture has "ink" (its shapes, not its background) */
const inkMask = (data: ImageData) => {
  const { width, height } = data;
  const pixels = data.data;
  const mask = new Uint8Array(width * height);
  let translucent = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 250) {
      translucent = true;
      break;
    }
  }
  if (translucent) {
    // a cut-out logo: whatever is visible is the drawing
    for (let i = 0; i < mask.length; i++) {
      mask[i] = pixels[i * 4 + 3] > 128 ? 1 : 0;
    }
    return mask;
  }
  const brightness = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) {
    brightness[i] =
      0.299 * pixels[i * 4] +
      0.587 * pixels[i * 4 + 1] +
      0.114 * pixels[i * 4 + 2];
  }
  const threshold = otsuThreshold(brightness);
  let dark = 0;
  for (let i = 0; i < mask.length; i++) {
    if (brightness[i] <= threshold) {
      dark++;
    }
  }
  // the drawing is the smaller of the two tones
  const inkIsDark = dark <= mask.length / 2;
  for (let i = 0; i < mask.length; i++) {
    const isDark = brightness[i] <= threshold;
    mask[i] = isDark === inkIsDark ? 1 : 0;
  }
  return mask;
};

/**
 * Marching squares: closed outlines around every ink region and hole, as
 * lists of points in the mask's pixel coordinates.
 */
const contoursOf = (mask: Uint8Array, width: number, height: number) => {
  // pad by one pixel so every outline closes
  const W = width + 2;
  const H = height + 2;
  const at = (x: number, y: number) =>
    x > 0 && y > 0 && x <= width && y <= height
      ? mask[(y - 1) * width + (x - 1)]
      : 0;

  // edge midpoints are doubled so they stay integers: top (2x+1,2y), left (2x,2y+1)...
  const key = (px: number, py: number) => py * (2 * W + 3) + px;
  const neighbours = new Map<number, number[]>();
  const coordinates = new Map<number, Point>();
  const link = (a: Point, b: Point) => {
    const ka = key(a[0], a[1]);
    const kb = key(b[0], b[1]);
    coordinates.set(ka, [a[0] / 2, a[1] / 2]);
    coordinates.set(kb, [b[0] / 2, b[1] / 2]);
    (neighbours.get(ka) ?? neighbours.set(ka, []).get(ka)!).push(kb);
    (neighbours.get(kb) ?? neighbours.set(kb, []).get(kb)!).push(ka);
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const top: Point = [2 * x + 1, 2 * y];
      const right: Point = [2 * x + 2, 2 * y + 1];
      const bottom: Point = [2 * x + 1, 2 * y + 2];
      const left: Point = [2 * x, 2 * y + 1];
      switch (tl * 8 + tr * 4 + br * 2 + bl) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 5:
          link(top, right);
          link(left, bottom);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(top, left);
          break;
        case 10:
          link(top, left);
          link(bottom, right);
          break;
        default:
          break;
      }
    }
  }

  const visited = new Set<number>();
  const loops: Point[][] = [];
  for (const start of neighbours.keys()) {
    if (visited.has(start)) {
      continue;
    }
    const loop: Point[] = [];
    let previous = -1;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      loop.push(coordinates.get(current)!);
      const options = neighbours.get(current)!;
      const from = previous;
      const next = options.find((n) => n !== from && !visited.has(n));
      if (next === undefined) {
        break;
      }
      previous = current;
      current = next;
    }
    loops.push(loop);
  }
  return loops;
};

const TRACE_DETAIL = {
  low: { size: 110, tolerance: 1.6, smooth: 2, keep: 6 },
  medium: { size: 180, tolerance: 1.1, smooth: 2, keep: 10 },
  high: { size: 260, tolerance: 0.8, smooth: 1, keep: 16 },
} as const;

/**
 * The outlines of a picture's shapes as hand-drawn-ready strokes, in the
 * coordinates of a scaled-down copy of the picture (returned with its size).
 */
export const traceImage = async (
  url: string,
  detail: keyof typeof TRACE_DETAIL = "medium",
) => {
  const settings = TRACE_DETAIL[detail];
  const image = await loadImage(url);
  const { canvas, context } = drawScaled(image, settings.size);
  // opaque photos need a plain backdrop; cut-outs keep their transparency
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const loops = contoursOf(inkMask(pixels), canvas.width, canvas.height);

  const contours = loops
    .map((loop) => {
      const closed = [...loop, loop[0]];
      return smoothPath(
        simplifyPath(closed, settings.tolerance),
        settings.smooth,
      );
    })
    .filter((contour) => {
      const { width, height } = boundsOf(contour);
      // drop specks and anti-aliasing noise
      return contour.length >= 6 && Math.max(width, height) >= 6;
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, settings.keep);

  return { contours, width: canvas.width, height: canvas.height };
};
