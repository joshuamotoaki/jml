import { pointInPolygon } from "./geometry";
import type { Point } from "./types";

export function translatePoints(source: Point[], dx: number, dy: number) {
  return source.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

export function scalePointsAbout(
  source: Point[],
  origin: Point,
  scaleX: number,
  scaleY: number,
) {
  return source.map((point) => ({
    x: origin.x + (point.x - origin.x) * scaleX,
    y: origin.y + (point.y - origin.y) * scaleY,
  }));
}

export function rotatePointsAbout(
  source: Point[],
  origin: Point,
  degrees: number,
) {
  const radians = degrees * (Math.PI / 180);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return source.map((point) => {
    const relativeX = point.x - origin.x;
    const relativeY = point.y - origin.y;
    return {
      x: origin.x + relativeX * cosine - relativeY * sine,
      y: origin.y + relativeX * sine + relativeY * cosine,
    };
  });
}

/**
 * Weights in [0, 1] for each shape point: 1 inside the lasso, feathering
 * down to 0 over neighboring points so bends hinge smoothly.
 */
export function makeBendWeights(
  source: Point[],
  lasso: Point[],
  closed: boolean,
) {
  const selected = source.map((point) => pointInPolygon(point, lasso));
  if (!selected.some(Boolean)) return [];
  const feather = Math.max(3, Math.round(source.length * 0.055));
  const weights = selected.map((value) => (value ? 1 : 0));
  for (
    let selectedIndex = 0;
    selectedIndex < selected.length;
    selectedIndex += 1
  ) {
    if (!selected[selectedIndex]) continue;
    for (let offset = 1; offset <= feather; offset += 1) {
      const weight = 1 - offset / (feather + 1);
      for (const direction of [-1, 1]) {
        let index = selectedIndex + offset * direction;
        if (closed) {
          index = (index + source.length) % source.length;
        } else if (index < 0 || index >= source.length) {
          continue;
        }
        weights[index] = Math.max(weights[index], weight);
      }
    }
  }
  return weights;
}

export function applyBend(
  source: Point[],
  pivot: Point,
  weights: number[],
  degrees: number,
) {
  const radians = degrees * (Math.PI / 180);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return source.map((point, index) => {
    const weight = weights[index] ?? 0;
    if (!weight) return { ...point };
    const relativeX = point.x - pivot.x;
    const relativeY = point.y - pivot.y;
    const rotated = {
      x: pivot.x + relativeX * cosine - relativeY * sine,
      y: pivot.y + relativeX * sine + relativeY * cosine,
    };
    return {
      x: point.x + (rotated.x - point.x) * weight,
      y: point.y + (rotated.y - point.y) * weight,
    };
  });
}

/**
 * Soft sculpt: pull points toward the drag vector with a radial falloff
 * around the brush center.
 */
export function applyWarp(
  source: Point[],
  brush: Point,
  dx: number,
  dy: number,
  radius: number,
) {
  const radiusSquared = radius * radius;
  return source.map((point) => {
    const distanceSquared = (point.x - brush.x) ** 2 + (point.y - brush.y) ** 2;
    if (distanceSquared >= radiusSquared) return { ...point };
    const falloff = 1 - Math.sqrt(distanceSquared) / radius;
    const weight = falloff * falloff * (3 - 2 * falloff);
    return { x: point.x + dx * weight, y: point.y + dy * weight };
  });
}
