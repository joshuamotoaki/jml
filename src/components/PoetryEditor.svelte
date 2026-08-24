<script lang="ts">
  import { contours } from "d3-contour";
  import { onDestroy, onMount, tick } from "svelte";
  import { automaticMaskFromPixels } from "../lib/poetry-image-mask";

  type Point = { x: number; y: number };
  type Layout = "outline" | "fill";
  type Unit = "phrase" | "word" | "letter";
  type Orientation = "follow" | "upright" | "radial";
  type SelectMenu = "orientation" | "font";
  type Placement = Point & {
    text: string;
    angle: number;
    index: number;
    opacity?: number;
    scale?: number;
    pathProgress?: number;
    pathOffset?: number;
    reveal?: number;
    revealEdge?: "start" | "end";
  };
  type MotionType = "morph" | "bend";
  type MotionPoseName = "start" | "end";
  type MotionFeel = "smooth" | "playful" | "snappy";
  type LetterMotion = "attached" | "ripple";
  type MotionTrigger = "automatic" | "hover";
  type MotionCountMode = "fit" | "enter-exit";
  type MotionPose = { points: Point[]; closed: boolean };
  type MotionPlan = {
    startShape: Point[];
    endShape: Point[];
    startClosed: boolean;
    endClosed: boolean;
    layout: Layout;
    orientation: Orientation;
    size: number;
    gap: number;
    countMode: MotionCountMode;
    startCapacity: number;
    endCapacity: number;
    startPlacements: Placement[];
    endPlacements: Placement[];
  };
  type BendStep = "idle" | "select" | "pivot" | "pose" | "done";
  type CollisionBox = {
    center: Point;
    halfWidth: number;
    halfHeight: number;
    xAxis: Point;
    yAxis: Point;
  };
  type SelectionTool = "keep" | "remove";
  type SelectionMethod = "none" | "alpha" | "background" | "ai";
  type SelectionStroke = {
    brushMode: 1 | 2 | 3;
    point: Point[];
    isCompleted: boolean;
  };

  const WIDTH = 900;
  const HEIGHT = 650;

  const layouts: { value: Layout; label: string; mark: string }[] = [
    { value: "outline", label: "Outline", mark: "○" },
    { value: "fill", label: "Fill", mark: "●" },
  ];

  const units: { value: Unit; label: string }[] = [
    { value: "phrase", label: "Phrase" },
    { value: "word", label: "Words" },
    { value: "letter", label: "Letters" },
  ];

  const orientations: { value: Orientation; label: string }[] = [
    { value: "follow", label: "Follow shape" },
    { value: "upright", label: "Stay upright" },
    { value: "radial", label: "Face outward" },
  ];

  const typefaces = [
    { value: "Georgia, serif", label: "Georgia" },
    { value: '"Times New Roman", Times, serif', label: "Times" },
    { value: "Arial, sans-serif", label: "Arial" },
    { value: '"Courier New", monospace', label: "Monospace" },
  ];

  let poem = `a bird is a word with wings\na word is a wing with somewhere to go`;
  let layout: Layout = "outline";
  let unit: Unit = "word";
  let orientation: Orientation = "follow";
  let fontSize = 24;
  let spacing = 10;
  let inkColor = "#242424";
  let paperColor = "#f0f0f0";
  let fontFamily = "Georgia, serif";
  let closePath = true;
  let showGuide = true;
  let drawing = false;
  let isPointerDown = false;
  let points: Point[] = makeHeart();
  let previousPoints: Point[] = [];
  let svgElement: SVGSVGElement;
  let notice = "";
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let imageToolOpen = false;
  let imageUrl = "";
  let imageName = "";
  let imageWidth = 0;
  let imageHeight = 0;
  let imageInputElement: HTMLInputElement;
  let selectionCanvasElement: HTMLCanvasElement;
  let segmenterWorker: Worker | undefined;
  let pendingBitmap: ImageBitmap | undefined;
  let segmenterReady = false;
  let segmenterImageReady = false;
  let segmenterBusy = false;
  let imageImporting = false;
  let selectionStatus = "Upload an image to begin.";
  let selectionError = "";
  let selectionTool: SelectionTool = "keep";
  let selectionStrokes: SelectionStroke[] = [];
  let activeSelectionStroke: Point[] = [];
  let selectionPointerDown = false;
  let selectionMask: Float32Array | undefined;
  let automaticSelectionMask: Float32Array | undefined;
  let automaticSelectionMethod: "alpha" | "background" | undefined;
  let selectionMethod: SelectionMethod = "none";
  let selectionMaskWidth = 0;
  let selectionMaskHeight = 0;
  let selectionThreshold = 0.5;
  let selectionDetail = 8;
  let selectionSmoothness = 0;
  let openSelect: SelectMenu | null = null;
  let motionEnabled = false;
  let motionType: MotionType = "morph";
  let editingMotionPose: MotionPoseName = "start";
  let motionStartPose: MotionPose = { points: [], closed: true };
  let motionEndPose: MotionPose = { points: [], closed: true };
  let motionFeel: MotionFeel = "smooth";
  let letterMotion: LetterMotion = "attached";
  let motionTrigger: MotionTrigger = "automatic";
  let motionCountMode: MotionCountMode = "fit";
  let motionDuration = 2.4;
  let motionLoop = true;
  let motionProgress = 0;
  let motionPlaying = false;
  let motionPreviewing = false;
  let motionFrame: number | undefined;
  let motionStartedAt = 0;
  let reducedMotion = false;
  let reducedMotionQuery: MediaQueryList | undefined;
  let bendStep: BendStep = "idle";
  let bendLasso: Point[] = [];
  let bendLassoPointerDown = false;
  let bendPivot: Point | undefined;
  let bendWeights: number[] = [];
  let bendPosePointerDown = false;
  let bendPoseStartAngle = 0;
  let bendPoseAngle = 0;

  $: tokens = getTokens(poem, unit);
  $: placements = buildPlacements(
    points,
    tokens,
    layout,
    orientation,
    fontSize,
    spacing,
    closePath,
  );
  $: pathData = pointsToPath(points, closePath);
  $: motionPlan = motionEnabled
    ? buildMotionPlan(
        editingMotionPose === "start"
          ? { points, closed: closePath }
          : motionStartPose,
        editingMotionPose === "end"
          ? { points, closed: closePath }
          : motionEndPose,
        tokens,
        layout,
        orientation,
        fontSize,
        spacing,
        motionType,
        motionCountMode,
      )
    : undefined;
  $: renderedPlacements =
    motionPlan && motionEnabled
      ? motionPreviewing
        ? interpolateMotionPlacements(
            motionPlan,
            motionProgress,
            motionFeel,
            letterMotion,
          )
        : (editingMotionPose === "start"
            ? motionPlan.startPlacements
            : motionPlan.endPlacements
          ).map((placement) => ({ ...placement }))
      : placements;
  $: renderedShapePoints =
    motionPreviewing && motionPlan
      ? interpolateMotionShape(
          motionPlan,
          easedMotionProgress(motionProgress, motionFeel),
        )
      : points;
  $: renderedPathData =
    motionPreviewing && motionPlan
      ? pointsToPath(
          renderedShapePoints,
          motionPlan.startClosed && motionPlan.endClosed,
        )
      : pathData;
  $: characterCount = Array.from(poem).length;
  $: importedMaskContour = selectionMask
    ? contourFromMask(
        selectionMask,
        selectionMaskWidth,
        selectionMaskHeight,
        selectionThreshold,
      )
    : [];
  $: importedShapePreview = fitImportedContour(
    importedMaskContour,
    selectionDetail,
    selectionSmoothness,
  );
  $: importedShapePath = pointsToPath(importedShapePreview, true);
  $: {
    selectionMask;
    selectionThreshold;
    selectionStrokes;
    activeSelectionStroke;
    if (selectionCanvasElement) drawSelectionOverlay();
  }

  function getTokens(value: string, selectedUnit: Unit) {
    const cleaned = value.replace(/\s+/g, " ").trim() || "word";
    if (selectedUnit === "letter")
      return Array.from(cleaned.replace(/ /g, "·"));
    if (selectedUnit === "word") return cleaned.split(" ").filter(Boolean);
    return value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function placementCountLabel(count: number, selectedUnit: Unit) {
    const label =
      selectedUnit === "phrase"
        ? "phrase"
        : selectedUnit === "word"
          ? "word"
          : "letter";
    return `${count} ${label}${count === 1 ? "" : "s"}`;
  }

  function motionCapacityMessage(plan: MotionPlan) {
    if (plan.startCapacity === plan.endCapacity) return "";
    if (plan.countMode === "enter-exit") {
      return `Pose A: ${placementCountLabel(plan.startCapacity, unit)} · Pose B: ${placementCountLabel(plan.endCapacity, unit)}. Surplus pieces travel through the outline’s end.`;
    }
    const limitingPose =
      plan.startCapacity < plan.endCapacity ? "Pose A" : "Pose B";
    return `${limitingPose} limits this motion to ${placementCountLabel(Math.min(plan.startCapacity, plan.endCapacity), unit)}.`;
  }

  function motionPoseCount(plan: MotionPlan, pose: MotionPoseName) {
    if (plan.countMode === "fit") {
      return Math.min(plan.startCapacity, plan.endCapacity);
    }
    return pose === "start" ? plan.startCapacity : plan.endCapacity;
  }

  function selectOptions(menu: SelectMenu) {
    return menu === "orientation" ? orientations : typefaces;
  }

  function selectedOptionIndex(menu: SelectMenu) {
    const value = menu === "orientation" ? orientation : fontFamily;
    return Math.max(
      0,
      selectOptions(menu).findIndex((option) => option.value === value),
    );
  }

  function selectedOptionLabel(menu: SelectMenu) {
    return selectOptions(menu)[selectedOptionIndex(menu)]?.label ?? "Choose";
  }

  function focusSelectOption(menu: SelectMenu, index: number) {
    const options = selectOptions(menu);
    const wrappedIndex = (index + options.length) % options.length;
    document
      .getElementById(`${menu}-option-${wrappedIndex}`)
      ?.focus({ preventScroll: true });
  }

  async function openSelectFromKeyboard(menu: SelectMenu, offset = 0) {
    openSelect = menu;
    await tick();
    focusSelectOption(menu, selectedOptionIndex(menu) + offset);
  }

  function toggleSelect(menu: SelectMenu) {
    openSelect = openSelect === menu ? null : menu;
  }

  async function chooseSelectOption(menu: SelectMenu, value: string) {
    if (menu === "orientation") orientation = value as Orientation;
    else fontFamily = value;
    openSelect = null;
    await tick();
    document.getElementById(`${menu}-trigger`)?.focus({ preventScroll: true });
  }

  function handleSelectTriggerKeydown(event: KeyboardEvent, menu: SelectMenu) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openSelectFromKeyboard(menu, event.key === "ArrowDown" ? 0 : -1);
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      openSelect = menu;
      tick().then(() =>
        focusSelectOption(
          menu,
          event.key === "Home" ? 0 : selectOptions(menu).length - 1,
        ),
      );
    }
    if (event.key === "Tab") openSelect = null;
  }

  function handleSelectOptionKeydown(
    event: KeyboardEvent,
    menu: SelectMenu,
    index: number,
  ) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSelectOption(menu, index + (event.key === "ArrowDown" ? 1 : -1));
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusSelectOption(
        menu,
        event.key === "Home" ? 0 : selectOptions(menu).length - 1,
      );
    }
    if (event.key === "Tab") openSelect = null;
  }

  function handleSelectFocusOut(event: FocusEvent, menu: SelectMenu) {
    const container = event.currentTarget as HTMLElement;
    if (
      openSelect === menu &&
      (!event.relatedTarget || !container.contains(event.relatedTarget as Node))
    ) {
      openSelect = null;
    }
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (
      openSelect &&
      (!(event.target instanceof Element) ||
        !event.target.closest(".custom-select"))
    ) {
      openSelect = null;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (openSelect) {
      const menu = openSelect;
      openSelect = null;
      tick().then(() =>
        document
          .getElementById(`${menu}-trigger`)
          ?.focus({ preventScroll: true }),
      );
      return;
    }
    if (motionPlaying || motionPreviewing) {
      stopMotionPlayback();
      return;
    }
    if (
      motionEnabled &&
      motionType === "bend" &&
      bendStep !== "idle" &&
      bendStep !== "done"
    ) {
      removeMotion();
    }
  }

  function makeCircle(): Point[] {
    return Array.from({ length: 128 }, (_, index) => {
      const angle = (index / 128) * Math.PI * 2 - Math.PI / 2;
      return { x: 450 + Math.cos(angle) * 225, y: 325 + Math.sin(angle) * 225 };
    });
  }

  function makeHeart(): Point[] {
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

  function snapshotCurrentPose(): MotionPose {
    return { points: clonePoints(points), closed: closePath };
  }

  function saveActiveMotionPose() {
    if (!motionEnabled) return;
    const pose = snapshotCurrentPose();
    if (editingMotionPose === "start") motionStartPose = pose;
    else motionEndPose = pose;
  }

  function cancelMotionFrame() {
    if (motionFrame !== undefined) cancelAnimationFrame(motionFrame);
    motionFrame = undefined;
  }

  function stopMotionPlayback(restoreEditor = true) {
    cancelMotionFrame();
    motionPlaying = false;
    if (restoreEditor) {
      motionPreviewing = false;
      motionProgress = editingMotionPose === "start" ? 0 : 1;
    }
  }

  function motionPlaybackFrame(timestamp: number) {
    if (!motionPlaying) return;
    if (!motionStartedAt) motionStartedAt = timestamp;
    const elapsed = Math.max(0, timestamp - motionStartedAt);
    const legDuration = Math.max(300, motionDuration * 1000);
    if (motionLoop) {
      const leg = Math.floor(elapsed / legDuration);
      const local = (elapsed % legDuration) / legDuration;
      motionProgress = leg % 2 === 0 ? local : 1 - local;
      motionFrame = requestAnimationFrame(motionPlaybackFrame);
      return;
    }
    motionProgress = Math.min(1, elapsed / legDuration);
    if (motionProgress >= 1) {
      motionPlaying = false;
      motionFrame = undefined;
      return;
    }
    motionFrame = requestAnimationFrame(motionPlaybackFrame);
  }

  function playMotion() {
    saveActiveMotionPose();
    if (!motionPlan) {
      announce("Make both poses before previewing motion");
      return;
    }
    cancelMotionFrame();
    motionProgress = 0;
    motionPreviewing = true;
    motionPlaying = true;
    motionStartedAt = 0;
    motionFrame = requestAnimationFrame(motionPlaybackFrame);
  }

  function pauseMotion() {
    cancelMotionFrame();
    motionPlaying = false;
    motionPreviewing = true;
  }

  function scrubMotion(value: number) {
    pauseMotion();
    motionProgress = clampProgress(value);
  }

  function setMotionCountMode(mode: MotionCountMode) {
    stopMotionPlayback();
    motionCountMode = mode;
    announce(
      mode === "fit"
        ? "Both poses now use one shared text count"
        : "Surplus text will travel through the outline’s end",
    );
  }

  function selectMotionPose(name: MotionPoseName) {
    stopMotionPlayback(false);
    saveActiveMotionPose();
    editingMotionPose = name;
    const pose = name === "start" ? motionStartPose : motionEndPose;
    points = clonePoints(pose.points);
    closePath = pose.closed;
    previousPoints = [];
    motionPreviewing = false;
    motionProgress = name === "start" ? 0 : 1;
    drawing = false;
  }

  function enableMotion(kind: MotionType) {
    stopMotionPlayback();
    const pose = snapshotCurrentPose();
    motionEnabled = true;
    motionType = kind;
    motionStartPose = clonePose(pose);
    motionEndPose = clonePose(pose);
    editingMotionPose = "end";
    points = clonePoints(pose.points);
    closePath = pose.closed;
    previousPoints = [];
    drawing = false;
    bendLasso = [];
    bendPivot = undefined;
    bendWeights = [];
    bendPoseAngle = 0;
    bendStep = kind === "bend" ? "select" : "idle";
    announce(
      kind === "bend"
        ? "Draw around the part that should move"
        : "Pose B is ready — choose or draw its ending shape",
    );
  }

  function removeMotion() {
    stopMotionPlayback();
    saveActiveMotionPose();
    motionEnabled = false;
    bendStep = "idle";
    bendLasso = [];
    bendPivot = undefined;
    announce("Motion removed");
  }

  function restartBendSetup() {
    stopMotionPlayback(false);
    motionEndPose = clonePose(motionStartPose);
    editingMotionPose = "end";
    points = clonePoints(motionEndPose.points);
    closePath = motionEndPose.closed;
    bendLasso = [];
    bendPivot = undefined;
    bendWeights = [];
    bendPoseAngle = 0;
    bendStep = "select";
    motionPreviewing = false;
    announce("Draw around the part that should move");
  }

  function swapMotionPoses() {
    stopMotionPlayback(false);
    saveActiveMotionPose();
    const start = clonePose(motionStartPose);
    motionStartPose = clonePose(motionEndPose);
    motionEndPose = start;
    editingMotionPose = editingMotionPose === "start" ? "end" : "start";
    const active =
      editingMotionPose === "start" ? motionStartPose : motionEndPose;
    points = clonePoints(active.points);
    closePath = active.closed;
    motionPreviewing = false;
    motionProgress = editingMotionPose === "start" ? 0 : 1;
  }

  function syncShapeToMotion() {
    saveActiveMotionPose();
    if (motionType === "bend" && bendStep === "done") bendStep = "idle";
  }

  function applyPreset(name: "circle" | "heart") {
    stopMotionPlayback();
    previousPoints = points;
    drawing = false;
    if (name === "circle") points = makeCircle();
    if (name === "heart") points = makeHeart();
    closePath = true;
    syncShapeToMotion();
  }

  function distance(a: Point, b: Point) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function getSegments(source: Point[], closed: boolean) {
    if (source.length < 2) return [];
    const segments: {
      start: Point;
      end: Point;
      length: number;
      offset: number;
    }[] = [];
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

  function pointOnPath(
    segments: ReturnType<typeof getSegments>,
    target: number,
  ) {
    if (!segments.length)
      return { point: { x: WIDTH / 2, y: HEIGHT / 2 }, angle: 0 };
    const total =
      segments[segments.length - 1].offset +
      segments[segments.length - 1].length;
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

  function clonePoints(source: Point[]) {
    return source.map((point) => ({ ...point }));
  }

  function clonePose(source: MotionPose): MotionPose {
    return { points: clonePoints(source.points), closed: source.closed };
  }

  function resamplePath(source: Point[], closed: boolean, count: number) {
    if (source.length < 2 || count < 2) return clonePoints(source);
    const segments = getSegments(source, closed);
    if (!segments.length) return clonePoints(source);
    const total =
      segments[segments.length - 1].offset +
      segments[segments.length - 1].length;
    const divisor = closed ? count : Math.max(1, count - 1);
    return Array.from(
      { length: count },
      (_, index) => pointOnPath(segments, (total * index) / divisor).point,
    );
  }

  function rotatePointList(source: Point[], offset: number) {
    const bounded = ((offset % source.length) + source.length) % source.length;
    return [...source.slice(bounded), ...source.slice(0, bounded)];
  }

  function pointListCost(a: Point[], b: Point[]) {
    let cost = 0;
    const step = Math.max(1, Math.floor(a.length / 48));
    for (let index = 0; index < a.length; index += step) {
      const dx = a[index].x - b[index].x;
      const dy = a[index].y - b[index].y;
      cost += dx * dx + dy * dy;
    }
    return cost;
  }

  function bestCyclicMatch(fixed: Point[], movable: Point[]) {
    let best = movable;
    let bestCost = Number.POSITIVE_INFINITY;
    const variants = [movable, [...movable].reverse()];
    for (const variant of variants) {
      for (let offset = 0; offset < variant.length; offset += 1) {
        const candidate = rotatePointList(variant, offset);
        const cost = pointListCost(fixed, candidate);
        if (cost < bestCost) {
          best = candidate;
          bestCost = cost;
        }
      }
    }
    return best;
  }

  function alignedMotionShapes(
    start: MotionPose,
    end: MotionPose,
    motionKind: MotionType,
  ) {
    const sampleCount = 180;
    let startShape = resamplePath(start.points, start.closed, sampleCount);
    let endShape = resamplePath(end.points, end.closed, sampleCount);
    if (
      motionKind === "bend" ||
      startShape.length !== sampleCount ||
      endShape.length !== sampleCount
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

  function posesAreEquivalent(start: MotionPose, end: MotionPose) {
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

  function samplePlacementsEvenly(source: Placement[], count: number) {
    if (count >= source.length)
      return source.map((placement) => ({ ...placement }));
    if (count <= 1) return source.length ? [{ ...source[0] }] : [];
    return Array.from({ length: count }, (_, index) => ({
      ...source[Math.round((index * (source.length - 1)) / (count - 1))],
    }));
  }

  function evenlySpacedPlacementIndexes(length: number, count: number) {
    if (count >= length) return Array.from({ length }, (_, index) => index);
    if (count <= 1) return length ? [0] : [];
    return Array.from({ length: count }, (_, index) =>
      Math.round((index * (length - 1)) / (count - 1)),
    );
  }

  function pathProgressForPoint(
    source: Point[],
    closed: boolean,
    target: Point,
  ) {
    const segments = getSegments(source, closed);
    if (!segments.length) return 0;
    const total =
      segments[segments.length - 1].offset +
      segments[segments.length - 1].length;
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

  function pointOnNormalizedPath(
    source: Point[],
    closed: boolean,
    progress: number,
  ) {
    const segments = getSegments(source, closed);
    const total = segments.length
      ? segments[segments.length - 1].offset +
        segments[segments.length - 1].length
      : 0;
    return pointOnPath(segments, total * clampProgress(progress));
  }

  function queuedPlacement(
    shape: Point[],
    closed: boolean,
    template: Placement,
    progress: number,
    offset: number,
    selectedOrientation: Orientation,
    selectedLayout: Layout,
  ): Placement {
    const pathPoint = pointOnNormalizedPath(shape, closed, progress);
    const radians = pathPoint.angle * (Math.PI / 180);
    const point = {
      x: pathPoint.point.x + Math.cos(radians) * offset,
      y: pathPoint.point.y + Math.sin(radians) * offset,
    };
    return {
      ...template,
      ...point,
      angle: placementAngle(
        selectedOrientation,
        pathPoint.angle,
        point,
        centerOf(shape),
        selectedLayout,
      ),
      opacity: 1,
      scale: 1,
      pathProgress: progress,
      pathOffset: offset,
    };
  }

  function visiblePlacementCount(source: Placement[]) {
    return source.reduce(
      (count, placement) => count + ((placement.opacity ?? 1) > 0.5 ? 1 : 0),
      0,
    );
  }

  function spatiallyMatchPlacements(start: Placement[], end: Placement[]) {
    if (!start.length || start.length !== end.length) return end;
    const hilbertOrder = 1024;
    const hilbertIndex = (point: Point) => {
      let x = Math.max(
        0,
        Math.min(hilbertOrder - 1, Math.round((point.x / WIDTH) * 1023)),
      );
      let y = Math.max(
        0,
        Math.min(hilbertOrder - 1, Math.round((point.y / HEIGHT) * 1023)),
      );
      let index = 0;
      for (
        let scale = hilbertOrder / 2;
        scale > 0;
        scale = Math.floor(scale / 2)
      ) {
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
    };
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

  // Every plan uses one stable roster. Enter/exit keeps the larger roster and
  // gives each surplus piece a full-size endpoint beyond its nearest edge.
  function buildMotionPlan(
    start: MotionPose,
    end: MotionPose,
    sourceTokens: string[],
    selectedLayout: Layout,
    selectedOrientation: Orientation,
    size: number,
    gap: number,
    motionKind: MotionType,
    countMode: MotionCountMode,
  ): MotionPlan | undefined {
    if (
      start.points.length < 2 ||
      end.points.length < 2 ||
      !sourceTokens.length
    ) {
      return undefined;
    }
    if (posesAreEquivalent(start, end)) {
      const shape = resamplePath(start.points, start.closed, 180);
      const staticPlacements = buildPlacements(
        start.points,
        sourceTokens,
        selectedLayout,
        selectedOrientation,
        size,
        gap,
        start.closed,
      );
      return {
        startShape: shape,
        endShape: clonePoints(shape),
        startClosed: start.closed,
        endClosed: end.closed,
        layout: selectedLayout,
        orientation: selectedOrientation,
        size,
        gap,
        countMode,
        startCapacity: staticPlacements.length,
        endCapacity: staticPlacements.length,
        startPlacements: staticPlacements.map((placement) => ({
          ...placement,
          opacity: 1,
          scale: 1,
        })),
        endPlacements: staticPlacements.map((placement) => ({
          ...placement,
          opacity: 1,
          scale: 1,
        })),
      };
    }
    const { startShape, endShape } = alignedMotionShapes(
      start,
      end,
      motionKind,
    );
    const rawStart = buildPlacements(
      startShape,
      sourceTokens,
      selectedLayout,
      selectedOrientation,
      size,
      gap,
      start.closed,
    );
    const rawEnd = buildPlacements(
      endShape,
      sourceTokens,
      selectedLayout,
      selectedOrientation,
      size,
      gap,
      end.closed,
    );
    const count = Math.min(rawStart.length, rawEnd.length);
    if (!count) return undefined;
    const followContour =
      selectedLayout === "outline" && start.closed === end.closed;

    let startPlacements: Placement[];
    let endPlacements: Placement[];
    if (countMode === "fit" || rawStart.length === rawEnd.length) {
      if (selectedLayout === "outline") {
        if (rawStart.length <= rawEnd.length) {
          startPlacements = rawStart.map((placement, index) => ({
            ...placement,
            index,
            opacity: 1,
            scale: 1,
          }));
          endPlacements = samplePlacementsEvenly(rawEnd, count).map(
            (placement, index) => ({
              ...placement,
              text: startPlacements[index].text,
              index,
              opacity: 1,
              scale: 1,
            }),
          );
        } else {
          endPlacements = rawEnd.map((placement, index) => ({
            ...placement,
            index,
            opacity: 1,
            scale: 1,
          }));
          startPlacements = samplePlacementsEvenly(rawStart, count).map(
            (placement, index) => ({
              ...placement,
              text: endPlacements[index].text,
              index,
              opacity: 1,
              scale: 1,
            }),
          );
        }
      } else {
        startPlacements = samplePlacementsEvenly(rawStart, count).map(
          (placement, index) => ({
            ...placement,
            text: sourceTokens[index % sourceTokens.length],
            index,
            opacity: 1,
            scale: 1,
          }),
        );
        const sampledEnd = samplePlacementsEvenly(rawEnd, count).map(
          (placement, index) => ({
            ...placement,
            text: sourceTokens[index % sourceTokens.length],
            index,
            opacity: 1,
            scale: 1,
          }),
        );
        endPlacements = spatiallyMatchPlacements(startPlacements, sampledEnd);
      }
    } else if (rawStart.length < rawEnd.length) {
      const selectedEndIndexes = evenlySpacedPlacementIndexes(
        rawEnd.length,
        count,
      );
      const selectedEnd = selectedEndIndexes.map((index) => rawEnd[index]);
      startPlacements = rawStart.map((placement, index) => ({
        ...placement,
        index,
        opacity: 1,
        scale: 1,
      }));
      endPlacements = (
        selectedLayout === "outline"
          ? selectedEnd
          : spatiallyMatchPlacements(startPlacements, selectedEnd)
      ).map((placement, index) => ({
        ...placement,
        text: startPlacements[index].text,
        index,
        opacity: 1,
        scale: 1,
      }));

      const selected = new Set(selectedEndIndexes);
      const extraEndPlacements = rawEnd
        .map((placement, rawIndex) => ({
          placement,
          rawIndex,
          progress: pathProgressForPoint(endShape, end.closed, placement),
        }))
        .filter(({ rawIndex }) => !selected.has(rawIndex));
      if (followContour) {
        extraEndPlacements.sort((a, b) =>
          start.closed ? a.progress - b.progress : b.progress - a.progress,
        );
      }
      let queueDistance = size + gap;
      extraEndPlacements.forEach(({ placement, progress }) => {
        const index = startPlacements.length;
        const text = placement.text;
        const width = tokenWidth(text, size);
        queueDistance += width / 2;
        const queueProgress = start.closed ? 0 : 1;
        const queueOffset = (start.closed ? -1 : 1) * queueDistance;
        const revealEdge = start.closed ? "end" : "start";
        const queued = queuedPlacement(
          startShape,
          start.closed,
          placement,
          queueProgress,
          queueOffset,
          selectedOrientation,
          selectedLayout,
        );
        startPlacements.push({
          ...queued,
          text,
          index,
          opacity: 1,
          scale: 1,
          pathProgress: followContour ? queueProgress : undefined,
          pathOffset: followContour ? queueOffset : undefined,
          reveal: 0,
          revealEdge,
        });
        endPlacements.push({
          ...placement,
          text,
          index,
          opacity: 1,
          scale: 1,
          pathProgress: followContour ? progress : undefined,
          pathOffset: followContour ? 0 : undefined,
          reveal: 1,
          revealEdge,
        });
        queueDistance += width / 2 + gap;
      });
    } else {
      const selectedStartIndexes = evenlySpacedPlacementIndexes(
        rawStart.length,
        count,
      );
      const selectedStart = selectedStartIndexes.map(
        (index) => rawStart[index],
      );
      startPlacements = selectedStart.map((placement, index) => ({
        ...placement,
        index,
        opacity: 1,
        scale: 1,
      }));
      const naturalEnd = rawEnd.map((placement, index) => ({
        ...placement,
        text: startPlacements[index].text,
        index,
        opacity: 1,
        scale: 1,
      }));
      endPlacements =
        selectedLayout === "outline"
          ? naturalEnd
          : spatiallyMatchPlacements(startPlacements, naturalEnd);

      const selected = new Set(selectedStartIndexes);
      const extraStartPlacements = rawStart
        .map((placement, rawIndex) => ({
          placement,
          rawIndex,
          progress: pathProgressForPoint(startShape, start.closed, placement),
        }))
        .filter(({ rawIndex }) => !selected.has(rawIndex));
      if (followContour) {
        extraStartPlacements.sort((a, b) => b.progress - a.progress);
      }
      let queueDistance = size + gap;
      extraStartPlacements.forEach(({ placement, progress }) => {
        const index = startPlacements.length;
        const text = placement.text;
        const width = tokenWidth(text, size);
        queueDistance += width / 2;
        startPlacements.push({
          ...placement,
          text,
          index,
          opacity: 1,
          scale: 1,
          pathProgress: followContour ? progress : undefined,
          pathOffset: followContour ? 0 : undefined,
          reveal: 1,
          revealEdge: "start",
        });
        const queueProgress = 1;
        const queueOffset = queueDistance;
        const queued = queuedPlacement(
          endShape,
          end.closed,
          placement,
          queueProgress,
          queueOffset,
          selectedOrientation,
          selectedLayout,
        );
        endPlacements.push({
          ...queued,
          text,
          index,
          opacity: 1,
          scale: 1,
          pathProgress: followContour ? queueProgress : undefined,
          pathOffset: followContour ? queueOffset : undefined,
          reveal: 0,
          revealEdge: "start",
        });
        queueDistance += width / 2 + gap;
      });
    }

    return {
      startShape,
      endShape,
      startClosed: start.closed,
      endClosed: end.closed,
      layout: selectedLayout,
      orientation: selectedOrientation,
      size,
      gap,
      countMode,
      startCapacity: rawStart.length,
      endCapacity: rawEnd.length,
      startPlacements,
      endPlacements,
    };
  }

  function clampProgress(value: number) {
    return Math.max(0, Math.min(1, value));
  }

  function easedMotionProgress(value: number, feel: MotionFeel) {
    const progress = clampProgress(value);
    if (feel === "snappy") return 1 - Math.pow(1 - progress, 3);
    if (feel === "playful") {
      const amount = 1.35;
      const scale = amount * 1.525;
      if (progress < 0.5) {
        const doubled = progress * 2;
        return (doubled * doubled * ((scale + 1) * doubled - scale)) / 2;
      }
      const doubled = progress * 2 - 2;
      return (doubled * doubled * ((scale + 1) * doubled + scale) + 2) / 2;
    }
    return progress * progress * (3 - 2 * progress);
  }

  function interpolateAngle(a: number, b: number, progress: number) {
    const difference = ((b - a + 540) % 360) - 180;
    return a + difference * progress;
  }

  function resolveMotionPlacementCollisions(
    source: Placement[],
    size: number,
    gap: number,
  ) {
    const result: Placement[] = [];
    const placedBoxes: CollisionBox[] = [];
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

  function interpolateMotionPlacements(
    plan: MotionPlan,
    progress: number,
    feel: MotionFeel,
    letterBehavior: LetterMotion,
  ) {
    const count = plan.startPlacements.length;
    const placements = plan.startPlacements.map((start, index) => {
      const end = plan.endPlacements[index];
      const offset =
        letterBehavior === "ripple" && count > 1
          ? (index / (count - 1) - 0.5) * 0.18 * Math.sin(Math.PI * progress)
          : 0;
      const localProgress = easedMotionProgress(progress + offset, feel);
      const opacity =
        (start.opacity ?? 1) +
        ((end.opacity ?? 1) - (start.opacity ?? 1)) * localProgress;
      const scale =
        (start.scale ?? 1) +
        ((end.scale ?? 1) - (start.scale ?? 1)) * localProgress;
      const startReveal = start.reveal ?? 1;
      const endReveal = end.reveal ?? 1;
      const hasReveal = start.reveal !== undefined || end.reveal !== undefined;
      let reveal = startReveal;
      if (startReveal < endReveal) {
        const phase = clampProgress(localProgress / 0.32);
        const easedPhase = phase * phase * (3 - 2 * phase);
        reveal = startReveal + (endReveal - startReveal) * easedPhase;
      } else if (startReveal > endReveal) {
        const phase = clampProgress((localProgress - 0.68) / 0.32);
        const easedPhase = phase * phase * (3 - 2 * phase);
        reveal = startReveal + (endReveal - startReveal) * easedPhase;
      }
      let x = start.x + (end.x - start.x) * localProgress;
      let y = start.y + (end.y - start.y) * localProgress;
      let angle = interpolateAngle(start.angle, end.angle, localProgress);
      if (start.pathProgress !== undefined && end.pathProgress !== undefined) {
        const shape = interpolateMotionShape(
          plan,
          clampProgress(localProgress),
        );
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
          plan.orientation,
          pathPoint.angle,
          { x, y },
          centerOf(shape),
          plan.layout,
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
        reveal: hasReveal ? clampProgress(reveal) : undefined,
        revealEdge: hasReveal
          ? (start.revealEdge ?? end.revealEdge)
          : undefined,
      };
    });
    if (plan.layout !== "outline" || progress <= 0.001 || progress >= 0.999) {
      return placements;
    }
    return resolveMotionPlacementCollisions(placements, plan.size, plan.gap);
  }

  function interpolateMotionShape(plan: MotionPlan, progress: number) {
    return plan.startShape.map((start, index) => ({
      x: start.x + (plan.endShape[index].x - start.x) * progress,
      y: start.y + (plan.endShape[index].y - start.y) * progress,
    }));
  }

  function tokenWidth(text: string, size: number) {
    return Math.max(size * 0.62, Array.from(text).length * size * 0.54);
  }

  function makeCollisionBox(
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

  function collisionBoxesOverlap(a: CollisionBox, b: CollisionBox) {
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

  function centerOf(source: Point[]) {
    if (!source.length) return { x: WIDTH / 2, y: HEIGHT / 2 };
    return {
      x: source.reduce((sum, point) => sum + point.x, 0) / source.length,
      y: source.reduce((sum, point) => sum + point.y, 0) / source.length,
    };
  }

  function placementAngle(
    selectedOrientation: Orientation,
    pathAngle: number,
    point: Point,
    center: Point,
    selectedLayout: Layout,
  ) {
    if (selectedOrientation === "upright") return 0;
    if (selectedOrientation === "radial") {
      return (
        Math.atan2(point.y - center.y, point.x - center.x) * (180 / Math.PI)
      );
    }
    return selectedLayout === "outline" ? pathAngle : 0;
  }

  function pointInPolygon(point: Point, polygon: Point[]) {
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
        point.x <
          ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 0.00001) + a.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function buildPlacements(
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
      const total = segments.length
        ? segments[segments.length - 1].offset +
          segments[segments.length - 1].length
        : 0;
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

  function pointsToPath(source: Point[], closed: boolean) {
    if (!source.length) return "";
    const commands = source.map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    );
    return `${commands.join(" ")}${closed && source.length > 2 ? " Z" : ""}`;
  }

  function pointerPoint(event: PointerEvent): Point {
    const rect = svgElement.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function makeBendWeights(source: Point[], lasso: Point[], closed: boolean) {
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

  function applyBendAngle(angle: number) {
    if (!bendPivot || !bendWeights.length) return;
    const radians = angle * (Math.PI / 180);
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const source = motionStartPose.points;
    const bent = source.map((point, index) => {
      const relativeX = point.x - bendPivot!.x;
      const relativeY = point.y - bendPivot!.y;
      const rotated = {
        x: bendPivot!.x + relativeX * cosine - relativeY * sine,
        y: bendPivot!.y + relativeX * sine + relativeY * cosine,
      };
      const weight = bendWeights[index] ?? 0;
      return {
        x: point.x + (rotated.x - point.x) * weight,
        y: point.y + (rotated.y - point.y) * weight,
      };
    });
    bendPoseAngle = angle;
    motionEndPose = { points: bent, closed: motionStartPose.closed };
    editingMotionPose = "end";
    points = clonePoints(bent);
    closePath = motionStartPose.closed;
  }

  function startBendInteraction(event: PointerEvent) {
    if (!motionEnabled || motionType !== "bend") return false;
    if (bendStep === "select") {
      event.preventDefault();
      stopMotionPlayback();
      bendLassoPointerDown = true;
      bendLasso = [pointerPoint(event)];
      svgElement.setPointerCapture(event.pointerId);
      return true;
    }
    if (bendStep === "pivot") {
      event.preventDefault();
      bendPivot = pointerPoint(event);
      bendStep = "pose";
      announce("Drag the selected part into its second pose");
      return true;
    }
    if (bendStep === "pose" && bendPivot) {
      event.preventDefault();
      const point = pointerPoint(event);
      bendPosePointerDown = true;
      bendPoseStartAngle = Math.atan2(
        point.y - bendPivot.y,
        point.x - bendPivot.x,
      );
      svgElement.setPointerCapture(event.pointerId);
      return true;
    }
    return false;
  }

  function continueBendInteraction(event: PointerEvent) {
    if (bendLassoPointerDown) {
      const point = pointerPoint(event);
      const last = bendLasso[bendLasso.length - 1];
      if (!last || distance(last, point) > 4) bendLasso = [...bendLasso, point];
      return true;
    }
    if (bendPosePointerDown && bendPivot) {
      const point = pointerPoint(event);
      const angle =
        (Math.atan2(point.y - bendPivot.y, point.x - bendPivot.x) -
          bendPoseStartAngle) *
        (180 / Math.PI);
      applyBendAngle(angle);
      return true;
    }
    return false;
  }

  function finishBendInteraction(event: PointerEvent) {
    if (bendLassoPointerDown) {
      bendLassoPointerDown = false;
      if (svgElement.hasPointerCapture(event.pointerId))
        svgElement.releasePointerCapture(event.pointerId);
      if (bendLasso.length < 3) {
        bendLasso = [];
        announce("Draw a loop around the moving part");
        return true;
      }
      bendWeights = makeBendWeights(
        motionStartPose.points,
        bendLasso,
        motionStartPose.closed,
      );
      if (!bendWeights.length) {
        bendLasso = [];
        announce("The loop missed the shape — draw around part of its edge");
        return true;
      }
      bendStep = "pivot";
      announce("Click the point where that part is attached");
      return true;
    }
    if (bendPosePointerDown) {
      bendPosePointerDown = false;
      if (svgElement.hasPointerCapture(event.pointerId))
        svgElement.releasePointerCapture(event.pointerId);
      bendStep = "done";
      saveActiveMotionPose();
      announce("Flap ready — press Play to preview it");
      return true;
    }
    return false;
  }

  function startDrawing(event: PointerEvent) {
    if (startBendInteraction(event)) return;
    if (!drawing) return;
    stopMotionPlayback();
    event.preventDefault();
    previousPoints = points;
    isPointerDown = true;
    svgElement.setPointerCapture(event.pointerId);
    points = [pointerPoint(event)];
  }

  function continueDrawing(event: PointerEvent) {
    if (continueBendInteraction(event)) return;
    if (!drawing || !isPointerDown) return;
    const point = pointerPoint(event);
    const last = points[points.length - 1];
    if (!last || distance(last, point) > 5) points = [...points, point];
  }

  function finishDrawing(event: PointerEvent) {
    if (finishBendInteraction(event)) return;
    if (!isPointerDown) return;
    isPointerDown = false;
    if (svgElement.hasPointerCapture(event.pointerId))
      svgElement.releasePointerCapture(event.pointerId);
    drawing = false;
    if (points.length < 2) points = previousPoints;
    syncShapeToMotion();
  }

  function undoShape() {
    if (!previousPoints.length) return;
    stopMotionPlayback();
    const current = points;
    points = previousPoints;
    previousPoints = current;
    syncShapeToMotion();
  }

  function clearShape() {
    stopMotionPlayback();
    previousPoints = points;
    points = [];
    drawing = true;
    syncShapeToMotion();
  }

  function automaticSelectionStatus(method: "alpha" | "background") {
    return method === "alpha"
      ? "Transparent background detected — using the image’s exact edge."
      : "Flat background detected — using a crisp pixel edge.";
  }

  function restoreAutomaticSelection() {
    if (automaticSelectionMask && automaticSelectionMethod) {
      selectionMask = automaticSelectionMask;
      selectionMethod = automaticSelectionMethod;
      selectionStatus = automaticSelectionStatus(automaticSelectionMethod);
      return;
    }
    selectionMask = undefined;
    selectionMethod = "none";
    selectionStatus = segmenterImageReady
      ? "Paint over the subject you want to keep."
      : "Preparing the subject selector…";
  }

  function openImageTool() {
    imageToolOpen = true;
    selectionError = "";
    if (!imageUrl) selectionStatus = "Upload an image to begin.";
  }

  function closeImageTool() {
    imageToolOpen = false;
    selectionPointerDown = false;
    activeSelectionStroke = [];
  }

  function ensureSegmenter() {
    if (segmenterWorker) return;
    selectionStatus = "Loading the subject selector…";
    segmenterBusy = true;
    segmenterWorker = new Worker(
      new URL("../workers/interactive-segmenter.worker.ts", import.meta.url),
      { type: "module" },
    );

    segmenterWorker.onmessage = (
      event: MessageEvent<
        | { type: "READY" | "IMAGE_READY" }
        | {
            type: "MASK";
            values: Float32Array;
            width: number;
            height: number;
            elapsed: number;
          }
        | { type: "ERROR"; message: string }
      >,
    ) => {
      const message = event.data;
      if (message.type === "READY") {
        segmenterReady = true;
        segmenterBusy = false;
        selectionStatus = imageUrl
          ? "Preparing your image…"
          : "Upload an image to begin.";
        sendPendingImage();
      }
      if (message.type === "IMAGE_READY") {
        segmenterImageReady = true;
        segmenterBusy = false;
        selectionStatus = automaticSelectionMask
          ? "AI brush ready — paint only where the exact edge needs correction."
          : "Paint over the subject you want to keep.";
      }
      if (message.type === "MASK") {
        selectionMask = message.values;
        selectionMaskWidth = message.width;
        selectionMaskHeight = message.height;
        selectionMethod = "ai";
        segmenterBusy = false;
        selectionStatus = `Selection updated in ${Math.max(1, Math.round(message.elapsed))}ms.`;
      }
      if (message.type === "ERROR") {
        selectionError = message.message;
        selectionStatus = "Subject selection could not start.";
        segmenterBusy = false;
      }
    };

    segmenterWorker.onerror = (event) => {
      selectionError = event.message || "The subject selector stopped working.";
      selectionStatus = "Subject selection could not start.";
      segmenterBusy = false;
    };
    segmenterWorker.postMessage({ type: "INITIALIZE" });
  }

  function sendPendingImage() {
    if (!segmenterReady || !segmenterWorker || !pendingBitmap) return;
    segmenterBusy = true;
    segmenterImageReady = false;
    selectionStatus = "Reading the image…";
    const bitmap = pendingBitmap;
    pendingBitmap = undefined;
    segmenterWorker.postMessage({ type: "SET_IMAGE", bitmap }, [bitmap]);
  }

  function startAiRefinement() {
    selectionError = "";
    if (segmenterImageReady) {
      selectionStatus = "Paint where the selection needs correction.";
      return;
    }
    if (!pendingBitmap) {
      selectionError = "Choose the image again to start AI refinement.";
      return;
    }
    ensureSegmenter();
    sendPendingImage();
  }

  function isHeicImage(file: File) {
    return (
      /\.hei[cf]$/i.test(file.name) ||
      [
        "image/heic",
        "image/heif",
        "image/heic-sequence",
        "image/heif-sequence",
      ].includes(file.type.toLowerCase())
    );
  }

  async function browserReadableImage(file: File) {
    if (!isHeicImage(file)) return file;

    selectionStatus = "Opening HEIC image…";
    try {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({
        blob: file,
        toType: "image/png",
      });
      const result = Array.isArray(converted) ? converted[0] : converted;
      if (!result) throw new Error("No image was found in this HEIC file.");
      return result;
    } catch {
      throw new Error(
        "This HEIC image could not be opened. Try exporting it as JPEG or PNG.",
      );
    }
  }

  async function chooseImage(file: File | undefined) {
    if (!file || imageImporting) return;
    if (!file.type.startsWith("image/") && !isHeicImage(file)) {
      selectionError = "Choose a PNG, JPEG, WebP, HEIC, or HEIF image.";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      selectionError = "That image is over 20 MB. Please choose a smaller one.";
      return;
    }

    selectionError = "";
    imageImporting = true;
    selectionStatus = isHeicImage(file)
      ? "Opening HEIC image…"
      : "Opening image…";

    try {
      const readableImage = await browserReadableImage(file);
      const source = await createImageBitmap(readableImage, {
        imageOrientation: "from-image",
      });

      selectionMask = undefined;
      automaticSelectionMask = undefined;
      automaticSelectionMethod = undefined;
      selectionMethod = "none";
      selectionStrokes = [];
      activeSelectionStroke = [];
      segmenterWorker?.terminate();
      segmenterWorker = undefined;
      segmenterReady = false;
      segmenterImageReady = false;
      segmenterBusy = true;
      imageName = file.name;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(readableImage);
      selectionStatus = "Reading the image edge…";

      const longestSide = Math.max(source.width, source.height);
      const scale = Math.min(1, 1200 / longestSide);
      imageWidth = Math.max(1, Math.round(source.width * scale));
      imageHeight = Math.max(1, Math.round(source.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = imageWidth;
      canvas.height = imageHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser cannot read image pixels.");
      context.clearRect(0, 0, imageWidth, imageHeight);
      context.drawImage(source, 0, 0, imageWidth, imageHeight);
      source.close();

      const automaticSelection = automaticMaskFromPixels(
        context.getImageData(0, 0, imageWidth, imageHeight),
      );
      pendingBitmap?.close();
      pendingBitmap = await createImageBitmap(canvas);

      if (automaticSelection) {
        automaticSelectionMask = automaticSelection.values;
        automaticSelectionMethod = automaticSelection.method;
        selectionMask = automaticSelection.values;
        selectionMaskWidth = imageWidth;
        selectionMaskHeight = imageHeight;
        selectionMethod = automaticSelection.method;
        selectionStatus = automaticSelectionStatus(automaticSelection.method);
        segmenterBusy = false;
      } else {
        selectionStatus = "Loading the subject selector…";
        startAiRefinement();
      }

      await tick();
      drawSelectionOverlay();
    } catch (error) {
      selectionError =
        error instanceof Error ? error.message : "The image could not be read.";
      segmenterBusy = false;
    } finally {
      imageImporting = false;
    }
  }

  function handleImageInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    chooseImage(input.files?.[0]);
    input.value = "";
  }

  function handleImageDrop(event: DragEvent) {
    event.preventDefault();
    chooseImage(event.dataTransfer?.files?.[0]);
  }

  function normalizedSelectionPoint(event: PointerEvent): Point {
    const rect = selectionCanvasElement.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function startSelectionStroke(event: PointerEvent) {
    if (!segmenterImageReady || segmenterBusy) return;
    event.preventDefault();
    selectionPointerDown = true;
    selectionCanvasElement.setPointerCapture(event.pointerId);
    activeSelectionStroke = [normalizedSelectionPoint(event)];
  }

  function continueSelectionStroke(event: PointerEvent) {
    if (!selectionPointerDown) return;
    const point = normalizedSelectionPoint(event);
    const last = activeSelectionStroke[activeSelectionStroke.length - 1];
    const rect = selectionCanvasElement.getBoundingClientRect();
    const moved = last
      ? Math.hypot(
          (point.x - last.x) * rect.width,
          (point.y - last.y) * rect.height,
        )
      : Infinity;
    if (moved > 3) activeSelectionStroke = [...activeSelectionStroke, point];
  }

  function finishSelectionStroke(event: PointerEvent) {
    if (!selectionPointerDown) return;
    selectionPointerDown = false;
    if (selectionCanvasElement.hasPointerCapture(event.pointerId)) {
      selectionCanvasElement.releasePointerCapture(event.pointerId);
    }
    if (!activeSelectionStroke.length) return;
    const brushMode = selectionTool === "keep" ? 1 : 2;
    selectionStrokes = [
      ...selectionStrokes,
      { brushMode, point: activeSelectionStroke, isCompleted: true },
    ];
    activeSelectionStroke = [];
    runSegmentation();
  }

  function runSegmentation() {
    if (!segmenterWorker || !segmenterImageReady || !selectionStrokes.length)
      return;
    segmenterBusy = true;
    selectionStatus = "Finding the subject…";
    segmenterWorker.postMessage({
      type: "SEGMENT",
      strokes: selectionStrokes,
    });
  }

  function undoSelectionStroke() {
    if (segmenterBusy || !selectionStrokes.length) return;
    selectionStrokes = selectionStrokes.slice(0, -1);
    if (selectionStrokes.length) {
      runSegmentation();
    } else {
      restoreAutomaticSelection();
    }
  }

  function resetSelection() {
    if (segmenterBusy) return;
    selectionStrokes = [];
    activeSelectionStroke = [];
    restoreAutomaticSelection();
  }

  function drawSelectionOverlay() {
    if (!selectionCanvasElement || !imageWidth || !imageHeight) return;
    if (
      selectionCanvasElement.width !== imageWidth ||
      selectionCanvasElement.height !== imageHeight
    ) {
      selectionCanvasElement.width = imageWidth;
      selectionCanvasElement.height = imageHeight;
    }
    const context = selectionCanvasElement.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, imageWidth, imageHeight);

    if (selectionMask && selectionMaskWidth && selectionMaskHeight) {
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = selectionMaskWidth;
      maskCanvas.height = selectionMaskHeight;
      const maskContext = maskCanvas.getContext("2d");
      const imageData = maskContext?.createImageData(
        selectionMaskWidth,
        selectionMaskHeight,
      );
      if (maskContext && imageData) {
        for (let index = 0; index < selectionMask.length; index += 1) {
          const confidence = selectionMask[index];
          const offset = index * 4;
          imageData.data[offset] = 240;
          imageData.data[offset + 1] = 199;
          imageData.data[offset + 2] = 56;
          imageData.data[offset + 3] =
            confidence >= selectionThreshold
              ? Math.round(72 + Math.min(1, confidence) * 92)
              : 0;
        }
        maskContext.putImageData(imageData, 0, 0);
        context.drawImage(maskCanvas, 0, 0, imageWidth, imageHeight);
      }
    }

    const drawStroke = (stroke: SelectionStroke, active = false) => {
      if (!stroke.point.length) return;
      const color =
        stroke.brushMode === 1
          ? "#14865d"
          : stroke.brushMode === 2
            ? "#d34b42"
            : "#315fb4";
      context.save();
      context.strokeStyle = color;
      context.fillStyle = color;
      context.globalAlpha = active ? 1 : 0.82;
      context.lineWidth = Math.max(4, imageWidth * 0.006);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      stroke.point.forEach((point, index) => {
        const x = point.x * imageWidth;
        const y = point.y * imageHeight;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      if (stroke.point.length === 1) {
        context.arc(
          stroke.point[0].x * imageWidth,
          stroke.point[0].y * imageHeight,
          context.lineWidth * 0.65,
          0,
          Math.PI * 2,
        );
        context.fill();
      } else {
        context.stroke();
      }
      context.restore();
    };

    selectionStrokes.forEach((stroke) => drawStroke(stroke));
    if (activeSelectionStroke.length) {
      drawStroke(
        {
          brushMode: selectionTool === "keep" ? 1 : 2,
          point: activeSelectionStroke,
          isCompleted: false,
        },
        true,
      );
    }
  }

  function polygonArea(source: Point[]) {
    let area = 0;
    for (let index = 0; index < source.length; index += 1) {
      const current = source[index];
      const next = source[(index + 1) % source.length];
      area += current.x * next.y - next.x * current.y;
    }
    return area / 2;
  }

  function pointToSegmentDistance(point: Point, start: Point, end: Point) {
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

  function simplifyOpenPath(source: Point[], tolerance: number): Point[] {
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
    const first = simplifyOpenPath(
      source.slice(0, furthestIndex + 1),
      tolerance,
    );
    const second = simplifyOpenPath(source.slice(furthestIndex), tolerance);
    return [...first.slice(0, -1), ...second];
  }

  function simplifyClosedPath(source: Point[], tolerance: number) {
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

  function reduceNearbyPoints(source: Point[], minimumDistance: number) {
    if (source.length < 4) return source;
    const result = [source[0]];
    for (let index = 1; index < source.length; index += 1) {
      if (
        distance(result[result.length - 1], source[index]) >= minimumDistance
      ) {
        result.push(source[index]);
      }
    }
    return result.length >= 3 ? result : source;
  }

  function smoothClosedPath(source: Point[], amount: number) {
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

  function contourFromMask(
    values: Float32Array,
    width: number,
    height: number,
    threshold: number,
  ) {
    if (!values.length || !width || !height) return [];
    const contour = contours()
      .size([width, height])
      .smooth(true)
      .contour(values as unknown as number[], threshold);
    let largestRing: Point[] = [];
    let largestArea = 0;
    for (const polygon of contour.coordinates) {
      const ring = polygon[0]?.map(([x, y]) => ({ x, y })) ?? [];
      const area = Math.abs(polygonArea(ring));
      if (area > largestArea) {
        largestArea = area;
        largestRing = ring;
      }
    }
    if (largestRing.length < 3) return [];
    const first = largestRing[0];
    const last = largestRing[largestRing.length - 1];
    if (distance(first, last) < 0.01) largestRing = largestRing.slice(0, -1);
    return largestRing;
  }

  function fitImportedContour(
    source: Point[],
    detail: number,
    smoothness: number,
  ) {
    if (source.length < 3) return [];
    const minX = Math.min(...source.map((point) => point.x));
    const maxX = Math.max(...source.map((point) => point.x));
    const minY = Math.min(...source.map((point) => point.y));
    const maxY = Math.max(...source.map((point) => point.y));
    const availableWidth = WIDTH - 120;
    const availableHeight = HEIGHT - 100;
    const scale = Math.min(
      availableWidth / Math.max(1, maxX - minX),
      availableHeight / Math.max(1, maxY - minY),
    );
    const fitted = source.map((point) => ({
      x: WIDTH / 2 + (point.x - (minX + maxX) / 2) * scale,
      y: HEIGHT / 2 + (point.y - (minY + maxY) / 2) * scale,
    }));
    const tolerance = Math.max(0.7, 7.6 - detail * 0.68);
    return smoothClosedPath(
      simplifyClosedPath(
        reduceNearbyPoints(fitted, Math.max(0.45, tolerance * 0.3)),
        tolerance,
      ),
      smoothness,
    );
  }

  function useImportedShape() {
    if (importedShapePreview.length < 3) return;
    stopMotionPlayback();
    previousPoints = points;
    points = clonePoints(importedShapePreview);
    closePath = true;
    drawing = false;
    showGuide = true;
    syncShapeToMotion();
    closeImageTool();
    announce(`Shape created from ${imageName || "image"}`);
  }

  function handleImageToolKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") closeImageTool();
  }

  function announce(message: string) {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 2400);
  }

  function handleReducedMotionChange(event: MediaQueryListEvent) {
    reducedMotion = event.matches;
    if (reducedMotion && motionPlaying) pauseMotion();
  }

  onMount(() => {
    reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = reducedMotionQuery.matches;
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  });

  onDestroy(() => {
    cancelMotionFrame();
    if (noticeTimer) clearTimeout(noticeTimer);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    pendingBitmap?.close();
    segmenterWorker?.postMessage({ type: "CLOSE" });
    segmenterWorker?.terminate();
    reducedMotionQuery?.removeEventListener(
      "change",
      handleReducedMotionChange,
    );
  });

  function exportMarkup() {
    const clone = svgElement.cloneNode(true) as SVGSVGElement;
    clone
      .querySelectorAll("[data-editor-guide]")
      .forEach((node) => node.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", WIDTH.toString());
    clone.setAttribute("height", HEIGHT.toString());
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
  }

  function escapeXml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function shortHash(value: string) {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function placementTransform(placement: Placement) {
    return `translate(${placement.x.toFixed(2)}px, ${placement.y.toFixed(2)}px) rotate(${placement.angle.toFixed(2)}deg) scale(${(placement.scale ?? 1).toFixed(3)})`;
  }

  function animatedExportMarkup() {
    if (!motionPlan) return "";
    const prefix = `cp-${shortHash(
      `${poem}-${motionPlan.startPlacements.length}-${motionDuration}-${motionFeel}-${letterMotion}-${motionCountMode}`,
    )}`;
    const frameCount =
      letterMotion === "ripple" ? (motionLoop ? 33 : 25) : motionLoop ? 17 : 9;
    const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
      const phase = frameIndex / (frameCount - 1);
      const progress = motionLoop
        ? phase <= 0.5
          ? phase * 2
          : 2 - phase * 2
        : phase;
      return interpolateMotionPlacements(
        motionPlan,
        progress,
        motionFeel,
        letterMotion,
      );
    });
    const totalDuration = motionDuration * (motionLoop ? 2 : 1);
    const timingFunction = "linear";
    const animationTargets =
      motionTrigger === "hover"
        ? [`.${prefix}:hover`, `.${prefix}:focus`]
        : [`.${prefix}`];
    const animationRules = motionPlan.startPlacements
      .map((_, placementIndex) => {
        const keyframes = frames
          .map((frame, frameIndex) => {
            const percentage = (frameIndex / (frameCount - 1)) * 100;
            return `${percentage.toFixed(3)}%{transform:${placementTransform(frame[placementIndex])};opacity:${(frame[placementIndex].opacity ?? 1).toFixed(3)}}`;
          })
          .join("");
        const selectors = animationTargets
          .map((target) => `${target} .${prefix}-piece-${placementIndex}`)
          .join(",");
        return `@keyframes ${prefix}-piece-${placementIndex}{${keyframes}}\n${selectors}{animation:${prefix}-piece-${placementIndex} ${totalDuration.toFixed(2)}s ${timingFunction} ${motionLoop ? "infinite" : "1 forwards"}}`;
      })
      .join("\n");
    const clippedPieceIndexes = motionPlan.startPlacements
      .map((placement, index) =>
        placement.reveal !== undefined ||
        motionPlan.endPlacements[index].reveal !== undefined
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    const revealAnimationRules = clippedPieceIndexes
      .map((placementIndex) => {
        const keyframes = frames
          .map((frame, frameIndex) => {
            const percentage = (frameIndex / (frameCount - 1)) * 100;
            const reveal = clampProgress(
              frame[placementIndex].reveal ?? 1,
            ).toFixed(4);
            return `${percentage.toFixed(3)}%{transform:scaleX(${reveal})}`;
          })
          .join("");
        const selectors = animationTargets
          .map((target) => `${target} .${prefix}-reveal-${placementIndex}`)
          .join(",");
        return `@keyframes ${prefix}-reveal-keyframes-${placementIndex}{${keyframes}}\n${selectors}{animation:${prefix}-reveal-keyframes-${placementIndex} ${totalDuration.toFixed(2)}s ${timingFunction} ${motionLoop ? "infinite" : "1 forwards"}}`;
      })
      .join("\n");
    const clipDefinitions = clippedPieceIndexes
      .map((index) => {
        const placement = motionPlan.startPlacements[index];
        const origin = placement.revealEdge === "end" ? "100% 50%" : "0% 50%";
        return `<clipPath id="${prefix}-clip-${index}" clipPathUnits="objectBoundingBox"><rect class="${prefix}-reveal ${prefix}-reveal-${index}" x="0" y="0" width="1" height="1" style="transform:scaleX(${clampProgress(placement.reveal ?? 1).toFixed(4)});transform-origin:${origin}" /></clipPath>`;
      })
      .join("");
    const pieces = motionPlan.startPlacements
      .map((placement, index) => {
        const clip = clippedPieceIndexes.includes(index)
          ? ` clip-path="url(#${prefix}-clip-${index})"`
          : "";
        return `<g class="${prefix}-piece ${prefix}-piece-${index}" style="transform:${placementTransform(placement)};opacity:${(placement.opacity ?? 1).toFixed(3)}"><text${clip} x="0" y="0" fill="${escapeXml(inkColor)}" font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle">${escapeXml(placement.text)}</text></g>`;
      })
      .join("");
    const hoverAttributes =
      motionTrigger === "hover" ? ' tabindex="0" focusable="true"' : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg class="${prefix}"${hoverAttributes} xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Animated concrete poem">
  <title>Animated concrete poem</title>
  <style><![CDATA[
    .${prefix} .${prefix}-piece{transform-box:view-box;transform-origin:0 0;will-change:transform,opacity}
    .${prefix} .${prefix}-reveal{transform-box:fill-box;will-change:transform}
    ${animationRules}
    ${revealAnimationRules}
    @media (prefers-reduced-motion: reduce){.${prefix} .${prefix}-piece,.${prefix} .${prefix}-reveal{animation:none!important}}
  ]]></style>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${escapeXml(paperColor)}" />
  <defs>${clipDefinitions}</defs>
  ${pieces}
</svg>`;
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadSvg() {
    downloadBlob(
      new Blob([exportMarkup()], { type: "image/svg+xml;charset=utf-8" }),
      "concrete-poem.svg",
    );
    announce("SVG downloaded");
  }

  function downloadAnimatedSvg() {
    const markup = animatedExportMarkup();
    if (!markup) {
      announce("Make both poses before exporting motion");
      return;
    }
    downloadBlob(
      new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
      "concrete-poem-motion.svg",
    );
    announce("Animated SVG downloaded");
  }

  async function downloadPng() {
    await document.fonts.ready;
    const svgBlob = new Blob([exportMarkup()], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH * 2;
      canvas.height = HEIGHT * 2;
      const context = canvas.getContext("2d");
      context?.scale(2, 2);
      context?.drawImage(image, 0, 0, WIDTH, HEIGHT);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, "concrete-poem.png");
        URL.revokeObjectURL(url);
      }, "image/png");
    };
    image.src = url;
    announce("Rendering PNG…");
  }

  async function copySvg() {
    const markup = (
      motionEnabled ? animatedExportMarkup() : exportMarkup()
    ).replace(/^<\?xml[^>]+>\n/, "");
    if (!markup) {
      announce("Make both poses before copying the embed");
      return;
    }
    try {
      await navigator.clipboard.writeText(markup);
      announce(
        motionEnabled
          ? "Animated SVG copied — paste it into HTML"
          : "SVG copied — paste it into HTML",
      );
    } catch {
      const field = document.createElement("textarea");
      field.value = markup;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      announce(
        copied
          ? `${motionEnabled ? "Animated SVG" : "SVG"} copied — paste it into HTML`
          : "Copy was blocked — use Download SVG",
      );
    }
  }
</script>

<svelte:window
  on:pointerdown={handleWindowPointerDown}
  on:keydown={handleWindowKeydown}
/>

<svg class="poetry-texture-definitions" aria-hidden="true">
  <defs>
    <filter id="poetryPageNoise">
      <feTurbulence baseFrequency="0.4" numOctaves="3" stitchTiles="noStitch"
      ></feTurbulence>
      <feColorMatrix type="saturate" values="0"></feColorMatrix>
    </filter>
  </defs>
</svg>

<div class="poetry-app">
  <main class="editor-shell">
    <aside class="control-panel">
      <div class="sidebar-heading">
        <div class="editor-title">
          <span>Concrete</span>
          <em>Poetry</em>
        </div>
        <a class="editor-byline" href="/"
          >by <span class="editor-byline-jp">劉元明</span> · JML</a
        >
      </div>
      <section class="control-section words-section">
        <div class="section-heading">
          <h2>Words</h2>
          <small
            >{characterCount}
            {characterCount === 1 ? "letter" : "letters"}</small
          >
        </div>
        <textarea bind:value={poem} aria-label="Poem text" spellcheck="true"
        ></textarea>
      </section>

      <section class="control-section">
        <div class="section-heading">
          <h2>Build</h2>
        </div>
        <div class="layout-grid" aria-label="Text placement">
          {#each layouts as option}
            <button
              class:active={layout === option.value}
              on:click={() => (layout = option.value)}
              type="button"
            >
              <span>{option.mark}</span>{option.label}
            </button>
          {/each}
        </div>

        <label class="control-label" for="unit">Use text as</label>
        <div class="segmented">
          {#each units as option}
            <button
              class:active={unit === option.value}
              on:click={() => (unit = option.value)}
              type="button"
            >
              {option.label}
            </button>
          {/each}
        </div>

        <div class="select-row">
          <span class="select-label" id="orientation-label">Direction</span>
          <div
            class="custom-select"
            on:focusout={(event) => handleSelectFocusOut(event, "orientation")}
          >
            <button
              id="orientation-trigger"
              class="custom-select-trigger"
              class:open={openSelect === "orientation"}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={openSelect === "orientation"}
              aria-controls="orientation-menu"
              aria-labelledby="orientation-label orientation-trigger"
              on:click={() => toggleSelect("orientation")}
              on:keydown={(event) =>
                handleSelectTriggerKeydown(event, "orientation")}
            >
              <span>{selectedOptionLabel("orientation")}</span>
              <i class="custom-select-caret" aria-hidden="true"></i>
            </button>
            {#if openSelect === "orientation"}
              <div
                id="orientation-menu"
                class="custom-select-menu"
                role="listbox"
                aria-labelledby="orientation-label"
              >
                {#each orientations as option, index}
                  <button
                    id={`orientation-option-${index}`}
                    class:selected={orientation === option.value}
                    type="button"
                    role="option"
                    aria-selected={orientation === option.value}
                    on:click={() =>
                      chooseSelectOption("orientation", option.value)}
                    on:keydown={(event) =>
                      handleSelectOptionKeydown(event, "orientation", index)}
                  >
                    <span>{option.label}</span>
                    {#if orientation === option.value}
                      <span aria-hidden="true">✓</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="select-row">
          <span class="select-label" id="font-label">Typeface</span>
          <div
            class="custom-select"
            on:focusout={(event) => handleSelectFocusOut(event, "font")}
          >
            <button
              id="font-trigger"
              class="custom-select-trigger"
              class:open={openSelect === "font"}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={openSelect === "font"}
              aria-controls="font-menu"
              aria-labelledby="font-label font-trigger"
              on:click={() => toggleSelect("font")}
              on:keydown={(event) => handleSelectTriggerKeydown(event, "font")}
            >
              <span>{selectedOptionLabel("font")}</span>
              <i class="custom-select-caret" aria-hidden="true"></i>
            </button>
            {#if openSelect === "font"}
              <div
                id="font-menu"
                class="custom-select-menu"
                role="listbox"
                aria-labelledby="font-label"
              >
                {#each typefaces as option, index}
                  <button
                    id={`font-option-${index}`}
                    class:selected={fontFamily === option.value}
                    type="button"
                    role="option"
                    aria-selected={fontFamily === option.value}
                    style={`font-family: ${option.value}`}
                    on:click={() => chooseSelectOption("font", option.value)}
                    on:keydown={(event) =>
                      handleSelectOptionKeydown(event, "font", index)}
                  >
                    <span>{option.label}</span>
                    {#if fontFamily === option.value}
                      <span aria-hidden="true">✓</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <label class="range-row">
          <span>Type size <output>{fontSize}px</output></span>
          <input
            type="range"
            min="10"
            max="52"
            step="1"
            bind:value={fontSize}
          />
        </label>
        <label class="range-row">
          <span>Spacing <output>{spacing}px</output></span>
          <input type="range" min="0" max="36" step="1" bind:value={spacing} />
        </label>
      </section>

      <section class="control-section shape-section">
        <div class="section-heading">
          <h2>Shape</h2>
        </div>
        <div class="shape-grid">
          <button
            type="button"
            disabled={motionEnabled &&
              motionType === "bend" &&
              bendStep !== "idle" &&
              bendStep !== "done"}
            on:click={() => applyPreset("circle")}><span>○</span>Circle</button
          >
          <button
            type="button"
            disabled={motionEnabled &&
              motionType === "bend" &&
              bendStep !== "idle" &&
              bendStep !== "done"}
            on:click={() => applyPreset("heart")}><span>♡</span>Heart</button
          >
          <button
            class:active={drawing}
            type="button"
            aria-pressed={drawing}
            disabled={motionEnabled &&
              motionType === "bend" &&
              bendStep !== "idle" &&
              bendStep !== "done"}
            on:click={() => {
              stopMotionPlayback();
              drawing = !drawing;
            }}
          >
            <span>✎</span>Draw
          </button>
          <button
            type="button"
            aria-label="Create a shape from an image"
            disabled={motionEnabled &&
              motionType === "bend" &&
              bendStep !== "idle" &&
              bendStep !== "done"}
            on:click={openImageTool}
          >
            <span>▧</span>Image
          </button>
        </div>
        <div class="toggle-row">
          <label
            ><input
              type="checkbox"
              bind:checked={closePath}
              disabled={motionEnabled &&
                motionType === "bend" &&
                bendStep !== "idle" &&
                bendStep !== "done"}
              on:change={syncShapeToMotion}
            /> Close shape</label
          >
          <label
            ><input type="checkbox" bind:checked={showGuide} /> Show guide</label
          >
        </div>
      </section>

      <section class="control-section motion-section">
        <div class="section-heading">
          <h2>Motion</h2>
          {#if motionEnabled}
            <small>
              {motionType === "bend" && bendStep === "done"
                ? `${Math.round(Math.abs(bendPoseAngle))}° bend`
                : motionType}
            </small>
          {/if}
        </div>

        {#if !motionEnabled}
          <p class="motion-intro">
            Make two poses. The editor keeps every piece of text attached as the
            shape moves.
          </p>
          <div class="motion-kind-grid">
            <button type="button" on:click={() => enableMotion("morph")}>
              <span class="motion-kind-icon">◇→♡</span>
              <span class="motion-kind-copy">
                <strong>Morph</strong>
                <small>Shape to shape</small>
              </span>
            </button>
            <button type="button" on:click={() => enableMotion("bend")}>
              <span class="motion-kind-icon">⌁</span>
              <span class="motion-kind-copy">
                <strong>Bend / flap</strong>
                <small>Move one part</small>
              </span>
            </button>
          </div>
        {:else}
          {#if motionType === "bend" && bendStep !== "done"}
            <div class="bend-instruction">
              <span>
                {bendStep === "select" ? "1" : bendStep === "pivot" ? "2" : "3"}
              </span>
              <p>
                {bendStep === "select"
                  ? "Draw a loop around the part that moves."
                  : bendStep === "pivot"
                    ? "Click where that part is attached."
                    : "Drag the selected part into its second pose."}
              </p>
            </div>
          {:else}
            <div class="pose-switcher" aria-label="Motion pose">
              <button
                class:active={editingMotionPose === "start"}
                type="button"
                on:click={() => selectMotionPose("start")}
              >
                <span>A</span>
                <small>Starting pose</small>
              </button>
              <i aria-hidden="true">→</i>
              <button
                class:active={editingMotionPose === "end"}
                type="button"
                on:click={() => selectMotionPose("end")}
              >
                <span>B</span>
                <small>Ending pose</small>
              </button>
            </div>
            {#if motionType === "morph"}
              <p class="pose-help">
                Editing pose {editingMotionPose === "start" ? "A" : "B"}. Use
                the Shape tools above to change it.
              </p>
            {/if}
          {/if}

          <div class="motion-player">
            <button
              class="play-motion"
              type="button"
              disabled={motionType === "bend" && bendStep !== "done"}
              on:click={motionPlaying ? pauseMotion : playMotion}
            >
              {motionPlaying ? "Pause Ⅱ" : "Play ▶"}
            </button>
            <input
              aria-label="Motion preview position"
              type="range"
              min="0"
              max="1"
              step="0.005"
              value={motionProgress}
              disabled={motionType === "bend" && bendStep !== "done"}
              on:input={(event) =>
                scrubMotion(
                  Number((event.currentTarget as HTMLInputElement).value),
                )}
            />
          </div>

          <span class="motion-control-label">Feel</span>
          <div class="motion-options three-up">
            {#each ["smooth", "playful", "snappy"] as option}
              <button
                class:active={motionFeel === option}
                type="button"
                on:click={() => (motionFeel = option as MotionFeel)}
                >{option}</button
              >
            {/each}
          </div>

          <span class="motion-control-label">Letters</span>
          <div class="motion-options">
            <button
              class:active={letterMotion === "attached"}
              type="button"
              on:click={() => (letterMotion = "attached")}>Attached</button
            >
            <button
              class:active={letterMotion === "ripple"}
              type="button"
              on:click={() => (letterMotion = "ripple")}>Ripple</button
            >
          </div>

          <span class="motion-control-label">Piece count</span>
          <div class="motion-options">
            <button
              class:active={motionCountMode === "fit"}
              type="button"
              on:click={() => setMotionCountMode("fit")}>Fit both</button
            >
            <button
              class:active={motionCountMode === "enter-exit"}
              type="button"
              on:click={() => setMotionCountMode("enter-exit")}
              >Enter / exit</button
            >
          </div>
          {#if motionPlan && motionCapacityMessage(motionPlan)}
            <p class="motion-capacity-note">
              {motionCapacityMessage(motionPlan)}
            </p>
          {/if}

          <span class="motion-control-label">Starts</span>
          <div class="motion-options">
            <button
              class:active={motionTrigger === "automatic"}
              type="button"
              on:click={() => (motionTrigger = "automatic")}>Automatic</button
            >
            <button
              class:active={motionTrigger === "hover"}
              type="button"
              on:click={() => (motionTrigger = "hover")}>On hover</button
            >
          </div>

          <label class="range-row motion-speed">
            <span>Duration <output>{motionDuration.toFixed(1)}s</output></span>
            <input
              type="range"
              min="0.6"
              max="6"
              step="0.1"
              bind:value={motionDuration}
            />
          </label>

          <div class="motion-bottom-row">
            <label
              ><input type="checkbox" bind:checked={motionLoop} /> Loop</label
            >
            <div>
              {#if motionType === "bend"}
                <button type="button" on:click={restartBendSetup}
                  >Redo flap</button
                >
              {:else}
                <button type="button" on:click={swapMotionPoses}>Swap</button>
              {/if}
              <button type="button" on:click={removeMotion}>Remove</button>
            </div>
          </div>
          {#if reducedMotion}
            <p class="reduced-motion-note">
              Your device requests reduced motion; exported embeds will respect
              that setting.
            </p>
          {/if}
        {/if}
      </section>
    </aside>

    <section class="stage-panel" aria-label="Poetry canvas">
      <div class="stage-toolbar">
        <p>
          {bendStep === "select"
            ? "Draw around the part that should move."
            : bendStep === "pivot"
              ? "Click the hinge point."
              : bendStep === "pose"
                ? "Drag the selected part into its ending pose."
                : motionPreviewing
                  ? `${placementCountLabel(visiblePlacementCount(renderedPlacements), unit)} · motion preview`
                  : drawing
                    ? "Drag anywhere on the paper to draw a new path."
                    : motionEnabled
                      ? `Pose ${editingMotionPose === "start" ? "A" : "B"} · ${placementCountLabel(motionPlan ? motionPoseCount(motionPlan, editingMotionPose) : placements.length, unit)} · ${layout}`
                      : `${placementCountLabel(placements.length, unit)} · ${layout}`}
        </p>
        <div>
          <button
            type="button"
            on:click={undoShape}
            disabled={!previousPoints.length ||
              (motionEnabled &&
                motionType === "bend" &&
                bendStep !== "idle" &&
                bendStep !== "done")}>Undo shape</button
          >
          <button
            type="button"
            disabled={motionEnabled &&
              motionType === "bend" &&
              bendStep !== "idle" &&
              bendStep !== "done"}
            on:click={clearShape}>Clear + draw</button
          >
        </div>
      </div>

      <div
        class:drawing
        class:bend-editing={motionType === "bend" &&
          bendStep !== "idle" &&
          bendStep !== "done"}
        class="canvas-wrap"
      >
        <svg
          bind:this={svgElement}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Concrete poetry preview"
          on:pointerdown={startDrawing}
          on:pointermove={continueDrawing}
          on:pointerup={finishDrawing}
          on:pointercancel={finishDrawing}
        >
          <rect width={WIDTH} height={HEIGHT} fill={paperColor} />

          <defs>
            {#each renderedPlacements as placement}
              {#if placement.reveal !== undefined}
                {@const reveal = clampProgress(placement.reveal)}
                <clipPath
                  id={`poetry-piece-clip-${placement.index}`}
                  clipPathUnits="objectBoundingBox"
                >
                  <rect
                    x={placement.revealEdge === "end" ? 1 - reveal : 0}
                    y="0"
                    width={reveal}
                    height="1"
                  />
                </clipPath>
              {/if}
            {/each}
          </defs>

          {#each renderedPlacements as placement}
            <g
              transform={`translate(${placement.x.toFixed(2)} ${placement.y.toFixed(2)}) rotate(${placement.angle.toFixed(2)}) scale(${(placement.scale ?? 1).toFixed(3)})`}
              opacity={(placement.opacity ?? 1).toFixed(3)}
            >
              <text
                class="poetry-token"
                x="0"
                y="0"
                fill={inkColor}
                font-family={fontFamily}
                font-size={fontSize}
                text-anchor="middle"
                dominant-baseline="middle"
                clip-path={placement.reveal === undefined
                  ? undefined
                  : `url(#poetry-piece-clip-${placement.index})`}
                >{placement.text}</text
              >
            </g>
          {/each}

          {#if showGuide && renderedPathData}
            <g data-editor-guide="true" aria-hidden="true">
              <path
                d={renderedPathData}
                fill="none"
                stroke={inkColor}
                stroke-width="1.5"
                stroke-dasharray="5 7"
                opacity="0.28"
              />
              {#if renderedShapePoints[0]}
                <circle
                  cx={renderedShapePoints[0].x}
                  cy={renderedShapePoints[0].y}
                  r="5"
                  fill={paperColor}
                  stroke={inkColor}
                  stroke-width="1.5"
                  opacity="0.7"
                />
              {/if}
            </g>
          {/if}

          {#if motionType === "bend" && bendStep !== "idle" && bendStep !== "done"}
            <g data-editor-guide="true" class="bend-guide" aria-hidden="true">
              {#if bendLasso.length > 1}
                <path d={pointsToPath(bendLasso, bendStep !== "select")} />
              {/if}
              {#if bendPivot}
                <circle cx={bendPivot.x} cy={bendPivot.y} r="8" />
                <path
                  d={`M ${bendPivot.x - 15} ${bendPivot.y} L ${bendPivot.x + 15} ${bendPivot.y} M ${bendPivot.x} ${bendPivot.y - 15} L ${bendPivot.x} ${bendPivot.y + 15}`}
                />
              {/if}
            </g>
          {/if}

          {#if drawing && !isPointerDown}
            <g data-editor-guide="true" class="draw-prompt" aria-hidden="true">
              <circle
                cx="450"
                cy="298"
                r="48"
                fill="none"
                stroke={inkColor}
                stroke-width="1.5"
                stroke-dasharray="4 7"
                opacity="0.5"
              />
              <path
                d="M 432 305 Q 450 279 468 305"
                fill="none"
                stroke={inkColor}
                stroke-width="2"
                opacity="0.7"
              />
              <text
                x="450"
                y="380"
                text-anchor="middle"
                fill={inkColor}
                font-family={fontFamily}
                font-size="19">draw one continuous line</text
              >
            </g>
          {/if}
        </svg>
      </div>

      <div class="stage-footer">
        <div class="color-controls">
          <label>Ink <input type="color" bind:value={inkColor} /></label>
          <label>Paper <input type="color" bind:value={paperColor} /></label>
        </div>
        <div class="export-actions">
          <button type="button" on:click={copySvg}
            >{motionEnabled ? "Copy motion embed" : "Copy embed"}</button
          >
          <button type="button" on:click={downloadPng}>PNG</button>
          {#if motionEnabled}
            <button type="button" on:click={downloadSvg}>Static SVG</button>
            <button class="primary" type="button" on:click={downloadAnimatedSvg}
              >Motion SVG ↘</button
            >
          {:else}
            <button class="primary" type="button" on:click={downloadSvg}
              >Download SVG ↘</button
            >
          {/if}
        </div>
      </div>
    </section>
  </main>

  {#if imageToolOpen}
    <div
      class="image-tool-backdrop"
      role="presentation"
      on:click={(event) => {
        if (event.target === event.currentTarget) closeImageTool();
      }}
      on:keydown={handleImageToolKeydown}
    >
      <section
        class="image-tool"
        class:upload-only={!imageUrl}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-tool-title"
        tabindex="-1"
      >
        <header class="image-tool-header">
          <h2 id="image-tool-title">
            {imageUrl ? "Select a subject" : "Image to shape"}
          </h2>
          <button
            type="button"
            on:click={closeImageTool}
            aria-label="Close image shape tool">×</button
          >
        </header>

        {#if !imageUrl}
          <button
            class="image-dropzone"
            type="button"
            disabled={imageImporting}
            on:click={() => imageInputElement.click()}
            on:dragover={(event) => event.preventDefault()}
            on:drop={handleImageDrop}
          >
            <span aria-hidden="true">▧</span>
            <strong
              >{imageImporting ? "Opening image…" : "Choose an image"}</strong
            >
            <small>
              {imageImporting
                ? "HEIC images can take a moment"
                : "or drop it here · PNG, JPEG, WebP, or HEIC"}
            </small>
          </button>
          {#if selectionError}
            <p class="model-status error">{selectionError}</p>
          {/if}
        {:else}
          <div class="image-tool-body">
            <div class="selection-workspace">
              <div class="selection-toolbar">
                <strong>{imageName}</strong>
                <button
                  type="button"
                  disabled={imageImporting}
                  on:click={() => imageInputElement.click()}>Replace</button
                >
              </div>

              <div class="subject-stage">
                <div
                  class:busy={segmenterBusy || imageImporting}
                  class="subject-image"
                  style={`aspect-ratio: ${imageWidth || 4} / ${imageHeight || 3}`}
                >
                  <img
                    src={imageUrl}
                    alt="Uploaded source for shape selection"
                    draggable="false"
                  />
                  <canvas
                    bind:this={selectionCanvasElement}
                    class:paintable={segmenterImageReady}
                    width={imageWidth}
                    height={imageHeight}
                    aria-label="Paint on the image to select a subject"
                    on:pointerdown={startSelectionStroke}
                    on:pointermove={continueSelectionStroke}
                    on:pointerup={finishSelectionStroke}
                    on:pointercancel={finishSelectionStroke}
                  ></canvas>
                  {#if segmenterBusy || imageImporting}
                    <div class="selection-busy" aria-live="polite">
                      <span></span>{selectionStatus}
                    </div>
                  {/if}
                </div>
              </div>

              <div class="selection-key">
                {#if !segmenterBusy && !imageImporting}
                  <span class:error={selectionError}>
                    {selectionError || selectionStatus}
                  </span>
                {/if}
                {#if selectionMethod === "alpha"}
                  <span class="exact-edge-label">Transparency edge</span>
                {:else if selectionMethod === "background"}
                  <span class="exact-edge-label">Background edge</span>
                {/if}
              </div>
            </div>

            <aside class="selection-controls">
              <section class="selection-step">
                <h3>Selection</h3>
                {#if selectionMethod === "alpha"}
                  <p>The transparent edge is ready to use.</p>
                {:else if selectionMethod === "background"}
                  <p>The background was removed automatically.</p>
                {:else}
                  <p>Paint the subject. Use remove to correct it.</p>
                {/if}

                {#if segmenterImageReady}
                  <div class="selection-tools" aria-label="Selection brush">
                    <button
                      class:active={selectionTool === "keep"}
                      type="button"
                      on:click={() => (selectionTool = "keep")}
                    >
                      <span class="keep-dot"></span>Add
                    </button>
                    <button
                      class:active={selectionTool === "remove"}
                      type="button"
                      on:click={() => (selectionTool = "remove")}
                    >
                      <span class="remove-dot"></span>Remove
                    </button>
                  </div>
                  <div class="selection-actions">
                    <button
                      type="button"
                      disabled={!selectionStrokes.length || segmenterBusy}
                      on:click={undoSelectionStroke}>Undo</button
                    >
                    <button
                      type="button"
                      disabled={!selectionStrokes.length || segmenterBusy}
                      on:click={resetSelection}>Reset</button
                    >
                  </div>
                {:else if selectionMethod === "alpha" || selectionMethod === "background"}
                  <button
                    class="ai-refine-button"
                    type="button"
                    disabled={segmenterBusy}
                    on:click={startAiRefinement}
                  >
                    Edit selection
                  </button>
                {/if}
              </section>

              <details class="refine-details">
                <summary>Refine outline</summary>
                <div class="refine-sliders">
                  <label class="import-range">
                    <span
                      >Edge <output
                        >{Math.round(selectionThreshold * 100)}%</output
                      ></span
                    >
                    <input
                      type="range"
                      min="0.2"
                      max="0.8"
                      step="0.02"
                      bind:value={selectionThreshold}
                    />
                  </label>
                  <label class="import-range">
                    <span>Detail <output>{selectionDetail}</output></span>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      bind:value={selectionDetail}
                    />
                  </label>
                  <label class="import-range">
                    <span>Smooth <output>{selectionSmoothness}</output></span>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="1"
                      bind:value={selectionSmoothness}
                    />
                  </label>
                </div>
              </details>

              <div class="shape-result" class:empty={!importedShapePath}>
                {#if importedShapePath}
                  <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    aria-label="Extracted shape preview"
                  >
                    <path
                      d={importedShapePath}
                      fill="rgba(36, 36, 36, 0.08)"
                      stroke="currentColor"
                      stroke-width="5"
                    />
                  </svg>
                {:else}
                  <span>Shape preview</span>
                {/if}
              </div>

              <div class="selection-confirm">
                <p>Processed only in your browser.</p>
                <button
                  type="button"
                  disabled={importedShapePreview.length < 3 ||
                    segmenterBusy ||
                    imageImporting}
                  on:click={useImportedShape}>Use this shape →</button
                >
              </div>
            </aside>
          </div>
        {/if}

        <input
          bind:this={imageInputElement}
          class="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
          disabled={imageImporting}
          on:change={handleImageInput}
        />
      </section>
    </div>
  {/if}

  {#if notice}
    <div class="notice" role="status">{notice}</div>
  {/if}
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    overflow: hidden;
  }

  button,
  textarea,
  input {
    font: inherit;
  }

  button {
    color: inherit;
  }

  .poetry-app {
    isolation: isolate;
    height: 100vh;
    overflow: hidden;
    background: var(--color-light);
    color: var(--color-dark);
  }

  .poetry-texture-definitions {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
  }

  .poetry-app::after {
    content: "";
    position: fixed;
    z-index: 10;
    inset: 0;
    background: rgba(0, 0, 0, 0.1);
    filter: url(#poetryPageNoise);
    opacity: 0.22;
    pointer-events: none;
  }

  .sidebar-heading {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 14px 9px;
    border-bottom: 1px solid var(--color-dark);
    line-height: 1;
  }

  .editor-title {
    display: flex;
    align-items: baseline;
    gap: 9px;
    font-size: clamp(1.35rem, 2.4vw, 2.15rem);
    letter-spacing: -0.045em;
  }

  .editor-title em {
    font-weight: 200;
  }

  .editor-byline {
    margin-top: 3px;
    color: inherit;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.62rem;
    letter-spacing: 0.11em;
    text-decoration: none;
    text-transform: uppercase;
  }

  .editor-byline:hover {
    color: var(--color-red-std);
  }

  .editor-byline-jp {
    font-family: var(--font-noto-serif-jp);
    letter-spacing: 0.03em;
  }

  .editor-shell {
    display: grid;
    grid-template-columns: minmax(290px, 330px) minmax(0, 1fr);
    height: 100vh;
    min-height: 0;
  }

  .control-panel {
    min-height: 0;
    overflow-y: auto;
    background: var(--color-light);
    color: var(--color-dark);
    border-right: 1px solid var(--color-dark);
  }

  .control-section {
    padding: 11px 14px 12px;
    border-bottom: 1px solid rgba(36, 36, 36, 0.35);
  }

  .section-heading {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    margin-bottom: 7px;
  }

  .section-heading small,
  .control-label,
  .select-label,
  .range-row > span,
  .toggle-row {
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.68rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .section-heading small {
    opacity: 0.55;
  }

  .section-heading h2 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 400;
  }

  textarea {
    width: 100%;
    min-height: 72px;
    max-height: 110px;
    resize: vertical;
    border: 1px solid rgba(36, 36, 36, 0.5);
    border-radius: 0;
    padding: 8px 9px;
    background: rgba(255, 255, 255, 0.25);
    color: var(--color-dark);
    font-size: 0.95rem;
    line-height: 1.25;
    outline: none;
  }

  textarea:focus,
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-yellow-std);
    outline-offset: 2px;
  }

  .layout-grid,
  .shape-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    border-top: 1px solid rgba(36, 36, 36, 0.5);
    border-left: 1px solid rgba(36, 36, 36, 0.5);
  }

  .shape-grid {
    grid-template-columns: repeat(4, 1fr);
  }

  .shape-section,
  .motion-section {
    padding-top: 14px;
    padding-bottom: 14px;
  }

  .shape-section .section-heading,
  .motion-section .section-heading {
    margin-bottom: 10px;
  }

  .layout-grid button,
  .shape-grid button {
    display: flex;
    min-height: 40px;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    padding: 5px 7px;
    border: 0;
    border-right: 1px solid rgba(36, 36, 36, 0.5);
    border-bottom: 1px solid rgba(36, 36, 36, 0.5);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.67rem;
    text-transform: uppercase;
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .shape-grid button {
    min-width: 0;
    min-height: 40px;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    padding: 6px 7px;
    overflow: hidden;
    font-size: 0.62rem;
    line-height: 1;
    white-space: nowrap;
  }

  .shape-grid button span {
    flex: 0 0 auto;
  }

  .layout-grid button span,
  .shape-grid button span {
    font-family: var(--font-pp-editorial);
    font-size: 1.1rem;
    line-height: 1;
  }

  .layout-grid button:hover,
  .layout-grid button.active,
  .shape-grid button:hover,
  .shape-grid button.active {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .shape-grid button:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .shape-grid button:disabled:hover {
    background: transparent;
    color: var(--color-dark);
  }

  .layout-grid button.active {
    background: var(--color-yellow-std);
    color: var(--color-dark);
  }

  .shape-grid button:nth-child(4) span {
    color: var(--color-red-std);
  }

  .control-label {
    display: block;
    margin: 9px 0 5px;
    opacity: 0.62;
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid rgba(36, 36, 36, 0.5);
  }

  .segmented button {
    min-height: 29px;
    padding: 4px;
    border: 0;
    border-right: 1px solid rgba(36, 36, 36, 0.5);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.67rem;
  }

  .segmented button:last-child {
    border-right: 0;
  }

  .segmented button:hover,
  .segmented button:hover {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .segmented button.active {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .select-row {
    display: grid;
    grid-template-columns: 82px 1fr;
    align-items: center;
    margin-top: 8px;
  }

  .custom-select {
    position: relative;
    min-width: 0;
  }

  .custom-select-trigger {
    width: 100%;
    min-height: 29px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border: 0;
    border-bottom: 1px solid rgba(36, 36, 36, 0.5);
    padding: 4px 5px 4px 1px;
    background: transparent;
    cursor: pointer;
    font-size: 0.85rem;
    text-align: left;
  }

  .custom-select-trigger.open {
    border-color: var(--color-dark);
  }

  .custom-select-caret {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: translateY(-2px) rotate(45deg);
  }

  .custom-select-trigger.open .custom-select-caret {
    transform: translateY(2px) rotate(225deg);
  }

  .custom-select-menu {
    position: absolute;
    z-index: 20;
    top: calc(100% - 1px);
    right: 0;
    left: 0;
    overflow: hidden;
    border: 1px solid var(--color-dark);
    background: var(--color-light);
    box-shadow: 3px 3px 0 rgba(36, 36, 36, 0.22);
  }

  .custom-select-menu button {
    width: 100%;
    min-height: 31px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 0;
    border-bottom: 1px solid rgba(36, 36, 36, 0.25);
    padding: 5px 7px;
    background: var(--color-light);
    cursor: pointer;
    font-size: 0.78rem;
    text-align: left;
  }

  .custom-select-menu button:last-child {
    border-bottom: 0;
  }

  .custom-select-menu button.selected {
    background: var(--color-yellow-std);
  }

  .custom-select-menu button:hover,
  .custom-select-menu button:focus-visible {
    background: var(--color-dark);
    color: var(--color-light);
    outline: 0;
  }

  .range-row {
    display: block;
    margin-top: 8px;
  }

  .range-row > span {
    display: flex;
    justify-content: space-between;
    opacity: 0.72;
  }

  .range-row output {
    color: var(--color-dark);
  }

  input[type="range"] {
    width: 100%;
    height: 10px;
    accent-color: var(--color-dark);
  }

  .toggle-row {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;
    margin-top: 10px;
    line-height: 1.2;
  }

  .toggle-row label {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }

  .toggle-row input {
    accent-color: var(--color-yellow-std);
  }

  .motion-intro,
  .pose-help,
  .reduced-motion-note {
    margin: 0 0 10px;
    color: rgba(36, 36, 36, 0.72);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.69rem;
    line-height: 1.45;
  }

  .motion-kind-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid rgba(36, 36, 36, 0.5);
    border-left: 1px solid rgba(36, 36, 36, 0.5);
  }

  .motion-kind-grid button {
    min-width: 0;
    min-height: 58px;
    display: flex;
    align-items: center;
    gap: 10px;
    border: 0;
    border-right: 1px solid rgba(36, 36, 36, 0.5);
    border-bottom: 1px solid rgba(36, 36, 36, 0.5);
    padding: 9px 10px;
    background: transparent;
    color: var(--color-dark);
    cursor: pointer;
    text-align: left;
  }

  .motion-kind-grid button:hover {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .motion-kind-icon {
    flex: 0 0 auto;
    color: var(--color-red-std);
    font-family: var(--font-pp-editorial);
    font-size: 1.1rem;
    line-height: 1;
  }

  .motion-kind-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .motion-kind-grid strong,
  .motion-kind-grid small,
  .pose-switcher small,
  .motion-control-label,
  .motion-capacity-note,
  .bend-instruction,
  .motion-bottom-row {
    font-family: var(--font-pp-editorial-sans);
  }

  .motion-kind-grid strong {
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.1;
    text-transform: uppercase;
  }

  .motion-kind-grid small {
    font-size: 0.61rem;
    line-height: 1.15;
    opacity: 0.62;
  }

  .pose-switcher {
    display: grid;
    grid-template-columns: 1fr 22px 1fr;
    align-items: stretch;
  }

  .pose-switcher > i {
    display: flex;
    align-items: center;
    justify-content: center;
    font-style: normal;
  }

  .pose-switcher button {
    min-height: 42px;
    display: grid;
    grid-template-columns: 27px 1fr;
    align-items: center;
    border: 1px solid rgba(36, 36, 36, 0.5);
    padding: 4px 6px;
    background: transparent;
    color: var(--color-dark);
    cursor: pointer;
    text-align: left;
  }

  .pose-switcher button.active {
    background: var(--color-yellow-std);
  }

  .pose-switcher button > span {
    font-size: 1.25rem;
  }

  .pose-switcher small {
    font-size: 0.61rem;
    text-transform: uppercase;
  }

  .pose-help {
    margin-top: 7px;
    margin-bottom: 0;
  }

  .bend-instruction {
    min-height: 47px;
    display: grid;
    grid-template-columns: 30px 1fr;
    align-items: center;
    border: 1px solid var(--color-dark);
    background: rgba(239, 54, 63, 0.08);
  }

  .bend-instruction > span {
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-red-std);
    color: var(--color-light);
    font-size: 0.8rem;
  }

  .bend-instruction p {
    margin: 0;
    padding: 5px 7px;
    font-size: 0.68rem;
    line-height: 1.25;
  }

  .motion-player {
    display: grid;
    grid-template-columns: 72px 1fr;
    align-items: center;
    gap: 8px;
    margin: 10px 0 0;
  }

  .motion-player button,
  .motion-options button,
  .motion-bottom-row button {
    min-height: 28px;
    border: 1px solid rgba(36, 36, 36, 0.5);
    padding: 4px 6px;
    background: transparent;
    color: var(--color-dark);
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.65rem;
    text-transform: uppercase;
  }

  .motion-player button:hover,
  .motion-options button:hover,
  .motion-bottom-row button:hover,
  .motion-options button.active {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .motion-player button:disabled,
  .motion-player input:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .motion-player .play-motion {
    background: var(--color-orange-std);
  }

  .motion-control-label {
    display: block;
    margin: 9px 0 4px;
    font-size: 0.61rem;
    letter-spacing: 0.07em;
    opacity: 0.62;
    text-transform: uppercase;
  }

  .motion-options {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }

  .motion-options.three-up {
    grid-template-columns: repeat(3, 1fr);
  }

  .motion-options button {
    border-right: 0;
  }

  .motion-options button:last-child {
    border-right: 1px solid rgba(36, 36, 36, 0.5);
  }

  .motion-capacity-note {
    margin: 5px 0 0;
    color: rgba(36, 36, 36, 0.68);
    font-size: 0.61rem;
    line-height: 1.35;
  }

  .motion-speed {
    margin-top: 10px;
  }

  .motion-bottom-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 9px 0 0;
    font-size: 0.64rem;
    text-transform: uppercase;
  }

  .motion-bottom-row > label,
  .motion-bottom-row > div {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .motion-bottom-row input {
    accent-color: var(--color-yellow-std);
  }

  .reduced-motion-note {
    margin-top: 9px;
    margin-bottom: 0;
  }

  .stage-panel {
    min-width: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-height: 0;
    padding: 10px 12px 8px;
    background: #d7d7d1;
  }

  .stage-toolbar,
  .stage-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 0 8px;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .stage-toolbar p {
    margin: 0;
    border-left: 4px solid var(--color-red-std);
    padding-left: 7px;
  }

  .stage-toolbar > div,
  .export-actions,
  .color-controls {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .stage-toolbar button,
  .export-actions button {
    min-height: 29px;
    border: 1px solid var(--color-dark);
    padding: 4px 9px;
    background: transparent;
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.69rem;
    text-transform: uppercase;
  }

  .stage-toolbar button:hover,
  .export-actions button:hover {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .export-actions button.primary {
    background: var(--color-orange-std);
    color: var(--color-dark);
  }

  .export-actions button.primary:hover {
    background: var(--color-yellow-std);
    color: var(--color-dark);
  }

  .stage-toolbar button:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .canvas-wrap {
    position: relative;
    z-index: 11;
    min-height: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid var(--color-dark);
    background: var(--color-light);
  }

  .canvas-wrap.drawing {
    cursor: crosshair;
  }

  .canvas-wrap.bend-editing {
    cursor: crosshair;
  }

  .bend-guide path,
  .bend-guide circle {
    fill: rgba(239, 54, 63, 0.08);
    stroke: var(--color-red-std);
    stroke-width: 2;
    stroke-dasharray: 6 5;
    vector-effect: non-scaling-stroke;
  }

  .bend-guide circle {
    fill: var(--color-yellow-std);
    stroke-dasharray: none;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
  }

  .stage-footer {
    padding: 8px 0 0;
  }

  .color-controls label {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  input[type="color"] {
    width: 24px;
    height: 24px;
    border: 1px solid var(--color-dark);
    padding: 2px;
    background: transparent;
    cursor: pointer;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .image-tool-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(36, 36, 36, 0.72);
  }

  .image-tool {
    position: relative;
    width: min(900px, calc(100vw - 40px));
    height: min(620px, calc(100vh - 40px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid var(--color-dark);
    background: var(--color-light);
    box-shadow: 7px 7px 0 rgba(36, 36, 36, 0.4);
  }

  .image-tool.upload-only {
    width: min(500px, calc(100vw - 40px));
    height: auto;
  }

  .image-tool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 50px;
    padding: 7px 9px 7px 13px;
    border-bottom: 1px solid var(--color-dark);
  }

  .model-status,
  .selection-toolbar,
  .selection-key,
  .import-range > span,
  .selection-confirm p {
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.68rem;
    letter-spacing: 0.065em;
    text-transform: uppercase;
  }

  .image-tool-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 400;
    letter-spacing: -0.025em;
  }

  .image-tool-header button,
  .selection-toolbar button,
  .selection-actions button,
  .selection-confirm button {
    min-height: 31px;
    border: 1px solid var(--color-dark);
    padding: 5px 9px;
    background: transparent;
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  .image-tool-header button {
    width: 33px;
    min-height: 33px;
    padding: 0;
    font-family: inherit;
    font-size: 1.2rem;
    line-height: 1;
  }

  .image-tool-header button:hover,
  .selection-toolbar button:hover,
  .selection-actions button:hover,
  .selection-confirm button:hover,
  .selection-confirm button:not(:disabled) {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .image-dropzone {
    width: calc(100% - 40px);
    min-height: 190px;
    margin: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px dashed var(--color-dark);
    background: #e5e5df;
    color: var(--color-dark);
    cursor: pointer;
  }

  .image-dropzone:hover {
    background: #ddddd6;
  }

  .image-dropzone:disabled {
    cursor: progress;
    opacity: 0.72;
  }

  .image-dropzone > span {
    margin-bottom: 2px;
    font-size: 2rem;
    line-height: 1;
  }

  .image-dropzone strong {
    font-size: 1.25rem;
    font-weight: 400;
  }

  .image-dropzone small {
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.62rem;
    letter-spacing: 0.045em;
    text-transform: uppercase;
  }

  .model-status {
    margin: -8px 20px 16px;
    text-align: center;
  }

  .error {
    color: #b92f28 !important;
  }

  .image-tool-body {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 258px;
  }

  .selection-workspace {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    padding: 10px 11px 8px;
    background: #d7d7d1;
  }

  .selection-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 31px;
    padding-bottom: 8px;
  }

  .selection-toolbar strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .subject-stage {
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid var(--color-dark);
    background:
      linear-gradient(45deg, #e8e8e3 25%, transparent 25%),
      linear-gradient(-45deg, #e8e8e3 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #e8e8e3 75%),
      linear-gradient(-45deg, transparent 75%, #e8e8e3 75%), #f4f4ef;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
    background-size: 16px 16px;
  }

  .subject-image {
    position: relative;
    max-width: 100%;
    max-height: 100%;
  }

  .subject-image img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 100%;
    object-fit: contain;
    user-select: none;
  }

  .subject-image canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: default;
    touch-action: none;
  }

  .subject-image canvas.paintable {
    cursor: crosshair;
  }

  .subject-image.busy canvas {
    pointer-events: none;
  }

  .selection-busy {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    background: rgba(240, 240, 240, 0.78);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.72rem;
    text-transform: uppercase;
  }

  .selection-busy span {
    width: 13px;
    height: 13px;
    border: 1px solid var(--color-dark);
    background: linear-gradient(
      135deg,
      var(--color-dark) 0 45%,
      transparent 45% 55%,
      var(--color-dark) 55%
    );
  }

  .selection-key {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-height: 25px;
    padding-top: 3px;
  }

  .selection-key > span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.62;
  }

  .exact-edge-label {
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid rgba(36, 36, 36, 0.5);
    background: var(--color-light);
  }

  .keep-dot,
  .remove-dot {
    width: 8px;
    height: 8px;
    display: inline-block;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #14865d;
  }

  .remove-dot {
    background: #d34b42;
  }

  .selection-controls {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-left: 1px solid var(--color-dark);
  }

  .selection-step {
    padding: 14px;
    border-bottom: 1px solid rgba(36, 36, 36, 0.4);
  }

  .selection-step h3 {
    margin: 0 0 3px;
    font-size: 1.05rem;
    font-weight: 400;
  }

  .selection-step > p {
    margin: 0 0 10px;
    font-size: 0.76rem;
    line-height: 1.3;
    opacity: 0.7;
  }

  .selection-tools {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    border: 1px solid rgba(36, 36, 36, 0.55);
  }

  .selection-tools button {
    min-height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 0;
    border-right: 1px solid rgba(36, 36, 36, 0.55);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.62rem;
    text-transform: uppercase;
  }

  .selection-tools button:last-child {
    border-right: 0;
  }

  .selection-tools button.active {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .selection-actions {
    display: flex;
    gap: 6px;
    margin-top: 7px;
  }

  .selection-actions button {
    flex: 1;
  }

  .ai-refine-button {
    width: 100%;
    min-height: 32px;
    margin: 0;
    border: 1px solid var(--color-dark);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.67rem;
    text-transform: uppercase;
  }

  .ai-refine-button:hover {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .selection-actions button:disabled,
  .selection-toolbar button:disabled,
  .selection-confirm button:disabled {
    cursor: default;
    opacity: 0.35;
    background: transparent;
    color: var(--color-dark);
  }

  .refine-details {
    border-bottom: 1px solid rgba(36, 36, 36, 0.4);
  }

  .refine-details summary {
    min-height: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    cursor: pointer;
    list-style: none;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.68rem;
    letter-spacing: 0.045em;
    text-transform: uppercase;
  }

  .refine-details summary::-webkit-details-marker {
    display: none;
  }

  .refine-details summary::after {
    content: "+";
    font-family: inherit;
    font-size: 1rem;
  }

  .refine-details[open] summary::after {
    content: "−";
  }

  .refine-sliders {
    padding: 0 14px 12px;
  }

  .import-range {
    display: block;
    margin-top: 7px;
  }

  .import-range > span {
    display: flex;
    justify-content: space-between;
    opacity: 0.72;
  }

  .shape-result {
    min-height: 105px;
    flex: 1 1 105px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 14px;
    border: 1px solid rgba(36, 36, 36, 0.55);
    background: #e8e8e3;
  }

  .shape-result svg {
    width: 100%;
    height: 100%;
    padding: 7px;
    color: var(--color-dark);
  }

  .shape-result > span {
    max-width: 170px;
    text-align: center;
    font-size: 0.74rem;
    line-height: 1.25;
    opacity: 0.55;
  }

  .selection-confirm {
    padding: 0 14px 14px;
  }

  .selection-confirm p {
    margin: 0 0 7px;
    line-height: 1.35;
    opacity: 0.62;
  }

  .selection-confirm button {
    width: 100%;
  }

  .notice {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 20;
    border: 1px solid var(--color-light);
    padding: 10px 13px;
    background: var(--color-dark);
    color: var(--color-light);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.75rem;
    text-transform: uppercase;
  }

  @media (max-width: 720px) {
    :global(body) {
      overflow-y: auto;
    }

    .poetry-app {
      height: auto;
      min-height: 100vh;
      overflow: visible;
    }

    .sidebar-heading {
      grid-column: 1 / -1;
    }

    .editor-shell {
      grid-template-columns: 1fr;
      height: auto;
    }

    .control-panel {
      display: grid;
      grid-template-columns: 1fr 1fr;
      overflow: visible;
      border-right: 0;
    }

    .control-section {
      border-right: 1px solid rgba(36, 36, 36, 0.35);
    }

    .shape-section .shape-grid {
      grid-template-columns: repeat(4, 1fr);
    }

    .stage-panel {
      min-height: 620px;
    }
  }

  @media (max-width: 620px) {
    .control-panel {
      grid-template-columns: 1fr;
    }

    .shape-section .shape-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .stage-panel {
      min-height: 520px;
      padding: 10px;
    }

    .stage-toolbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .canvas-wrap {
      min-height: 300px;
    }

    .stage-footer {
      align-items: flex-end;
      flex-direction: column;
    }

    .export-actions {
      width: 100%;
    }

    .export-actions button {
      flex: 1;
    }
  }

  @media (max-width: 680px) {
    .image-tool {
      height: calc(100vh - 20px);
      width: calc(100vw - 20px);
    }

    .image-tool-body {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }

    .selection-workspace {
      min-height: 520px;
    }

    .selection-controls {
      overflow: visible;
      border-top: 1px solid var(--color-dark);
      border-left: 0;
    }
  }

  @media (max-width: 520px) {
    .image-tool-backdrop {
      padding: 0;
    }

    .image-tool {
      width: 100vw;
      height: 100vh;
      border: 0;
      box-shadow: none;
    }

    .selection-workspace {
      min-height: 440px;
      padding: 8px;
    }

    .selection-toolbar span {
      display: none;
    }
  }
</style>
