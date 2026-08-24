import { makeHeart } from "./geometry";
import { getTokens } from "./layout";
import {
  buildSegmentPlan,
  buildSegments,
  evaluateMotion,
  playbackPosition,
  type MotionFrame,
} from "./motion";
import { buildPlacements } from "./layout";
import {
  clampProgress,
  cloneKeyframe,
  clonePose,
  nextId,
  type EasingName,
  type Keyframe,
  type Layout,
  type LoopMode,
  type MotionDoc,
  type MotionTrigger,
  type Orientation,
  type Pose,
  type SegmentPlan,
  type StaggerDirection,
  type StaggerMode,
  type TextStyle,
  type Unit,
} from "./types";

export type Tool = "select" | "draw" | "bend" | "warp";

const STORAGE_KEY = "concrete-poetry-document-v2";

type Snapshot = {
  poem: string;
  layout: Layout;
  unit: Unit;
  orientation: Orientation;
  fontSize: number;
  spacing: number;
  fontFamily: string;
  inkColor: string;
  paperColor: string;
  keyframes: Keyframe[];
  easings: EasingName[];
  duration: number;
  loop: LoopMode;
  stagger: StaggerMode;
  staggerAmount: number;
  staggerDirection: StaggerDirection;
  trigger: MotionTrigger;
  selectedKeyframeId: string;
};

function makeKeyframe(pose: Pose, time: number): Keyframe {
  return { id: nextId("kf"), time, pose };
}

function defaultSnapshot(): Snapshot {
  const first = makeKeyframe({ points: makeHeart(), closed: true }, 0);
  return {
    poem: `a bird is a word with wings\na word is a wing with somewhere to go`,
    layout: "outline",
    unit: "word",
    orientation: "follow",
    fontSize: 24,
    spacing: 10,
    fontFamily: "Georgia, serif",
    inkColor: "#242424",
    paperColor: "#f0f0f0",
    keyframes: [first],
    easings: [],
    duration: 2.4,
    loop: "pingpong",
    stagger: "none",
    staggerAmount: 0.5,
    staggerDirection: "forward",
    trigger: "automatic",
    selectedKeyframeId: first.id,
  };
}

export class PoetryEditorState {
  poem = $state(
    `a bird is a word with wings\na word is a wing with somewhere to go`,
  );
  layout = $state<Layout>("outline");
  unit = $state<Unit>("word");
  orientation = $state<Orientation>("follow");
  fontSize = $state(24);
  spacing = $state(10);
  fontFamily = $state("Georgia, serif");
  inkColor = $state("#242424");
  paperColor = $state("#f0f0f0");

  keyframes = $state<Keyframe[]>([
    makeKeyframe({ points: makeHeart(), closed: true }, 0),
  ]);
  easings = $state<EasingName[]>([]);
  duration = $state(2.4);
  loop = $state<LoopMode>("pingpong");
  stagger = $state<StaggerMode>("none");
  staggerAmount = $state(0.5);
  staggerDirection = $state<StaggerDirection>("forward");
  trigger = $state<MotionTrigger>("automatic");

  selectedKeyframeId = $state("");
  playhead = $state(0);
  playing = $state(false);
  tool = $state<Tool>("select");
  showGuide = $state(true);
  showOnion = $state(true);
  reducedMotion = $state(false);

  #frameHandle: number | undefined;
  #playStartWall = 0;
  #playStartPosition = 0;
  #undoStack: Snapshot[] = [];
  #redoStack: Snapshot[] = [];
  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  #planCache = new Map<
    string,
    {
      from: Pose;
      to: Pose;
      tokens: string[];
      styleKey: string;
      plan: SegmentPlan | undefined;
    }
  >();

  constructor() {
    this.selectedKeyframeId = this.keyframes[0].id;
  }

  tokens = $derived.by(() => getTokens(this.poem, this.unit));

  textStyle = $derived.by<TextStyle>(() => ({
    layout: this.layout,
    orientation: this.orientation,
    size: this.fontSize,
    gap: this.spacing,
  }));

  motionDoc = $derived.by<MotionDoc>(() => ({
    keyframes: this.keyframes,
    easings: this.easings,
    duration: this.duration,
    loop: this.loop,
    stagger: this.stagger,
    staggerAmount: this.staggerAmount,
    staggerDirection: this.staggerDirection,
    trigger: this.trigger,
  }));

  animated = $derived.by(() => this.keyframes.length > 1);

  selectedIndex = $derived.by(() =>
    Math.max(
      0,
      this.keyframes.findIndex(
        (keyframe) => keyframe.id === this.selectedKeyframeId,
      ),
    ),
  );

  selectedKeyframe = $derived.by(() => this.keyframes[this.selectedIndex]);

  built = $derived.by(() => {
    if (!this.animated) {
      return { segments: [], sequenceLength: 1 };
    }
    return buildSegments(
      this.motionDoc,
      this.tokens,
      this.textStyle,
      (from, to, tokens, style) => this.#planFor(from, to, tokens, style),
    );
  });

  /** The frame currently shown on canvas. */
  frame = $derived.by<MotionFrame>(() => {
    if (this.animated && this.built.segments.length) {
      const evaluated = evaluateMotion(
        this.built.segments,
        this.motionDoc,
        this.playhead,
      );
      if (evaluated) return evaluated;
    }
    const pose = this.selectedKeyframe.pose;
    return {
      placements: buildPlacements(
        pose.points,
        this.tokens,
        this.layout,
        this.orientation,
        this.fontSize,
        this.spacing,
        pose.closed,
      ),
      shape: pose.points,
      closed: pose.closed,
    };
  });

  /** True when the playhead is parked on the selected keyframe: edit mode. */
  atKeyframe = $derived.by(
    () =>
      !this.playing &&
      (!this.animated ||
        Math.abs(this.playhead - this.selectedKeyframe.time) < 0.0005),
  );

  #planFor(
    from: Pose,
    to: Pose,
    tokens: string[],
    style: TextStyle,
  ): SegmentPlan | undefined {
    const styleKey = `${style.layout}|${style.orientation}|${style.size}|${style.gap}`;
    let entry: { plan: SegmentPlan | undefined } | undefined;
    for (const cached of this.#planCache.values()) {
      if (
        cached.from === from &&
        cached.to === to &&
        cached.tokens === tokens &&
        cached.styleKey === styleKey
      ) {
        entry = cached;
        break;
      }
    }
    if (entry) return entry.plan;
    const plan = buildSegmentPlan(from, to, tokens, style);
    const key = nextId("plan");
    this.#planCache.set(key, { from, to, tokens, styleKey, plan });
    if (this.#planCache.size > 24) {
      const oldest = this.#planCache.keys().next().value;
      if (oldest !== undefined) this.#planCache.delete(oldest);
    }
    return plan;
  }

  // ----- history -------------------------------------------------------

  #snapshot(): Snapshot {
    return {
      poem: this.poem,
      layout: this.layout,
      unit: this.unit,
      orientation: this.orientation,
      fontSize: this.fontSize,
      spacing: this.spacing,
      fontFamily: this.fontFamily,
      inkColor: this.inkColor,
      paperColor: this.paperColor,
      keyframes: this.keyframes.map(cloneKeyframe),
      easings: [...this.easings],
      duration: this.duration,
      loop: this.loop,
      stagger: this.stagger,
      staggerAmount: this.staggerAmount,
      staggerDirection: this.staggerDirection,
      trigger: this.trigger,
      selectedKeyframeId: this.selectedKeyframeId,
    };
  }

  #restore(snapshot: Snapshot) {
    this.poem = snapshot.poem;
    this.layout = snapshot.layout;
    this.unit = snapshot.unit;
    this.orientation = snapshot.orientation;
    this.fontSize = snapshot.fontSize;
    this.spacing = snapshot.spacing;
    this.fontFamily = snapshot.fontFamily;
    this.inkColor = snapshot.inkColor;
    this.paperColor = snapshot.paperColor;
    this.keyframes = snapshot.keyframes.map(cloneKeyframe);
    this.easings = [...snapshot.easings];
    this.duration = snapshot.duration;
    this.loop = snapshot.loop;
    this.stagger = snapshot.stagger;
    this.staggerAmount = snapshot.staggerAmount;
    this.staggerDirection = snapshot.staggerDirection;
    this.trigger = snapshot.trigger;
    this.selectedKeyframeId = snapshot.selectedKeyframeId;
    const selected = this.keyframes.find(
      (keyframe) => keyframe.id === this.selectedKeyframeId,
    );
    if (!selected) this.selectedKeyframeId = this.keyframes[0].id;
    this.playhead = this.selectedKeyframe.time;
    this.pause();
    this.scheduleSave();
  }

  /** Call before a discrete mutation so it can be undone. */
  commit() {
    this.#undoStack.push(this.#snapshot());
    if (this.#undoStack.length > 80) this.#undoStack.shift();
    this.#redoStack = [];
    this.scheduleSave();
  }

  undo() {
    const snapshot = this.#undoStack.pop();
    if (!snapshot) return;
    this.#redoStack.push(this.#snapshot());
    this.#restore(snapshot);
  }

  redo() {
    const snapshot = this.#redoStack.pop();
    if (!snapshot) return;
    this.#undoStack.push(this.#snapshot());
    this.#restore(snapshot);
  }

  /** Return the whole document to its starting state (undoable). */
  reset() {
    this.commit();
    this.#restore(defaultSnapshot());
    this.tool = "select";
  }

  get canUndo() {
    return this.#undoStack.length > 0;
  }

  get canRedo() {
    return this.#redoStack.length > 0;
  }

  // ----- persistence ---------------------------------------------------

  scheduleSave() {
    if (typeof localStorage === "undefined") return;
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#snapshot()));
      } catch {
        // Storage may be full or blocked; autosave is best-effort.
      }
    }, 600);
  }

  loadSaved() {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Snapshot;
      if (
        !parsed ||
        !Array.isArray(parsed.keyframes) ||
        !parsed.keyframes.length ||
        parsed.keyframes.some(
          (keyframe) =>
            !keyframe?.pose ||
            !Array.isArray(keyframe.pose.points) ||
            typeof keyframe.time !== "number",
        )
      ) {
        return;
      }
      this.#restore(parsed);
    } catch {
      // Ignore corrupted saves; start fresh.
    }
  }

  // ----- playback ------------------------------------------------------

  #tick = (timestamp: number) => {
    if (!this.playing) return;
    const elapsed =
      (timestamp - this.#playStartWall) / 1000 +
      (this.#playStartPosition / Math.max(0.0001, this.built.sequenceLength)) *
        this.duration;
    const { position, finished } = playbackPosition(
      elapsed,
      this.motionDoc,
      this.built.sequenceLength,
    );
    this.playhead = position;
    if (finished) {
      this.playing = false;
      this.#frameHandle = undefined;
      return;
    }
    this.#frameHandle = requestAnimationFrame(this.#tick);
  };

  play() {
    if (!this.animated) return;
    const atEnd =
      this.loop === "once" &&
      this.playhead >= this.built.sequenceLength - 0.0005;
    this.#playStartPosition = atEnd
      ? 0
      : clampProgress(this.playhead / this.built.sequenceLength) *
        this.built.sequenceLength;
    this.#playStartWall = performance.now();
    this.playing = true;
    if (this.#frameHandle !== undefined)
      cancelAnimationFrame(this.#frameHandle);
    this.#frameHandle = requestAnimationFrame(this.#tick);
  }

  pause() {
    this.playing = false;
    if (this.#frameHandle !== undefined) {
      cancelAnimationFrame(this.#frameHandle);
      this.#frameHandle = undefined;
    }
  }

  togglePlayback() {
    if (this.playing) this.pause();
    else this.play();
  }

  scrub(position: number) {
    this.pause();
    this.playhead = Math.max(0, Math.min(position, this.built.sequenceLength));
  }

  // ----- keyframes -----------------------------------------------------

  selectKeyframe(id: string) {
    const keyframe = this.keyframes.find((item) => item.id === id);
    if (!keyframe) return;
    this.pause();
    this.selectedKeyframeId = id;
    this.playhead = keyframe.time;
  }

  selectKeyframeAt(index: number) {
    const bounded = Math.max(0, Math.min(index, this.keyframes.length - 1));
    this.selectKeyframe(this.keyframes[bounded].id);
  }

  /** Replace the selected keyframe's pose (immutably). */
  updateSelectedPose(
    update: (pose: Pose) => Pose,
    options?: { commit?: boolean },
  ) {
    if (options?.commit !== false) this.commit();
    const index = this.selectedIndex;
    const current = this.keyframes[index];
    const pose = update(current.pose);
    const next = [...this.keyframes];
    next[index] = { ...current, pose };
    this.keyframes = next;
  }

  /** Live variant for drags: no history entry, caller commits on pointerdown. */
  setSelectedPose(pose: Pose) {
    const index = this.selectedIndex;
    const next = [...this.keyframes];
    next[index] = { ...next[index], pose };
    this.keyframes = next;
    this.scheduleSave();
  }

  addKeyframe() {
    this.commit();
    const count = this.keyframes.length;
    if (count === 1) {
      const first = this.keyframes[0];
      const second = makeKeyframe(clonePose(first.pose), 1);
      this.keyframes = [{ ...first, time: 0 }, second];
      this.easings = ["smooth"];
      this.selectKeyframe(second.id);
      return;
    }
    const source = this.selectedKeyframe;
    const sourceIndex = this.selectedIndex;
    const isLast = sourceIndex === count - 1;
    if (isLast) {
      const scale = count > 1 ? (count - 1) / count : 1;
      const rescaled = this.keyframes.map((keyframe) => ({
        ...keyframe,
        time: keyframe.time * scale,
      }));
      const added = makeKeyframe(clonePose(source.pose), 1);
      this.keyframes = [...rescaled, added];
      this.easings = [...this.easings, this.easings.at(-1) ?? "smooth"];
      this.selectKeyframe(added.id);
    } else {
      const next = this.keyframes[sourceIndex + 1];
      const added = makeKeyframe(
        clonePose(source.pose),
        (source.time + next.time) / 2,
      );
      const keyframes = [...this.keyframes];
      keyframes.splice(sourceIndex + 1, 0, added);
      this.keyframes = keyframes;
      const easings = [...this.easings];
      easings.splice(sourceIndex + 1, 0, easings[sourceIndex] ?? "smooth");
      this.easings = easings;
      this.selectKeyframe(added.id);
    }
  }

  deleteKeyframe(id: string) {
    if (this.keyframes.length <= 1) return;
    const index = this.keyframes.findIndex((keyframe) => keyframe.id === id);
    if (index < 0) return;
    this.commit();
    const keyframes = this.keyframes.filter((keyframe) => keyframe.id !== id);
    const easings = [...this.easings];
    easings.splice(
      Math.max(0, index - (index === this.easings.length ? 1 : 0)),
      1,
    );
    if (keyframes.length === 1) {
      keyframes[0] = { ...keyframes[0], time: 0 };
      this.easings = [];
    } else {
      // Keep endpoints pinned to 0 and 1.
      const first = keyframes[0];
      const last = keyframes[keyframes.length - 1];
      const span = Math.max(0.0001, last.time - first.time);
      this.keyframes = keyframes.map((keyframe) => ({
        ...keyframe,
        time: (keyframe.time - first.time) / span,
      }));
      this.easings = easings;
      this.selectKeyframeAt(Math.min(index, keyframes.length - 1));
      return;
    }
    this.keyframes = keyframes;
    this.selectKeyframeAt(0);
    this.playhead = 0;
  }

  removeMotion() {
    if (!this.animated) return;
    this.commit();
    const keeper = { ...this.selectedKeyframe, time: 0 };
    this.keyframes = [keeper];
    this.easings = [];
    this.playhead = 0;
    this.pause();
  }

  moveKeyframe(id: string, time: number) {
    const index = this.keyframes.findIndex((keyframe) => keyframe.id === id);
    if (index <= 0 || index >= this.keyframes.length - 1) return;
    const previous = this.keyframes[index - 1];
    const next = this.keyframes[index + 1];
    const bounded = Math.max(
      previous.time + 0.02,
      Math.min(time, next.time - 0.02),
    );
    const keyframes = [...this.keyframes];
    keyframes[index] = { ...keyframes[index], time: bounded };
    this.keyframes = keyframes;
    this.scheduleSave();
  }

  setEasing(segmentIndex: number, easing: EasingName) {
    this.commit();
    const easings = [...this.easings];
    while (easings.length <= segmentIndex) easings.push("smooth");
    easings[segmentIndex] = easing;
    this.easings = easings;
  }
}

export const editor = new PoetryEditorState();
