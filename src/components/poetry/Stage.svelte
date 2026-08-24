<script lang="ts">
  import { editor, type Tool } from "../../lib/poetry/editorState.svelte";
  import {
    boundsOf,
    centerOf,
    distance,
    pointsToPath,
  } from "../../lib/poetry/geometry";
  import {
    applyBend,
    applyWarp,
    makeBendWeights,
    rotatePointsAbout,
    scalePointsAbout,
    translatePoints,
  } from "../../lib/poetry/tools";
  import {
    HEIGHT,
    WIDTH,
    clonePoints,
    type Point,
  } from "../../lib/poetry/types";

  let svgElement: SVGSVGElement;

  type DragMode =
    | { kind: "none" }
    | { kind: "move"; startPointer: Point; startPoints: Point[] }
    | {
        kind: "scale";
        anchor: Point;
        startPointer: Point;
        startPoints: Point[];
      }
    | {
        kind: "rotate";
        center: Point;
        startAngle: number;
        startPoints: Point[];
      }
    | { kind: "draw" }
    | { kind: "lasso" }
    | { kind: "bend-angle"; startPointer: Point }
    | { kind: "warp"; lastPointer: Point };

  let drag = $state<DragMode>({ kind: "none" });

  type BendSession = {
    step: "lasso" | "pivot" | "ready";
    lasso: Point[];
    weights: number[];
    pivot?: Point;
    basePoints?: Point[];
    angle: number;
  };
  let bend = $state<BendSession>({
    step: "lasso",
    lasso: [],
    weights: [],
    angle: 0,
  });

  let warpPointer = $state<Point | undefined>(undefined);
  const WARP_RADIUS = 92;

  const frame = $derived(editor.frame);
  const pose = $derived(editor.selectedKeyframe.pose);
  const editable = $derived(editor.atKeyframe);
  const pathData = $derived(pointsToPath(frame.shape, frame.closed));
  const bounds = $derived(boundsOf(pose.points));

  const onionPoses = $derived.by(() => {
    if (!editor.animated || !editor.showOnion || !editable) return [];
    const index = editor.selectedIndex;
    const neighbors: { path: string; tone: "before" | "after" }[] = [];
    const previous = editor.keyframes[index - 1];
    const next = editor.keyframes[index + 1];
    if (previous)
      neighbors.push({
        path: pointsToPath(previous.pose.points, previous.pose.closed),
        tone: "before",
      });
    if (next)
      neighbors.push({
        path: pointsToPath(next.pose.points, next.pose.closed),
        tone: "after",
      });
    return neighbors;
  });

  const tools: { value: Tool; label: string; mark: string; keys: string }[] = [
    { value: "select", label: "Move", mark: "⇱", keys: "V" },
    { value: "bend", label: "Bend", mark: "⌁", keys: "B" },
    { value: "warp", label: "Sculpt", mark: "☄", keys: "S" },
  ];

  const hint = $derived.by(() => {
    if (editor.playing) return "";
    if (!editable) return "Scrubbing preview — click a pose to edit it";
    if (editor.tool === "draw")
      return "Drag anywhere to draw the shape in one line";
    if (editor.tool === "bend") {
      if (bend.step === "lasso") return "Draw a loop around the part to bend";
      if (bend.step === "pivot")
        return "Click the hinge — where it stays attached";
      return "Drag to swing the part · redraw a loop anytime · Esc to finish";
    }
    if (editor.tool === "warp") return "Drag across the edge to sculpt it";
    return "";
  });

  export function resetBend() {
    bend = { step: "lasso", lasso: [], weights: [], angle: 0 };
  }

  $effect(() => {
    editor.tool;
    editor.selectedKeyframeId;
    resetBend();
    warpPointer = undefined;
  });

  function capturePointer(event: PointerEvent) {
    try {
      svgElement.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointers can't be captured; dragging
      // still works through the move/up handlers on the svg itself.
    }
  }

  function releasePointer(event: PointerEvent) {
    try {
      if (svgElement.hasPointerCapture(event.pointerId)) {
        svgElement.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore — see capturePointer.
    }
  }

  function pointerPoint(event: PointerEvent): Point {
    const rect = svgElement.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function ensureEditable() {
    if (!editable) {
      editor.selectKeyframe(editor.selectedKeyframeId);
    }
  }

  function beginPoseDrag() {
    editor.commit();
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    ensureEditable();
    const point = pointerPoint(event);
    const tool = editor.tool;
    if (tool === "draw") {
      event.preventDefault();
      beginPoseDrag();
      capturePointer(event);
      editor.setSelectedPose({ points: [point], closed: pose.closed });
      drag = { kind: "draw" };
      return;
    }
    if (tool === "bend") {
      event.preventDefault();
      if (bend.step === "lasso") {
        capturePointer(event);
        bend = { ...bend, lasso: [point] };
        drag = { kind: "lasso" };
        return;
      }
      if (bend.step === "pivot") {
        bend = {
          ...bend,
          pivot: point,
          basePoints: clonePoints(pose.points),
          angle: 0,
          step: "ready",
        };
        return;
      }
      if (bend.step === "ready" && bend.pivot) {
        capturePointer(event);
        beginPoseDrag();
        drag = { kind: "bend-angle", startPointer: point };
        return;
      }
      return;
    }
    if (tool === "warp") {
      event.preventDefault();
      capturePointer(event);
      beginPoseDrag();
      drag = { kind: "warp", lastPointer: point };
      return;
    }
    // select tool: move via the shape body
    event.preventDefault();
    capturePointer(event);
    beginPoseDrag();
    drag = {
      kind: "move",
      startPointer: point,
      startPoints: clonePoints(pose.points),
    };
  }

  function startScale(event: PointerEvent, corner: "nw" | "ne" | "sw" | "se") {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    ensureEditable();
    const anchors = {
      nw: { x: bounds.maxX, y: bounds.maxY },
      ne: { x: bounds.minX, y: bounds.maxY },
      sw: { x: bounds.maxX, y: bounds.minY },
      se: { x: bounds.minX, y: bounds.minY },
    };
    capturePointer(event);
    beginPoseDrag();
    drag = {
      kind: "scale",
      anchor: anchors[corner],
      startPointer: pointerPoint(event),
      startPoints: clonePoints(pose.points),
    };
  }

  function startRotate(event: PointerEvent) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    ensureEditable();
    const center = centerOf(pose.points);
    const point = pointerPoint(event);
    capturePointer(event);
    beginPoseDrag();
    drag = {
      kind: "rotate",
      center,
      startAngle: Math.atan2(point.y - center.y, point.x - center.x),
      startPoints: clonePoints(pose.points),
    };
  }

  function handlePointerMove(event: PointerEvent) {
    const point = pointerPoint(event);
    if (editor.tool === "warp") warpPointer = point;
    const active = drag;
    if (active.kind === "none") return;

    if (active.kind === "draw") {
      const last = pose.points[pose.points.length - 1];
      if (!last || distance(last, point) > 5) {
        editor.setSelectedPose({
          points: [...pose.points, point],
          closed: pose.closed,
        });
      }
      return;
    }
    if (active.kind === "lasso") {
      const last = bend.lasso[bend.lasso.length - 1];
      if (!last || distance(last, point) > 4) {
        bend = { ...bend, lasso: [...bend.lasso, point] };
      }
      return;
    }
    if (active.kind === "bend-angle" && bend.pivot && bend.basePoints) {
      const pivot = bend.pivot;
      const startAngle = Math.atan2(
        active.startPointer.y - pivot.y,
        active.startPointer.x - pivot.x,
      );
      const currentAngle = Math.atan2(point.y - pivot.y, point.x - pivot.x);
      const degrees =
        bend.angle + ((currentAngle - startAngle) * 180) / Math.PI;
      editor.setSelectedPose({
        points: applyBend(bend.basePoints, pivot, bend.weights, degrees),
        closed: pose.closed,
      });
      drag = { ...active, startPointer: point };
      bend = { ...bend, angle: degrees };
      return;
    }
    if (active.kind === "warp") {
      const dx = point.x - active.lastPointer.x;
      const dy = point.y - active.lastPointer.y;
      editor.setSelectedPose({
        points: applyWarp(pose.points, point, dx, dy, WARP_RADIUS),
        closed: pose.closed,
      });
      drag = { ...active, lastPointer: point };
      return;
    }
    if (active.kind === "move") {
      const dx = point.x - active.startPointer.x;
      const dy = point.y - active.startPointer.y;
      editor.setSelectedPose({
        points: translatePoints(active.startPoints, dx, dy),
        closed: pose.closed,
      });
      return;
    }
    if (active.kind === "scale") {
      const startDx = active.startPointer.x - active.anchor.x;
      const startDy = active.startPointer.y - active.anchor.y;
      let scaleX = startDx === 0 ? 1 : (point.x - active.anchor.x) / startDx;
      let scaleY = startDy === 0 ? 1 : (point.y - active.anchor.y) / startDy;
      if (event.shiftKey) {
        const uniform = Math.abs(scaleX) > Math.abs(scaleY) ? scaleX : scaleY;
        scaleX = uniform;
        scaleY = uniform;
      }
      scaleX = Math.max(0.05, Math.abs(scaleX)) * Math.sign(scaleX || 1);
      scaleY = Math.max(0.05, Math.abs(scaleY)) * Math.sign(scaleY || 1);
      editor.setSelectedPose({
        points: scalePointsAbout(
          active.startPoints,
          active.anchor,
          scaleX,
          scaleY,
        ),
        closed: pose.closed,
      });
      return;
    }
    if (active.kind === "rotate") {
      const angle =
        (Math.atan2(point.y - active.center.y, point.x - active.center.x) -
          active.startAngle) *
        (180 / Math.PI);
      const snapped = event.shiftKey ? Math.round(angle / 15) * 15 : angle;
      editor.setSelectedPose({
        points: rotatePointsAbout(active.startPoints, active.center, snapped),
        closed: pose.closed,
      });
      return;
    }
  }

  function handlePointerUp(event: PointerEvent) {
    const active = drag;
    drag = { kind: "none" };
    releasePointer(event);
    if (active.kind === "draw") {
      if (pose.points.length < 3) {
        editor.undo();
        return;
      }
      editor.tool = "select";
      return;
    }
    if (active.kind === "lasso") {
      if (bend.lasso.length < 3) {
        bend = { ...bend, lasso: [] };
        return;
      }
      const weights = makeBendWeights(pose.points, bend.lasso, pose.closed);
      if (!weights.length) {
        bend = { ...bend, lasso: [] };
        return;
      }
      bend = { ...bend, weights, step: "pivot" };
      return;
    }
  }

  function handlePointerLeave() {
    warpPointer = undefined;
  }

  function handleStageKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (editor.tool === "bend" && bend.step !== "lasso") {
      resetBend();
    }
  }

  function toggleClosed() {
    editor.updateSelectedPose((current) => ({
      points: clonePoints(current.points),
      closed: !current.closed,
    }));
  }

  const cursor = $derived.by(() => {
    if (!editable) return "default";
    if (editor.tool === "draw" || editor.tool === "bend") return "crosshair";
    if (editor.tool === "warp") return "none";
    if (drag.kind === "move") return "grabbing";
    return "grab";
  });

  const handleSize = 11;
  const pad = 14;
  /** Flip the rotate handle below the box when the shape sits near the top. */
  const rotateBelow = $derived(bounds.minY - pad - 42 < 56);
  const rotateY = $derived(
    rotateBelow ? bounds.maxY + pad + 34 : bounds.minY - pad - 34,
  );
</script>

<svelte:window onkeydown={handleStageKeydown} />

<div
  class="stage"
  style={`--paper:${editor.paperColor};--ink:${editor.inkColor}`}
>
  <div class="tool-rail" role="toolbar" aria-label="Canvas tools">
    <div class="tool-cluster">
      {#each tools as item}
        <button
          class:active={editor.tool === item.value}
          type="button"
          aria-pressed={editor.tool === item.value}
          title={`${item.label} (${item.keys})`}
          onclick={() => (editor.tool = item.value)}
        >
          <span class="tool-mark" aria-hidden="true">{item.mark}</span>
          <span class="tool-name">{item.label}</span>
        </button>
      {/each}
    </div>
    <i class="rail-rule" aria-hidden="true"></i>
    <div class="tool-cluster">
      <button
        class:active={pose.closed}
        type="button"
        aria-pressed={pose.closed}
        title="Close the shape into a loop"
        onclick={toggleClosed}
      >
        <span class="tool-mark" aria-hidden="true">◌</span>
        <span class="tool-name">Closed</span>
      </button>
      <button
        class:active={editor.showGuide}
        type="button"
        aria-pressed={editor.showGuide}
        title="Show the shape guide"
        onclick={() => (editor.showGuide = !editor.showGuide)}
      >
        <span class="tool-mark" aria-hidden="true">┄</span>
        <span class="tool-name">Guide</span>
      </button>
      {#if editor.animated}
        <button
          class:active={editor.showOnion}
          type="button"
          aria-pressed={editor.showOnion}
          title="Ghost the neighboring poses"
          onclick={() => (editor.showOnion = !editor.showOnion)}
        >
          <span class="tool-mark" aria-hidden="true">◎</span>
          <span class="tool-name">Ghosts</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="canvas-wrap">
    <svg
      bind:this={svgElement}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Concrete poetry canvas"
      style={`cursor:${cursor}`}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      onpointerleave={handlePointerLeave}
    >
      <rect width={WIDTH} height={HEIGHT} fill={editor.paperColor} />

      {#each onionPoses as onion}
        <path
          class={`onion onion-${onion.tone}`}
          d={onion.path}
          data-editor-guide="true"
          aria-hidden="true"
        />
      {/each}

      {#each frame.placements as placement (placement.index)}
        <g
          transform={`translate(${placement.x.toFixed(2)} ${placement.y.toFixed(2)}) rotate(${placement.angle.toFixed(2)}) scale(${(placement.scale ?? 1).toFixed(3)})`}
          opacity={(placement.opacity ?? 1).toFixed(3)}
        >
          <text
            class="poetry-token"
            x="0"
            y="0"
            fill={editor.inkColor}
            font-family={editor.fontFamily}
            font-size={editor.fontSize}
            text-anchor="middle"
            dominant-baseline="middle">{placement.text}</text
          >
        </g>
      {/each}

      {#if editor.showGuide && pathData}
        <g data-editor-guide="true" aria-hidden="true">
          <path
            d={pathData}
            fill="none"
            stroke={editor.inkColor}
            stroke-width="1.5"
            stroke-dasharray="5 7"
            opacity="0.26"
          />
        </g>
      {/if}

      {#if editable && editor.tool === "select"}
        <g data-editor-guide="true" class="transform-box" aria-hidden="true">
          <rect
            x={bounds.minX - pad}
            y={bounds.minY - pad}
            width={bounds.width + pad * 2}
            height={bounds.height + pad * 2}
          />
          <line
            x1={bounds.minX + bounds.width / 2}
            y1={rotateBelow ? bounds.maxY + pad : bounds.minY - pad}
            x2={bounds.minX + bounds.width / 2}
            y2={rotateBelow ? bounds.maxY + pad + 26 : bounds.minY - pad - 26}
          />
        </g>
        {#each [{ corner: "nw", x: bounds.minX - pad, y: bounds.minY - pad }, { corner: "ne", x: bounds.maxX + pad, y: bounds.minY - pad }, { corner: "sw", x: bounds.minX - pad, y: bounds.maxY + pad }, { corner: "se", x: bounds.maxX + pad, y: bounds.maxY + pad }] as handle}
          <rect
            class="scale-handle"
            role="presentation"
            x={handle.x - handleSize / 2}
            y={handle.y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            style={`cursor:${handle.corner === "nw" || handle.corner === "se" ? "nwse-resize" : "nesw-resize"}`}
            onpointerdown={(event) =>
              startScale(event, handle.corner as "nw" | "ne" | "sw" | "se")}
          />
        {/each}
        <circle
          class="rotate-handle"
          role="presentation"
          cx={bounds.minX + bounds.width / 2}
          cy={rotateY}
          r="8"
          onpointerdown={startRotate}
        />
      {/if}

      {#if editable && editor.tool === "bend"}
        <g data-editor-guide="true" class="bend-guide" aria-hidden="true">
          {#if bend.lasso.length > 1}
            <path d={pointsToPath(bend.lasso, bend.step !== "lasso")} />
          {/if}
          {#if bend.step !== "lasso" && bend.weights.length}
            {#each pose.points as point, index}
              {#if (bend.weights[index] ?? 0) > 0.02}
                <circle
                  class="bend-point"
                  cx={point.x}
                  cy={point.y}
                  r={2 + (bend.weights[index] ?? 0) * 2.4}
                  opacity={0.25 + (bend.weights[index] ?? 0) * 0.65}
                />
              {/if}
            {/each}
          {/if}
          {#if bend.pivot}
            <circle
              class="bend-pivot"
              cx={bend.pivot.x}
              cy={bend.pivot.y}
              r="8"
            />
            <path
              d={`M ${bend.pivot.x - 15} ${bend.pivot.y} L ${bend.pivot.x + 15} ${bend.pivot.y} M ${bend.pivot.x} ${bend.pivot.y - 15} L ${bend.pivot.x} ${bend.pivot.y + 15}`}
            />
          {/if}
        </g>
      {/if}

      {#if editable && editor.tool === "warp" && warpPointer}
        <circle
          data-editor-guide="true"
          class="warp-brush"
          aria-hidden="true"
          cx={warpPointer.x}
          cy={warpPointer.y}
          r={WARP_RADIUS}
        />
      {/if}
    </svg>

    {#if hint}
      <p class="stage-hint" aria-live="polite">{hint}</p>
    {/if}
  </div>
</div>

<style>
  .stage {
    position: relative;
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
  }

  .tool-rail {
    position: absolute;
    z-index: 4;
    top: 14px;
    left: 50%;
    display: flex;
    align-items: stretch;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--poetry-chrome-panel);
    background: rgba(21, 21, 20, 0.92);
    color: var(--poetry-stage-ink, #eeeae0);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
    transform: translateX(-50%);
  }

  .tool-cluster {
    display: flex;
    gap: 2px;
  }

  .rail-rule {
    width: 1px;
    margin: 4px 3px;
    background: var(--poetry-chrome-divider);
  }

  .tool-rail button {
    display: flex;
    min-width: 46px;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    border: 0;
    padding: 4px 7px 3px;
    background: transparent;
    color: var(--poetry-chrome-muted);
    cursor: pointer;
  }

  .tool-rail button:hover {
    background: var(--poetry-chrome-hover);
    color: var(--poetry-stage-ink);
  }

  .tool-rail button.active {
    background: var(--poetry-chrome-active);
    color: var(--color-orange-std, #f4845f);
  }

  .tool-mark {
    font-size: 0.95rem;
    line-height: 1;
  }

  .tool-name {
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.6rem;
    letter-spacing: 0.02em;
  }

  .canvas-wrap {
    position: relative;
    display: flex;
    min-height: 0;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: 20px 20px 12px;
  }

  svg {
    max-width: 100%;
    max-height: 100%;
    aspect-ratio: 900 / 650;
    border: 1px solid var(--poetry-chrome-panel);
    background: var(--paper);
    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.4);
    touch-action: none;
  }

  .poetry-token {
    user-select: none;
  }

  .onion {
    fill: none;
    stroke-width: 1.6;
    stroke-dasharray: 3 6;
    pointer-events: none;
  }

  .onion-before {
    stroke: var(--color-blue-std, #118ab2);
    opacity: 0.4;
  }

  .onion-after {
    stroke: #f4845f;
    opacity: 0.4;
  }

  .transform-box rect {
    fill: none;
    stroke: rgba(17, 138, 178, 0.85);
    stroke-width: 1.2;
    stroke-dasharray: 4 4;
    pointer-events: none;
  }

  .transform-box line {
    stroke: rgba(17, 138, 178, 0.85);
    stroke-width: 1.2;
    pointer-events: none;
  }

  .scale-handle {
    fill: var(--paper);
    stroke: rgba(17, 138, 178, 0.95);
    stroke-width: 1.4;
  }

  .rotate-handle {
    fill: var(--paper);
    stroke: rgba(17, 138, 178, 0.95);
    stroke-width: 1.4;
    cursor: grab;
  }

  .bend-guide path {
    fill: rgba(17, 138, 178, 0.08);
    stroke: var(--color-blue-std, #118ab2);
    stroke-width: 1.6;
    stroke-dasharray: 4 5;
    pointer-events: none;
  }

  .bend-guide .bend-point {
    fill: var(--color-blue-std, #118ab2);
    stroke: none;
    pointer-events: none;
  }

  .bend-guide .bend-pivot {
    fill: rgba(240, 239, 233, 0.9);
    stroke: var(--color-blue-std, #118ab2);
    stroke-width: 2;
    pointer-events: none;
  }

  .warp-brush {
    fill: rgba(17, 138, 178, 0.06);
    stroke: rgba(17, 138, 178, 0.6);
    stroke-width: 1.2;
    stroke-dasharray: 3 5;
    pointer-events: none;
  }

  @media (max-width: 1080px) {
    .tool-rail {
      max-width: calc(100% - 24px);
      overflow-x: auto;
    }

    .tool-name {
      display: none;
    }

    .tool-rail button {
      min-width: 36px;
      padding: 6px 8px;
    }
  }

  .stage-hint {
    position: absolute;
    bottom: 18px;
    left: 50%;
    margin: 0;
    padding: 4px 10px;
    border: 1px solid var(--poetry-chrome-panel);
    background: rgba(21, 21, 20, 0.88);
    color: var(--poetry-stage-ink);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.68rem;
    letter-spacing: 0.02em;
    transform: translateX(-50%);
    pointer-events: none;
    white-space: nowrap;
  }
</style>
