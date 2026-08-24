import { ease } from "./easing";
import {
  bestCyclicMatch,
  centerOf,
  distance,
  hilbertIndex,
  interpolateAngle,
  pathProgressForPoint,
  pointListCost,
  pointOnNormalizedPath,
  resamplePath,
} from "./geometry";
import {
  collisionBoxesOverlap,
  makeCollisionBox,
  placementAngle,
  tokenWidth,
} from "./layout";
import { buildPlacements } from "./layout";
import {
  clampProgress,
  type EasingName,
  type Keyframe,
  type MotionDoc,
  type Placement,
  type Point,
  type Pose,
  type SegmentPlan,
  type StaggerDirection,
  type StaggerMode,
  type TextStyle,
} from "./types";

const SHAPE_SAMPLES = 180;

function posesAreEquivalent(start: Pose, end: Pose) {
  if (
    start.closed !== end.closed ||
    start.points.length < 2 ||
    end.points.length < 2
  )
    return false;
  const startSample = resamplePath(start.points, start.closed, 64);
  const endSample = resamplePath(end.points, end.closed, 64);
  return startSample.every(
    (point, index) => distance(point, endSample[index]) < 0.05,
  );
}

function alignedShapes(start: Pose, end: Pose) {
  let startShape = resamplePath(start.points, start.closed, SHAPE_SAMPLES);
  let endShape = resamplePath(end.points, end.closed, SHAPE_SAMPLES);
  if (
    startShape.length !== SHAPE_SAMPLES ||
    endShape.length !== SHAPE_SAMPLES
  ) {
    return { startShape, endShape };
  }
  if (start.closed && !end.closed) {
    startShape = bestCyclicMatch(endShape, startShape);
  } else if (end.closed) {
    endShape = bestCyclicMatch(startShape, endShape);
  } else if (
    pointListCost(startShape, [...endShape].reverse()) <
    pointListCost(startShape, endShape)
  ) {
    endShape.reverse();
  }
  return { startShape, endShape };
}

function spatiallyMatchPlacements(start: Placement[], end: Placement[]) {
  if (!start.length || start.length !== end.length) return end;
  const sourceOrder = start
    .map((placement, index) => ({ index, order: hilbertIndex(placement) }))
    .sort((a, b) => a.order - b.order);
  const targetOrder = end
    .map((placement, index) => ({ index, order: hilbertIndex(placement) }))
    .sort((a, b) => a.order - b.order);
  const matched: Placement[] = Array(start.length);
  sourceOrder.forEach((source, orderIndex) => {
    const target = end[targetOrder[orderIndex].index];
    matched[source.index] = {
      ...target,
      text: start[source.index].text,
      index: start[source.index].index,
    };
  });
  return matched;
}

function normalizePiece(placement: Placement, index: number): Placement {
  return { ...placement, index, opacity: 1, scale: 1 };
}

/**
 * Build the interpolation plan for one timeline segment. Pieces shared by
 * both poses pair up index-to-index (outline) or spatially (fill); surplus
 * pieces on either side grow in / shrink out at their own spot on the pose
 * that has room for them.
 */
export function buildSegmentPlan(
  start: Pose,
  end: Pose,
  tokens: string[],
  style: TextStyle,
): SegmentPlan | undefined {
  if (start.points.length < 2 || end.points.length < 2 || !tokens.length) {
    return undefined;
  }

  if (posesAreEquivalent(start, end)) {
    const shape = resamplePath(start.points, start.closed, SHAPE_SAMPLES);
    const staticPlacements = buildPlacements(
      start.points,
      tokens,
      style.layout,
      style.orientation,
      style.size,
      style.gap,
      start.closed,
    ).map(normalizePiece);
    return {
      startShape: shape,
      endShape: shape.map((point) => ({ ...point })),
      startClosed: start.closed,
      endClosed: end.closed,
      startPlacements: staticPlacements,
      endPlacements: staticPlacements.map((placement) => ({ ...placement })),
      startCapacity: staticPlacements.length,
      endCapacity: staticPlacements.length,
      style,
    };
  }

  const { startShape, endShape } = alignedShapes(start, end);
  const rawStart = buildPlacements(
    startShape,
    tokens,
    style.layout,
    style.orientation,
    style.size,
    style.gap,
    start.closed,
  );
  const rawEnd = buildPlacements(
    endShape,
    tokens,
    style.layout,
    style.orientation,
    style.size,
    style.gap,
    end.closed,
  );
  const shared = Math.min(rawStart.length, rawEnd.length);
  if (!shared) return undefined;
  const followContour =
    style.layout === "outline" && start.closed === end.closed;

  const startPlacements: Placement[] = rawStart
    .slice(0, shared)
    .map(normalizePiece);
  let endPlacements: Placement[] = rawEnd.slice(0, shared).map(normalizePiece);
  if (style.layout !== "outline") {
    endPlacements = spatiallyMatchPlacements(startPlacements, endPlacements);
  }

  const addSurplus = (
    surplus: Placement[],
    presentShape: Point[],
    presentClosed: boolean,
    surplusOnEnd: boolean,
  ) => {
    surplus.forEach((placement) => {
      const index = startPlacements.length;
      const progress = pathProgressForPoint(
        presentShape,
        presentClosed,
        placement,
      );
      const phase = surplusOnEnd ? "enter" : "exit";
      // Both endpoints share the piece's position on the pose that has room
      // for it; when the layout follows the contour it rides the morphing
      // shape at a fixed progress. Presence itself (scale/opacity 0 -> 1) is
      // shaped by `interpolateSegment`.
      const present: Placement = {
        ...normalizePiece(placement, index),
        pathProgress: followContour ? progress : undefined,
        pathOffset: followContour ? 0 : undefined,
        phase,
      };
      const absent: Placement = { ...present, opacity: 0, scale: 0 };
      if (surplusOnEnd) {
        startPlacements.push(absent);
        endPlacements.push(present);
      } else {
        startPlacements.push(present);
        endPlacements.push(absent);
      }
    });
  };

  if (rawEnd.length > shared) {
    addSurplus(
      rawEnd.slice(shared).map((placement, offset) => ({
        ...placement,
        index: shared + offset,
      })),
      endShape,
      end.closed,
      true,
    );
  } else if (rawStart.length > shared) {
    addSurplus(
      rawStart.slice(shared).map((placement, offset) => ({
        ...placement,
        index: shared + offset,
      })),
      startShape,
      start.closed,
      false,
    );
  }

  return {
    startShape,
    endShape,
    startClosed: start.closed,
    endClosed: end.closed,
    startPlacements,
    endPlacements,
    startCapacity: rawStart.length,
    endCapacity: rawEnd.length,
    style,
  };
}

export function interpolateShape(plan: SegmentPlan, progress: number): Point[] {
  return plan.startShape.map((start, index) => ({
    x: start.x + (plan.endShape[index].x - start.x) * progress,
    y: start.y + (plan.endShape[index].y - start.y) * progress,
  }));
}

function resolveCollisions(source: Placement[], size: number, gap: number) {
  const result: Placement[] = [];
  const placedBoxes: ReturnType<typeof makeCollisionBox>[] = [];
  const step = Math.max(1.5, size * 0.1, gap * 0.08);
  const maximumSteps = 18;

  for (const placement of source) {
    if ((placement.opacity ?? 1) < 0.08) {
      result.push(placement);
      continue;
    }
    const radians = placement.angle * (Math.PI / 180);
    const tangent = { x: Math.cos(radians), y: Math.sin(radians) };
    const offsets = [0];
    for (let attempt = 1; attempt <= maximumSteps; attempt += 1) {
      const direction = attempt % 2 === 1 ? 1 : -1;
      offsets.push(direction * Math.ceil(attempt / 2) * step);
    }

    let bestPlacement = placement;
    const placementScale = placement.scale ?? 1;
    let bestBox = makeCollisionBox(
      placement,
      tokenWidth(placement.text, size) * placementScale,
      size * placementScale,
      placement.angle,
      gap,
    );
    let fewestOverlaps = Number.POSITIVE_INFINITY;
    for (const offset of offsets) {
      const candidate = {
        ...placement,
        x: placement.x + tangent.x * offset,
        y: placement.y + tangent.y * offset,
      };
      const candidateBox = makeCollisionBox(
        candidate,
        tokenWidth(candidate.text, size) * placementScale,
        size * placementScale,
        candidate.angle,
        gap,
      );
      const overlaps = placedBoxes.reduce(
        (total, placed) =>
          total + (collisionBoxesOverlap(candidateBox, placed) ? 1 : 0),
        0,
      );
      if (overlaps < fewestOverlaps) {
        bestPlacement = candidate;
        bestBox = candidateBox;
        fewestOverlaps = overlaps;
      }
      if (!overlaps) break;
    }
    result.push(bestPlacement);
    placedBoxes.push(bestBox);
  }
  return result;
}

function staggerOrder(
  index: number,
  count: number,
  direction: StaggerDirection,
) {
  if (count <= 1) return 0;
  const normalized = index / (count - 1);
  if (direction === "reverse") return 1 - normalized;
  if (direction === "center") return Math.abs(normalized - 0.5) * 2;
  return normalized;
}

function pieceProgress(
  progress: number,
  index: number,
  count: number,
  stagger: StaggerMode,
  amount: number,
  direction: StaggerDirection,
) {
  if (count <= 1 || stagger === "none") return progress;
  const order = staggerOrder(index, count, direction);
  if (stagger === "ripple") {
    const offset = (order - 0.5) * 0.36 * amount * Math.sin(Math.PI * progress);
    return clampProgress(progress + offset);
  }
  const spread = 0.7 * amount;
  const delay = order * spread;
  return clampProgress((progress - delay) / Math.max(0.001, 1 - spread));
}

/**
 * Presence curve for pieces that only exist in one of the segment's poses:
 * entering pieces grow in over the first ~40% of the segment, exiting
 * pieces shrink out over the last ~40%. Smoothstep-shaped.
 */
function presenceAt(localProgress: number, entering: boolean) {
  const phase = entering
    ? clampProgress(localProgress / 0.4)
    : 1 - clampProgress((localProgress - 0.6) / 0.4);
  return phase * phase * (3 - 2 * phase);
}

/**
 * Interpolate all pieces for one segment at an already-eased progress.
 * Stagger is applied per piece on top of the eased progress.
 */
export function interpolateSegment(
  plan: SegmentPlan,
  progress: number,
  stagger: StaggerMode,
  staggerAmount: number,
  staggerDirection: StaggerDirection,
): Placement[] {
  const count = plan.startPlacements.length;
  const placements = plan.startPlacements.map((start, pieceIndex) => {
    const end = plan.endPlacements[pieceIndex];
    const localProgress = pieceProgress(
      progress,
      pieceIndex,
      count,
      stagger,
      staggerAmount,
      staggerDirection,
    );
    const phase = start.phase ?? end.phase;

    let opacity =
      (start.opacity ?? 1) +
      ((end.opacity ?? 1) - (start.opacity ?? 1)) * localProgress;
    let scale =
      (start.scale ?? 1) +
      ((end.scale ?? 1) - (start.scale ?? 1)) * localProgress;

    let x = start.x + (end.x - start.x) * localProgress;
    let y = start.y + (end.y - start.y) * localProgress;
    let angle = interpolateAngle(start.angle, end.angle, localProgress);

    if (phase !== undefined) {
      // Surplus piece: it sits at its own spot (both endpoints share it) and
      // organically grows in or shrinks out there.
      const presence = presenceAt(localProgress, phase === "enter");
      opacity = presence;
      scale = presence;
    }
    if (start.pathProgress !== undefined && end.pathProgress !== undefined) {
      const shape = interpolateShape(plan, clampProgress(localProgress));
      const pathProgress =
        start.pathProgress +
        (end.pathProgress - start.pathProgress) * localProgress;
      const pathOffset =
        (start.pathOffset ?? 0) +
        ((end.pathOffset ?? 0) - (start.pathOffset ?? 0)) * localProgress;
      const pathPoint = pointOnNormalizedPath(
        shape,
        plan.startClosed,
        pathProgress,
      );
      const radians = pathPoint.angle * (Math.PI / 180);
      x = pathPoint.point.x + Math.cos(radians) * pathOffset;
      y = pathPoint.point.y + Math.sin(radians) * pathOffset;
      angle = placementAngle(
        plan.style.orientation,
        pathPoint.angle,
        { x, y },
        centerOf(shape),
        plan.style.layout,
      );
    }

    return {
      x,
      y,
      angle,
      text: start.text,
      index: start.index,
      opacity: clampProgress(opacity),
      scale: Math.max(0.01, scale),
    };
  });

  if (
    plan.style.layout !== "outline" ||
    progress <= 0.001 ||
    progress >= 0.999
  ) {
    return placements;
  }
  return resolveCollisions(placements, plan.style.size, plan.style.gap);
}

export type MotionSegment = {
  from: Keyframe;
  to: Keyframe;
  /** Normalized start/end within the full sequence (wrap segments exceed 1). */
  start: number;
  end: number;
  easing: EasingName;
  plan: SegmentPlan | undefined;
  isWrap: boolean;
};

/**
 * Materialize the segment list for a motion document, including the implicit
 * wrap-around segment in `cycle` mode. `sequenceLength` is the total
 * normalized length (1 for once/pingpong, > 1 when a wrap segment exists).
 */
export function buildSegments(
  motion: MotionDoc,
  tokens: string[],
  style: TextStyle,
  planFor: (
    from: Pose,
    to: Pose,
    tokens: string[],
    style: TextStyle,
  ) => SegmentPlan | undefined = buildSegmentPlan,
): { segments: MotionSegment[]; sequenceLength: number } {
  const keyframes = motion.keyframes;
  const segments: MotionSegment[] = [];
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    segments.push({
      from: keyframes[index],
      to: keyframes[index + 1],
      start: keyframes[index].time,
      end: keyframes[index + 1].time,
      easing: motion.easings[index] ?? "smooth",
      plan: planFor(
        keyframes[index].pose,
        keyframes[index + 1].pose,
        tokens,
        style,
      ),
      isWrap: false,
    });
  }
  let sequenceLength = 1;
  if (motion.loop === "cycle" && keyframes.length > 1) {
    const spans = segments.map((segment) => segment.end - segment.start);
    const wrapSpan = Math.max(
      0.08,
      spans.reduce((sum, span) => sum + span, 0) / Math.max(1, spans.length),
    );
    const last = keyframes[keyframes.length - 1];
    segments.push({
      from: last,
      to: keyframes[0],
      start: last.time,
      end: last.time + wrapSpan,
      easing: motion.easings[segments.length] ?? "smooth",
      plan: planFor(last.pose, keyframes[0].pose, tokens, style),
      isWrap: true,
    });
    sequenceLength = last.time + wrapSpan;
  }
  return { segments, sequenceLength };
}

export type MotionFrame = {
  placements: Placement[];
  shape: Point[];
  closed: boolean;
};

/**
 * Evaluate the whole animation at a global position (0..sequenceLength).
 */
export function evaluateMotion(
  segments: MotionSegment[],
  motion: MotionDoc,
  position: number,
): MotionFrame | undefined {
  if (!segments.length) return undefined;
  const bounded = Math.max(
    segments[0].start,
    Math.min(position, segments[segments.length - 1].end),
  );
  const segment =
    segments.find((item) => bounded <= item.end) ??
    segments[segments.length - 1];
  const span = Math.max(0.0001, segment.end - segment.start);
  const local = clampProgress((bounded - segment.start) / span);
  const eased = ease(segment.easing, local);
  if (!segment.plan) return undefined;
  return {
    placements: interpolateSegment(
      segment.plan,
      eased,
      motion.stagger,
      motion.staggerAmount,
      motion.staggerDirection,
    ),
    shape: interpolateShape(segment.plan, eased),
    closed: segment.plan.startClosed && segment.plan.endClosed,
  };
}

/** Map elapsed seconds to a sequence position, honoring the loop mode. */
export function playbackPosition(
  elapsedSeconds: number,
  motion: MotionDoc,
  sequenceLength: number,
): { position: number; finished: boolean } {
  const duration = Math.max(0.3, motion.duration);
  if (motion.loop === "once") {
    const ratio = Math.min(1, elapsedSeconds / duration);
    return { position: ratio * sequenceLength, finished: ratio >= 1 };
  }
  if (motion.loop === "cycle") {
    const ratio = (elapsedSeconds / duration) % 1;
    return { position: ratio * sequenceLength, finished: false };
  }
  const leg = Math.floor(elapsedSeconds / duration);
  const local = (elapsedSeconds % duration) / duration;
  const ratio = leg % 2 === 0 ? local : 1 - local;
  return { position: ratio * sequenceLength, finished: false };
}
