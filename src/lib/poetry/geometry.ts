import { HEIGHT, WIDTH, clonePoints, type Point } from "./types";

export function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export type PathSegment = {
  start: Point;
  end: Point;
  length: number;
  offset: number;
};

export function getSegments(source: Point[], closed: boolean): PathSegment[] {
  if (source.length < 2) return [];
  const segments: PathSegment[] = [];
  let offset = 0;
  const segmentCount = closed ? source.length : source.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = source[index];
    const end = source[(index + 1) % source.length];
    const length = distance(start, end);
    if (length > 0) {
      segments.push({ start, end, length, offset });
      offset += length;
    }
  }
  return segments;
}

export function totalLength(segments: PathSegment[]) {
  if (!segments.length) return 0;
  const last = segments[segments.length - 1];
  return last.offset + last.length;
}

export function pointOnPath(segments: PathSegment[], target: number) {
  if (!segments.length)
    return { point: { x: WIDTH / 2, y: HEIGHT / 2 }, angle: 0 };
  const total = totalLength(segments);
  const bounded = Math.max(0, Math.min(target, total));
  const segment =
    segments.find((item) => bounded <= item.offset + item.length) ??
    segments[segments.length - 1];
  const ratio = (bounded - segment.offset) / segment.length;
  return {
    point: {
      x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
      y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
    },
    angle:
      Math.atan2(
        segment.end.y - segment.start.y,
        segment.end.x - segment.start.x,
      ) *
      (180 / Math.PI),
  };
}

export function pointOnNormalizedPath(
  source: Point[],
  closed: boolean,
  progress: number,
) {
  const segments = getSegments(source, closed);
  return pointOnPath(
    segments,
    totalLength(segments) * Math.max(0, Math.min(1, progress)),
  );
}

export function pathProgressForPoint(
  source: Point[],
  closed: boolean,
  target: Point,
) {
  const segments = getSegments(source, closed);
  if (!segments.length) return 0;
  const total = totalLength(segments);
  let closestProgress = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const squaredLength = dx * dx + dy * dy;
    const ratio = Math.max(
      0,
      Math.min(
        1,
        ((target.x - segment.start.x) * dx +
          (target.y - segment.start.y) * dy) /
          squaredLength,
      ),
    );
    const point = {
      x: segment.start.x + dx * ratio,
      y: segment.start.y + dy * ratio,
    };
    const squaredDistance =
      (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (squaredDistance < closestDistance) {
      closestDistance = squaredDistance;
      closestProgress = (segment.offset + segment.length * ratio) / total;
    }
  }
  return closestProgress;
}

export function resamplePath(source: Point[], closed: boolean, count: number) {
  if (source.length < 2 || count < 2) return clonePoints(source);
  const segments = getSegments(source, closed);
  if (!segments.length) return clonePoints(source);
  const total = totalLength(segments);
  const divisor = closed ? count : Math.max(1, count - 1);
  return Array.from(
    { length: count },
    (_, index) => pointOnPath(segments, (total * index) / divisor).point,
  );
}

export function rotatePointList(source: Point[], offset: number) {
  const bounded = ((offset % source.length) + source.length) % source.length;
  return [...source.slice(bounded), ...source.slice(0, bounded)];
}

export function pointListCost(a: Point[], b: Point[]) {
  let cost = 0;
  const step = Math.max(1, Math.floor(a.length / 48));
  for (let index = 0; index < a.length; index += step) {
    const dx = a[index].x - b[index].x;
    const dy = a[index].y - b[index].y;
    cost += dx * dx + dy * dy;
  }
  return cost;
}

function cyclicCostAtOffset(fixed: Point[], variant: Point[], offset: number) {
  const length = variant.length;
  const bounded = ((offset % length) + length) % length;
  let cost = 0;
  const step = Math.max(1, Math.floor(length / 48));
  for (let index = 0; index < length; index += step) {
    const other = variant[(index + bounded) % length];
    const dx = fixed[index].x - other.x;
    const dy = fixed[index].y - other.y;
    cost += dx * dx + dy * dy;
  }
  return cost;
}

/**
 * Rotate (and possibly reverse) `movable` so its points pair naturally with
 * `fixed`. Coarse-to-fine offset search keeps this fast enough to run on
 * every frame of a canvas drag.
 */
export function bestCyclicMatch(fixed: Point[], movable: Point[]) {
  let bestVariant = movable;
  let bestOffset = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  const coarseStep = Math.max(1, Math.floor(movable.length / 36));
  const variants = [movable, [...movable].reverse()];
  for (const variant of variants) {
    for (let offset = 0; offset < variant.length; offset += coarseStep) {
      const cost = cyclicCostAtOffset(fixed, variant, offset);
      if (cost < bestCost) {
        bestVariant = variant;
        bestOffset = offset;
        bestCost = cost;
      }
    }
  }
  for (
    let offset = bestOffset - coarseStep + 1;
    offset < bestOffset + coarseStep;
    offset += 1
  ) {
    const cost = cyclicCostAtOffset(fixed, bestVariant, offset);
    if (cost < bestCost) {
      bestOffset = offset;
      bestCost = cost;
    }
  }
  return rotatePointList(bestVariant, bestOffset);
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const a = polygon[current];
    const b = polygon[previous];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 0.00001) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function centerOf(source: Point[]): Point {
  if (!source.length) return { x: WIDTH / 2, y: HEIGHT / 2 };
  return {
    x: source.reduce((sum, point) => sum + point.x, 0) / source.length,
    y: source.reduce((sum, point) => sum + point.y, 0) / source.length,
  };
}

export function boundsOf(source: Point[]) {
  if (!source.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of source) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function polygonArea(source: Point[]) {
  let area = 0;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[(index + 1) % source.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

export function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return distance(point, start);
  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return distance(point, {
    x: start.x + dx * ratio,
    y: start.y + dy * ratio,
  });
}

export function simplifyOpenPath(source: Point[], tolerance: number): Point[] {
  if (source.length <= 2) return source;
  let furthestIndex = 0;
  let furthestDistance = 0;
  for (let index = 1; index < source.length - 1; index += 1) {
    const candidate = pointToSegmentDistance(
      source[index],
      source[0],
      source[source.length - 1],
    );
    if (candidate > furthestDistance) {
      furthestDistance = candidate;
      furthestIndex = index;
    }
  }
  if (furthestDistance <= tolerance) {
    return [source[0], source[source.length - 1]];
  }
  const first = simplifyOpenPath(source.slice(0, furthestIndex + 1), tolerance);
  const second = simplifyOpenPath(source.slice(furthestIndex), tolerance);
  return [...first.slice(0, -1), ...second];
}

export function simplifyClosedPath(source: Point[], tolerance: number) {
  if (source.length < 8) return source;
  let splitIndex = 1;
  let splitDistance = 0;
  for (let index = 1; index < source.length; index += 1) {
    const candidate = distance(source[0], source[index]);
    if (candidate > splitDistance) {
      splitDistance = candidate;
      splitIndex = index;
    }
  }
  const first = simplifyOpenPath(source.slice(0, splitIndex + 1), tolerance);
  const second = simplifyOpenPath(
    [...source.slice(splitIndex), source[0]],
    tolerance,
  );
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

export function reduceNearbyPoints(source: Point[], minimumDistance: number) {
  if (source.length < 4) return source;
  const result = [source[0]];
  for (let index = 1; index < source.length; index += 1) {
    if (distance(result[result.length - 1], source[index]) >= minimumDistance) {
      result.push(source[index]);
    }
  }
  return result.length >= 3 ? result : source;
}

export function smoothClosedPath(source: Point[], amount: number) {
  let result = source;
  const passes = Math.round(amount / 2);
  for (let pass = 0; pass < passes; pass += 1) {
    result = result.map((point, index) => {
      const previous = result[(index - 1 + result.length) % result.length];
      const next = result[(index + 1) % result.length];
      return {
        x: point.x * 0.62 + (previous.x + next.x) * 0.19,
        y: point.y * 0.62 + (previous.y + next.y) * 0.19,
      };
    });
  }
  return result;
}

export function pointsToPath(source: Point[], closed: boolean) {
  if (!source.length) return "";
  const commands = source.map(
    (point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
  );
  return `${commands.join(" ")}${closed && source.length > 2 ? " Z" : ""}`;
}

/** Order-preserving spatial index used to pair fill placements between poses. */
export function hilbertIndex(point: Point) {
  const order = 1024;
  let x = Math.max(
    0,
    Math.min(order - 1, Math.round((point.x / WIDTH) * 1023)),
  );
  let y = Math.max(
    0,
    Math.min(order - 1, Math.round((point.y / HEIGHT) * 1023)),
  );
  let index = 0;
  for (let scale = order / 2; scale > 0; scale = Math.floor(scale / 2)) {
    const rx = (x & scale) > 0 ? 1 : 0;
    const ry = (y & scale) > 0 ? 1 : 0;
    index += scale * scale * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = scale - 1 - x;
        y = scale - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return index;
}

export function makeCircle(): Point[] {
  return Array.from({ length: 128 }, (_, index) => {
    const angle = (index / 128) * Math.PI * 2 - Math.PI / 2;
    return { x: 450 + Math.cos(angle) * 225, y: 325 + Math.sin(angle) * 225 };
  });
}

export function makeHeart(): Point[] {
  return Array.from({ length: 160 }, (_, index) => {
    const t = (index / 160) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    return { x: 450 + x * 14, y: 330 - y * 14 };
  });
}

export function interpolateAngle(a: number, b: number, progress: number) {
  const difference = ((b - a + 540) % 360) - 180;
  return a + difference * progress;
}
