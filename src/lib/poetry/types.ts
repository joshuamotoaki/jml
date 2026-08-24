export type Point = { x: number; y: number };

export type Layout = "outline" | "fill";
export type Unit = "phrase" | "word" | "letter";
export type Orientation = "follow" | "upright" | "radial";

/** A single drawable state of the shape. */
export type Pose = {
  points: Point[];
  closed: boolean;
};

/** One stop on the timeline. `time` is normalized to [0, 1]. */
export type Keyframe = {
  id: string;
  time: number;
  pose: Pose;
};

export type EasingName = "linear" | "smooth" | "snappy" | "playful" | "bounce";

export type LoopMode = "once" | "pingpong" | "cycle";

export type StaggerMode = "none" | "ripple" | "trail";

export type StaggerDirection = "forward" | "reverse" | "center";

export type MotionTrigger = "automatic" | "hover";

export type MotionDoc = {
  keyframes: Keyframe[];
  /** easings[i] shapes the segment between keyframes[i] and keyframes[i+1]. */
  easings: EasingName[];
  duration: number;
  loop: LoopMode;
  stagger: StaggerMode;
  /** 0..1 — how spread out the stagger is across pieces. */
  staggerAmount: number;
  staggerDirection: StaggerDirection;
  trigger: MotionTrigger;
};

/** A piece of text placed on the canvas. */
export type Placement = Point & {
  text: string;
  angle: number;
  index: number;
  opacity?: number;
  scale?: number;
  pathProgress?: number;
  pathOffset?: number;
  /** Set on pieces that only exist in one of the segment's poses. */
  phase?: "enter" | "exit";
};

export type TextStyle = {
  layout: Layout;
  orientation: Orientation;
  size: number;
  gap: number;
};

/** Precomputed interpolation data for one timeline segment. */
export type SegmentPlan = {
  startShape: Point[];
  endShape: Point[];
  startClosed: boolean;
  endClosed: boolean;
  startPlacements: Placement[];
  endPlacements: Placement[];
  startCapacity: number;
  endCapacity: number;
  style: TextStyle;
};

export type CollisionBox = {
  center: Point;
  halfWidth: number;
  halfHeight: number;
  xAxis: Point;
  yAxis: Point;
};

export const WIDTH = 900;
export const HEIGHT = 650;

let idCounter = 0;

export function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}-${Date.now().toString(36)}`;
}

export function clonePoints(source: Point[]): Point[] {
  return source.map((point) => ({ ...point }));
}

export function clonePose(source: Pose): Pose {
  return { points: clonePoints(source.points), closed: source.closed };
}

export function cloneKeyframe(source: Keyframe): Keyframe {
  return { id: source.id, time: source.time, pose: clonePose(source.pose) };
}

export function cloneMotion(source: MotionDoc): MotionDoc {
  return {
    ...source,
    keyframes: source.keyframes.map(cloneKeyframe),
    easings: [...source.easings],
  };
}

export function clampProgress(value: number) {
  return Math.max(0, Math.min(1, value));
}
