import {
  centerOf,
  getSegments,
  pointInPolygon,
  pointOnPath,
  totalLength,
} from "./geometry";
import {
  HEIGHT,
  WIDTH,
  type CollisionBox,
  type Layout,
  type Orientation,
  type Placement,
  type Point,
  type Unit,
} from "./types";

export function getTokens(value: string, selectedUnit: Unit) {
  const cleaned = value.replace(/\s+/g, " ").trim() || "word";
  if (selectedUnit === "letter") return Array.from(cleaned.replace(/ /g, "·"));
  if (selectedUnit === "word") return cleaned.split(" ").filter(Boolean);
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function tokenWidth(text: string, size: number) {
  return Math.max(size * 0.62, Array.from(text).length * size * 0.54);
}

export function placementAngle(
  selectedOrientation: Orientation,
  pathAngle: number,
  point: Point,
  center: Point,
  selectedLayout: Layout,
) {
  if (selectedOrientation === "upright") return 0;
  if (selectedOrientation === "radial") {
    return Math.atan2(point.y - center.y, point.x - center.x) * (180 / Math.PI);
  }
  return selectedLayout === "outline" ? pathAngle : 0;
}

export function makeCollisionBox(
  center: Point,
  width: number,
  size: number,
  angle: number,
  gap: number,
): CollisionBox {
  const radians = angle * (Math.PI / 180);
  const padding = Math.max(0.75, Math.min(size * 0.08, gap * 0.15));
  return {
    center,
    halfWidth: width / 2 + padding,
    halfHeight: size * 0.48 + padding,
    xAxis: { x: Math.cos(radians), y: Math.sin(radians) },
    yAxis: { x: -Math.sin(radians), y: Math.cos(radians) },
  };
}

function dotProduct(a: Point, b: Point) {
  return a.x * b.x + a.y * b.y;
}

function projectionRadius(box: CollisionBox, axis: Point) {
  return (
    box.halfWidth * Math.abs(dotProduct(box.xAxis, axis)) +
    box.halfHeight * Math.abs(dotProduct(box.yAxis, axis))
  );
}

export function collisionBoxesOverlap(a: CollisionBox, b: CollisionBox) {
  const centerDifference = {
    x: b.center.x - a.center.x,
    y: b.center.y - a.center.y,
  };
  for (const axis of [a.xAxis, a.yAxis, b.xAxis, b.yAxis]) {
    const centerDistance = Math.abs(dotProduct(centerDifference, axis));
    if (
      centerDistance >=
      projectionRadius(a, axis) + projectionRadius(b, axis)
    ) {
      return false;
    }
  }
  return true;
}

export function buildPlacements(
  source: Point[],
  sourceTokens: string[],
  selectedLayout: Layout,
  selectedOrientation: Orientation,
  size: number,
  gap: number,
  closed: boolean,
): Placement[] {
  if (source.length < 2 || !sourceTokens.length) return [];
  const result: Placement[] = [];
  const center = centerOf(source);

  if (selectedLayout === "outline") {
    const segments = getSegments(source, closed);
    const total = totalLength(segments);
    let cursor = size * 0.5;
    let index = 0;
    const collisionBoxes: CollisionBox[] = [];
    const collisionSearchStep = Math.max(2, size * 0.15, gap * 0.2);
    while (cursor < total - size * 0.25) {
      const text = sourceTokens[index % sourceTokens.length];
      const width = tokenWidth(text, size);
      if (cursor + width > total) break;
      const pathPoint = pointOnPath(segments, cursor + width / 2);
      const angle = placementAngle(
        selectedOrientation,
        pathPoint.angle,
        pathPoint.point,
        center,
        selectedLayout,
      );
      const collisionBox = makeCollisionBox(
        pathPoint.point,
        width,
        size,
        angle,
        gap,
      );
      if (
        collisionBoxes.some((placedBox) =>
          collisionBoxesOverlap(collisionBox, placedBox),
        )
      ) {
        cursor += collisionSearchStep;
        continue;
      }
      result.push({
        ...pathPoint.point,
        text,
        angle,
        index,
      });
      collisionBoxes.push(collisionBox);
      cursor += width + gap;
      index += 1;
    }
    return result;
  }

  const minX = Math.max(16, Math.min(...source.map((point) => point.x)));
  const maxX = Math.min(
    WIDTH - 16,
    Math.max(...source.map((point) => point.x)),
  );
  const minY = Math.max(16, Math.min(...source.map((point) => point.y)));
  const maxY = Math.min(
    HEIGHT - 16,
    Math.max(...source.map((point) => point.y)),
  );
  let index = 0;

  const rowGap = size * 1.25 + gap;
  for (let y = minY + size; y < maxY; y += rowGap) {
    let x = minX + size / 2;
    while (x < maxX) {
      const text = sourceTokens[index % sourceTokens.length];
      const width = tokenWidth(text, size);
      const point = { x: x + width / 2, y };
      if (pointInPolygon(point, source)) {
        result.push({
          ...point,
          text,
          angle: placementAngle(
            selectedOrientation,
            0,
            point,
            center,
            selectedLayout,
          ),
          index,
        });
        index += 1;
      }
      x += width + gap;
    }
  }
  return result;
}
