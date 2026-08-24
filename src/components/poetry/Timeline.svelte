<script lang="ts">
  import { easingCurvePath, easingOptions } from "../../lib/poetry/easing";
  import { editor } from "../../lib/poetry/editorState.svelte";
  import type {
    LoopMode,
    StaggerDirection,
    StaggerMode,
  } from "../../lib/poetry/types";

  let trackElement: HTMLDivElement | undefined = $state();
  let scrubbing = $state(false);
  let draggingKeyframeId = $state<string | null>(null);
  let dragMoved = $state(false);
  let openSegment = $state<number | null>(null);
  let flowOpen = $state(false);

  const sequenceLength = $derived(editor.built.sequenceLength);
  const currentSeconds = $derived(
    (editor.playhead / Math.max(0.0001, sequenceLength)) * editor.duration,
  );

  const loopModes: { value: LoopMode; label: string; mark: string }[] = [
    { value: "once", label: "Play once", mark: "→" },
    { value: "pingpong", label: "Back & forth", mark: "⇄" },
    { value: "cycle", label: "Cycle around", mark: "↻" },
  ];

  const staggerModes: { value: StaggerMode; label: string }[] = [
    { value: "none", label: "Together" },
    { value: "trail", label: "Trail" },
    { value: "ripple", label: "Ripple" },
  ];

  const staggerDirections: { value: StaggerDirection; label: string }[] = [
    { value: "forward", label: "Forward" },
    { value: "reverse", label: "Backward" },
    { value: "center", label: "Center" },
  ];

  function capturePointer(event: PointerEvent) {
    try {
      trackElement?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers can't be captured; drags still work via handlers.
    }
  }

  function fractionFromEvent(event: PointerEvent) {
    if (!trackElement) return 0;
    const rect = trackElement.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  }

  function positionFromEvent(event: PointerEvent) {
    return fractionFromEvent(event) * sequenceLength;
  }

  function handleTrackPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    capturePointer(event);
    scrubbing = true;
    editor.scrub(positionFromEvent(event));
  }

  function handleTrackPointerMove(event: PointerEvent) {
    if (draggingKeyframeId) {
      dragMoved = true;
      editor.moveKeyframe(draggingKeyframeId, positionFromEvent(event));
      return;
    }
    if (scrubbing) {
      editor.scrub(positionFromEvent(event));
    }
  }

  function handleTrackPointerUp(event: PointerEvent) {
    try {
      if (trackElement?.hasPointerCapture(event.pointerId)) {
        trackElement.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore synthetic pointers.
    }
    if (draggingKeyframeId) {
      const id = draggingKeyframeId;
      draggingKeyframeId = null;
      if (!dragMoved) editor.selectKeyframe(id);
      return;
    }
    scrubbing = false;
  }

  function handleKeyframePointerDown(event: PointerEvent, id: string) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    capturePointer(event);
    const index = editor.keyframes.findIndex((keyframe) => keyframe.id === id);
    const draggable = index > 0 && index < editor.keyframes.length - 1;
    dragMoved = false;
    if (draggable) {
      editor.commit();
      draggingKeyframeId = id;
    } else {
      draggingKeyframeId = id; // still tracks click-select on pointerup
    }
  }

  function segmentZones() {
    return editor.built.segments.map((segment, index) => ({
      index,
      left: (segment.start / sequenceLength) * 100,
      width: ((segment.end - segment.start) / sequenceLength) * 100,
      easing: segment.easing,
      isWrap: segment.isWrap,
    }));
  }

  function setDuration(value: number) {
    if (!Number.isFinite(value)) return;
    editor.commit();
    editor.duration = Math.max(0.3, Math.min(12, value));
  }

  function handleWindowPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element)) {
      openSegment = null;
      flowOpen = false;
      return;
    }
    if (!target.closest(".easing-popover, .segment-zone")) openSegment = null;
    if (!target.closest(".flow-popover, .flow-trigger")) flowOpen = false;
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} />

{#if !editor.animated}
  <div class="add-motion-row">
    <button
      type="button"
      class="add-motion"
      onclick={() => editor.addKeyframe()}
    >
      Add animation
    </button>
  </div>
{:else}
  <div class="timeline">
    <button
      class="play-button"
      type="button"
      aria-label={editor.playing ? "Pause (space)" : "Play (space)"}
      title={editor.playing ? "Pause (space)" : "Play (space)"}
      onclick={() => editor.togglePlayback()}
    >
      {editor.playing ? "❚❚" : "▶"}
    </button>

    <span class="time-readout"
      >{currentSeconds.toFixed(1)}s / {editor.duration.toFixed(1)}s</span
    >

    <div
      bind:this={trackElement}
      class="track"
      role="slider"
      aria-label="Timeline"
      aria-valuemin="0"
      aria-valuemax={editor.duration}
      aria-valuenow={currentSeconds}
      tabindex="-1"
      onpointerdown={handleTrackPointerDown}
      onpointermove={handleTrackPointerMove}
      onpointerup={handleTrackPointerUp}
      onpointercancel={handleTrackPointerUp}
    >
      <div class="track-rule"></div>

      {#each segmentZones() as zone (zone.index)}
        <button
          class="segment-zone"
          class:wrap={zone.isWrap}
          type="button"
          style={`left:${zone.left}%;width:${zone.width}%`}
          title={`Easing: ${zone.easing} — click to change`}
          onclick={(event) => {
            event.stopPropagation();
            openSegment = openSegment === zone.index ? null : zone.index;
          }}
          onpointerdown={(event) => event.stopPropagation()}
        >
          <svg viewBox="0 0 44 18" aria-hidden="true">
            <path d={easingCurvePath(zone.easing, 44, 18)} />
          </svg>
        </button>
        {#if openSegment === zone.index}
          <div
            class="easing-popover"
            style={`left:${zone.left + zone.width / 2}%`}
            role="menu"
            tabindex="-1"
            onpointerdown={(event) => event.stopPropagation()}
          >
            <span class="popover-title">Easing</span>
            {#each easingOptions as option}
              <button
                class:active={zone.easing === option.value}
                type="button"
                role="menuitem"
                onclick={() => {
                  editor.setEasing(zone.index, option.value);
                  openSegment = null;
                }}
              >
                <svg viewBox="0 0 36 20" aria-hidden="true">
                  <path d={easingCurvePath(option.value, 36, 20)} />
                </svg>
                <span>{option.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/each}

      {#each editor.keyframes as keyframe, index (keyframe.id)}
        <button
          class="pose-diamond"
          class:selected={keyframe.id === editor.selectedKeyframeId}
          class:draggable={index > 0 && index < editor.keyframes.length - 1}
          type="button"
          style={`left:${(keyframe.time / sequenceLength) * 100}%`}
          title={`Pose ${String.fromCharCode(65 + index)}${index > 0 && index < editor.keyframes.length - 1 ? " — drag to retime" : ""}`}
          aria-label={`Select pose ${String.fromCharCode(65 + index)}`}
          onpointerdown={(event) =>
            handleKeyframePointerDown(event, keyframe.id)}
        >
          <i aria-hidden="true"></i>
          <span>{String.fromCharCode(65 + index)}</span>
        </button>
      {/each}

      <div
        class="playhead"
        style={`left:${(editor.playhead / sequenceLength) * 100}%`}
        aria-hidden="true"
      ></div>
    </div>

    <button
      class="add-pose"
      type="button"
      title="Add a pose after the selected one"
      onclick={() => editor.addKeyframe()}
    >
      + Pose
    </button>

    <div class="timeline-settings">
      <label class="duration-field" title="Duration in seconds">
        <input
          type="number"
          min="0.3"
          max="12"
          step="0.1"
          value={editor.duration}
          onchange={(event) =>
            setDuration(
              Number((event.currentTarget as HTMLInputElement).value),
            )}
        />
        <span>s</span>
      </label>

      <div class="loop-modes" role="group" aria-label="Loop mode">
        {#each loopModes as mode}
          <button
            class:active={editor.loop === mode.value}
            type="button"
            aria-pressed={editor.loop === mode.value}
            title={mode.label}
            onclick={() => {
              editor.commit();
              editor.loop = mode.value;
            }}
          >
            {mode.mark}
          </button>
        {/each}
      </div>

      <button
        class="flow-trigger"
        class:active={flowOpen}
        type="button"
        title="Stagger and playback trigger"
        onclick={() => (flowOpen = !flowOpen)}
      >
        Flow
      </button>

      <button
        class="remove-motion"
        type="button"
        title="Remove motion, keep this pose"
        onclick={() => editor.removeMotion()}
      >
        ✕
      </button>
    </div>

    {#if flowOpen}
      <div class="flow-popover" role="dialog" aria-label="Motion flow settings">
        <div class="flow-row">
          <span class="flow-label">Text moves</span>
          <div class="flow-options">
            {#each staggerModes as mode}
              <button
                class:active={editor.stagger === mode.value}
                type="button"
                onclick={() => {
                  editor.commit();
                  editor.stagger = mode.value;
                }}>{mode.label}</button
              >
            {/each}
          </div>
        </div>
        {#if editor.stagger !== "none"}
          <div class="flow-row">
            <span class="flow-label">Order</span>
            <div class="flow-options">
              {#each staggerDirections as direction}
                <button
                  class:active={editor.staggerDirection === direction.value}
                  type="button"
                  onclick={() => {
                    editor.commit();
                    editor.staggerDirection = direction.value;
                  }}>{direction.label}</button
                >
              {/each}
            </div>
          </div>
          <div class="flow-row">
            <span class="flow-label">Spread</span>
            <input
              class="flow-slider"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={editor.staggerAmount}
              oninput={(event) =>
                (editor.staggerAmount = Number(
                  (event.currentTarget as HTMLInputElement).value,
                ))}
              onchange={() => editor.scheduleSave()}
            />
          </div>
        {/if}
        <div class="flow-row">
          <span class="flow-label">Embed plays</span>
          <div class="flow-options">
            <button
              class:active={editor.trigger === "automatic"}
              type="button"
              onclick={() => {
                editor.commit();
                editor.trigger = "automatic";
              }}>Automatically</button
            >
            <button
              class:active={editor.trigger === "hover"}
              type="button"
              onclick={() => {
                editor.commit();
                editor.trigger = "hover";
              }}>On hover</button
            >
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .timeline {
    position: relative;
    z-index: 5;
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 8px;
    margin: 0 20px 12px;
    padding: 6px 10px;
    border: 1px solid var(--poetry-chrome-panel);
    background: rgba(21, 21, 20, 0.94);
    color: var(--poetry-stage-ink, #eeeae0);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  }

  .add-motion-row {
    display: flex;
    justify-content: flex-end;
    margin: 0 20px 12px;
  }

  .add-motion-row .add-motion {
    min-height: 28px;
    border: 0;
    padding: 4px 12px 3px;
    background: var(--color-orange-std, #f4845f);
    color: #191918;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .add-motion-row .add-motion:hover {
    background: var(--color-yellow-std, #ffd166);
  }

  .timeline .play-button {
    display: grid;
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    place-items: center;
    border: 0;
    background: var(--color-orange-std, #f4845f);
    color: #191918;
    font-size: 0.7rem;
    cursor: pointer;
  }

  .timeline .play-button:hover {
    background: var(--color-yellow-std, #ffd166);
  }

  .time-readout {
    min-width: 76px;
    color: var(--poetry-chrome-faint);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.62rem;
    letter-spacing: 0.02em;
    text-align: center;
  }

  .track {
    position: relative;
    height: 36px;
    flex: 1;
    min-width: 120px;
    cursor: crosshair;
    touch-action: none;
    outline: none;
  }

  .track-rule {
    position: absolute;
    top: 50%;
    right: 0;
    left: 0;
    height: 2px;
    background: var(--poetry-chrome-hairline);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .segment-zone {
    position: absolute;
    top: 50%;
    display: grid;
    height: 26px;
    place-items: center;
    border: 0;
    background: transparent;
    transform: translateY(-50%);
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .segment-zone svg {
    width: 44px;
    height: 18px;
    max-width: 86%;
  }

  .segment-zone path {
    fill: none;
    stroke: var(--poetry-chrome-muted);
    stroke-width: 1.6;
  }

  .segment-zone:hover,
  .segment-zone:focus-visible {
    opacity: 1;
  }

  .segment-zone.wrap svg path {
    stroke-dasharray: 3 3;
  }

  .pose-diamond {
    position: absolute;
    top: 50%;
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border: 0;
    background: transparent;
    transform: translate(-50%, -50%);
    cursor: pointer;
  }

  .pose-diamond i {
    position: absolute;
    width: 12px;
    height: 12px;
    background: var(--poetry-stage-ink);
    transform: rotate(45deg);
    transition:
      background 120ms ease,
      width 120ms ease,
      height 120ms ease;
  }

  .pose-diamond span {
    position: absolute;
    top: -13px;
    color: var(--poetry-chrome-faint);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.56rem;
    letter-spacing: 0.08em;
  }

  .pose-diamond:hover i {
    width: 14px;
    height: 14px;
  }

  .pose-diamond.selected i {
    width: 14px;
    height: 14px;
    background: var(--color-orange-std, #f4845f);
  }

  .pose-diamond.selected span {
    color: var(--color-orange-std, #f4845f);
  }

  .pose-diamond.draggable {
    cursor: ew-resize;
  }

  .playhead {
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 2px;
    background: var(--color-red-std, #d94f46);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .playhead::after {
    content: "";
    position: absolute;
    top: -1px;
    left: 50%;
    border: 5px solid transparent;
    border-top-color: var(--color-red-std, #d94f46);
    transform: translateX(-50%);
  }

  .timeline .add-pose {
    flex: 0 0 auto;
    min-height: 28px;
    border: 0;
    border-bottom: 1px solid var(--poetry-chrome-rule);
    padding: 4px 7px 3px;
    background: transparent;
    color: var(--poetry-stage-ink);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.7rem;
    letter-spacing: 0.02em;
    cursor: pointer;
    white-space: nowrap;
  }

  .timeline .add-pose:hover {
    background: var(--poetry-chrome-hover);
    color: var(--color-red-std, #d94f46);
  }

  .timeline-settings {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
  }

  .duration-field {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    gap: 3px;
    border-bottom: 1px solid var(--poetry-chrome-rule);
    padding: 3px 5px 2px;
  }

  .timeline .duration-field input {
    width: 34px;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.7rem;
    text-align: right;
    outline: none;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .duration-field input::-webkit-outer-spin-button,
  .duration-field input::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }

  .duration-field span {
    color: var(--poetry-chrome-faint);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.62rem;
  }

  .loop-modes {
    display: flex;
    border: 1px solid var(--poetry-chrome-hairline);
  }

  .timeline .loop-modes button {
    display: grid;
    width: 27px;
    height: 26px;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--poetry-chrome-muted);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .loop-modes button + button {
    border-left: 1px solid var(--poetry-chrome-divider);
  }

  .loop-modes button:hover {
    color: var(--poetry-stage-ink);
  }

  .loop-modes button.active {
    background: var(--poetry-chrome-active);
    color: var(--color-orange-std, #f4845f);
  }

  .timeline .flow-trigger {
    min-height: 28px;
    border: 0;
    border-bottom: 1px solid var(--poetry-chrome-rule);
    padding: 4px 7px 3px;
    background: transparent;
    color: var(--poetry-stage-ink);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.7rem;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .timeline .flow-trigger:hover,
  .timeline .flow-trigger.active {
    background: var(--poetry-chrome-hover);
    color: var(--color-red-std, #d94f46);
  }

  .timeline .remove-motion {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--poetry-chrome-muted);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .timeline .remove-motion:hover {
    background: var(--poetry-chrome-hover);
    color: var(--color-red-std, #d94f46);
  }

  .easing-popover {
    position: absolute;
    z-index: 8;
    bottom: 40px;
    display: flex;
    flex-direction: column;
    min-width: 124px;
    padding: 5px;
    border: 1px solid var(--poetry-chrome-panel);
    background: rgba(21, 21, 20, 0.97);
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.45);
    transform: translateX(-50%);
  }

  .popover-title {
    padding: 2px 6px 6px;
    color: var(--poetry-chrome-faint);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.58rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .timeline .easing-popover button {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    padding: 4px 7px;
    background: transparent;
    color: var(--poetry-stage-ink);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.68rem;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .easing-popover button:hover {
    background: var(--poetry-chrome-hover);
  }

  .easing-popover button.active {
    color: var(--color-orange-std, #f4845f);
  }

  .easing-popover svg {
    width: 36px;
    height: 20px;
    flex: 0 0 36px;
  }

  .easing-popover path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }

  .flow-popover {
    position: absolute;
    z-index: 8;
    right: 8px;
    bottom: 52px;
    display: flex;
    width: 306px;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--poetry-chrome-panel);
    background: rgba(21, 21, 20, 0.97);
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
  }

  .flow-row {
    display: grid;
    grid-template-columns: 88px 1fr;
    align-items: center;
    gap: 8px;
  }

  .flow-label {
    color: var(--poetry-chrome-faint);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.58rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .flow-options {
    display: flex;
    border: 1px solid var(--poetry-chrome-hairline);
  }

  .timeline .flow-options button {
    flex: 1;
    border: 0;
    padding: 5px 4px;
    background: transparent;
    color: var(--poetry-chrome-muted);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.64rem;
    letter-spacing: 0.02em;
    cursor: pointer;
    white-space: nowrap;
  }

  .flow-options button + button {
    border-left: 1px solid var(--poetry-chrome-divider);
  }

  .flow-options button:hover {
    color: var(--poetry-stage-ink);
  }

  .flow-options button.active {
    background: var(--poetry-chrome-active);
    color: var(--color-orange-std, #f4845f);
  }

  .flow-slider {
    width: 100%;
    accent-color: var(--color-orange-std, #f4845f);
  }

  @media (max-width: 900px) {
    .time-readout {
      display: none;
    }
  }
</style>
