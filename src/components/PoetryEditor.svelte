<script lang="ts">
  import { onMount } from "svelte";
  import { editor } from "../lib/poetry/editorState.svelte";
  import {
    animatedExportMarkup,
    staticExportMarkup,
    type ExportStyle,
  } from "../lib/poetry/export";
  import { makeCircle, makeHeart } from "../lib/poetry/geometry";
  import { translatePoints } from "../lib/poetry/tools";
  import { HEIGHT, WIDTH, type Point } from "../lib/poetry/types";
  import ImageShapeTool from "./poetry/ImageShapeTool.svelte";
  import Stage from "./poetry/Stage.svelte";
  import Timeline from "./poetry/Timeline.svelte";

  let imageToolOpen = $state(false);
  let lastNudgeAt = 0;
  let copied = $state(false);
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  const layouts = [
    { value: "outline", label: "Outline", mark: "○" },
    { value: "fill", label: "Fill", mark: "●" },
  ] as const;

  const units = [
    { value: "phrase", label: "Phrase" },
    { value: "word", label: "Words" },
    { value: "letter", label: "Letters" },
  ] as const;

  const orientations = [
    { value: "follow", label: "Follow" },
    { value: "upright", label: "Upright" },
    { value: "radial", label: "Outward" },
  ] as const;

  const typefaces = [
    { value: "Georgia, serif", label: "Georgia" },
    { value: '"Times New Roman", Times, serif', label: "Times" },
    { value: "Arial, sans-serif", label: "Arial" },
    { value: '"Courier New", monospace', label: "Mono" },
  ] as const;

  const characterCount = $derived(Array.from(editor.poem).length);

  const exportStyle = $derived<ExportStyle>({
    inkColor: editor.inkColor,
    paperColor: editor.paperColor,
    fontFamily: editor.fontFamily,
    fontSize: editor.fontSize,
  });

  function staticMarkup() {
    return staticExportMarkup(editor.frame.placements, exportStyle);
  }

  function motionMarkup() {
    if (!editor.animated) return "";
    return animatedExportMarkup(
      editor.built.segments,
      editor.motionDoc,
      editor.built.sequenceLength,
      exportStyle,
      editor.poem,
    );
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
      new Blob([staticMarkup()], { type: "image/svg+xml;charset=utf-8" }),
      "concrete-poem.svg",
    );
  }

  function downloadAnimatedSvg() {
    const markup = motionMarkup();
    if (!markup) return;
    downloadBlob(
      new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
      "concrete-poem-motion.svg",
    );
  }

  async function downloadPng() {
    await document.fonts.ready;
    const svgBlob = new Blob([staticMarkup()], {
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
  }

  function markCopied() {
    copied = true;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => (copied = false), 1600);
  }

  async function copySvg() {
    const markup = (editor.animated ? motionMarkup() : staticMarkup()).replace(
      /^<\?xml[^>]+>\n/,
      "",
    );
    if (!markup) return;
    try {
      await navigator.clipboard.writeText(markup);
      markCopied();
    } catch {
      const field = document.createElement("textarea");
      field.value = markup;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const succeeded = document.execCommand("copy");
      field.remove();
      if (succeeded) markCopied();
    }
  }

  function useImportedShape(points: Point[]) {
    editor.updateSelectedPose(() => ({ points, closed: true }));
    editor.tool = "select";
    imageToolOpen = false;
  }

  function startDraw() {
    editor.selectKeyframe(editor.selectedKeyframeId);
    editor.tool = editor.tool === "draw" ? "select" : "draw";
  }

  function insertShape(kind: "circle" | "heart") {
    editor.selectKeyframe(editor.selectedKeyframeId);
    editor.updateSelectedPose(() => ({
      points: kind === "circle" ? makeCircle() : makeHeart(),
      closed: true,
    }));
    editor.tool = "select";
  }

  function isTypingTarget(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      (target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.isContentEditable)
    );
  }

  function nudge(dx: number, dy: number) {
    const now = Date.now();
    if (now - lastNudgeAt > 700) editor.commit();
    lastNudgeAt = now;
    const pose = editor.selectedKeyframe.pose;
    editor.setSelectedPose({
      points: translatePoints(pose.points, dx, dy),
      closed: pose.closed,
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (imageToolOpen) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "z") {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    if (isTypingTarget(event.target) || meta) return;

    switch (event.key) {
      case " ":
        event.preventDefault();
        editor.togglePlayback();
        return;
      case "v":
      case "V":
        editor.tool = "select";
        return;
      case "p":
      case "P":
        editor.tool = "draw";
        return;
      case "b":
      case "B":
        editor.tool = "bend";
        return;
      case "s":
      case "S":
        editor.tool = "warp";
        return;
      case "[":
        editor.selectKeyframeAt(editor.selectedIndex - 1);
        return;
      case "]":
        editor.selectKeyframeAt(editor.selectedIndex + 1);
        return;
      case "Escape":
        if (editor.playing) {
          editor.pause();
          editor.selectKeyframe(editor.selectedKeyframeId);
        }
        return;
      case "Backspace":
      case "Delete":
        if (editor.animated) {
          editor.deleteKeyframe(editor.selectedKeyframeId);
        }
        return;
      case "ArrowUp":
        event.preventDefault();
        nudge(0, event.shiftKey ? -10 : -1);
        return;
      case "ArrowDown":
        event.preventDefault();
        nudge(0, event.shiftKey ? 10 : 1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        nudge(event.shiftKey ? -10 : -1, 0);
        return;
      case "ArrowRight":
        event.preventDefault();
        nudge(event.shiftKey ? 10 : 1, 0);
        return;
    }
  }

  onMount(() => {
    editor.loadSaved();
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    editor.reducedMotion = query.matches;
    const listener = (event: MediaQueryListEvent) => {
      editor.reducedMotion = event.matches;
      if (event.matches) editor.pause();
    };
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

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
    <header class="editor-header">
      <div class="editor-brand">
        <h1 class="editor-title">
          <span>Concrete</span>
          <em>Poetry</em>
        </h1>
        <a class="editor-byline" href="/"
          >by <span class="editor-byline-jp">劉元明</span> · JML</a
        >
      </div>
      <div class="header-middle">
        <button
          type="button"
          class="history-button"
          disabled={!editor.canUndo}
          title="Undo (⌘Z)"
          aria-label="Undo"
          onclick={() => editor.undo()}>↶</button
        >
        <button
          type="button"
          class="history-button"
          disabled={!editor.canRedo}
          title="Redo (⇧⌘Z)"
          aria-label="Redo"
          onclick={() => editor.redo()}>↷</button
        >
        <button
          type="button"
          class="reset-button"
          title="Start over with a fresh document (undoable)"
          onclick={() => editor.reset()}>Reset</button
        >
      </div>
      <div class="export-actions">
        <button type="button" onclick={copySvg}
          >{copied
            ? "Copied ✓"
            : editor.animated
              ? "Copy motion embed"
              : "Copy embed"}</button
        >
        <button type="button" onclick={downloadPng}>PNG</button>
        {#if editor.animated}
          <button type="button" onclick={downloadSvg}>Static SVG</button>
          <button class="primary" type="button" onclick={downloadAnimatedSvg}
            >Motion SVG ↘</button
          >
        {:else}
          <button class="primary" type="button" onclick={downloadSvg}
            >Download SVG ↘</button
          >
        {/if}
      </div>
    </header>

    <aside class="control-panel" aria-label="Poetry controls">
      <section class="control-section words-section">
        <div class="section-heading">
          <h2>Words</h2>
          <small
            >{characterCount}
            {characterCount === 1 ? "letter" : "letters"}</small
          >
        </div>
        <textarea
          bind:value={editor.poem}
          aria-label="Poem text"
          spellcheck="true"
          onfocus={() => editor.commit()}
          oninput={() => editor.scheduleSave()}></textarea>
      </section>

      <section class="control-section shape-section">
        <div class="section-heading">
          <h2>Shape</h2>
        </div>
        <div class="segmented" aria-label="Shape source">
          <button
            class:active={editor.tool === "draw"}
            aria-pressed={editor.tool === "draw"}
            title="Draw the shape by hand (P)"
            onclick={startDraw}
            type="button"
          >
            <span>✎</span>
            Draw
          </button>
          <button
            title="Replace with a circle"
            onclick={() => insertShape("circle")}
            type="button"
          >
            <span>○</span>
            Circle
          </button>
          <button
            title="Replace with a heart"
            onclick={() => insertShape("heart")}
            type="button"
          >
            <span>♡</span>
            Heart
          </button>
          <button
            title="Trace a shape from a photo"
            onclick={() => (imageToolOpen = true)}
            type="button"
          >
            <span>▧</span>
            Image
          </button>
        </div>
      </section>

      <section class="control-section build-section">
        <div class="section-heading">
          <h2>Build</h2>
        </div>
        <div class="segmented two-up" aria-label="Text placement">
          {#each layouts as option}
            <button
              class:active={editor.layout === option.value}
              aria-pressed={editor.layout === option.value}
              onclick={() => {
                editor.commit();
                editor.layout = option.value;
              }}
              type="button"
            >
              <span>{option.mark}</span>
              {option.label}
            </button>
          {/each}
        </div>

        <span class="control-label" id="unit-label">Use text as</span>
        <div class="segmented" aria-labelledby="unit-label">
          {#each units as option}
            <button
              class:active={editor.unit === option.value}
              aria-pressed={editor.unit === option.value}
              onclick={() => {
                editor.commit();
                editor.unit = option.value;
              }}
              type="button"
            >
              {option.label}
            </button>
          {/each}
        </div>

        <span class="control-label" id="orientation-label">Direction</span>
        <div class="segmented" aria-labelledby="orientation-label">
          {#each orientations as option}
            <button
              class:active={editor.orientation === option.value}
              aria-pressed={editor.orientation === option.value}
              onclick={() => {
                editor.commit();
                editor.orientation = option.value;
              }}
              type="button"
            >
              {option.label}
            </button>
          {/each}
        </div>

        <span class="control-label" id="typeface-label">Typeface</span>
        <div class="segmented" aria-labelledby="typeface-label">
          {#each typefaces as option}
            <button
              class:active={editor.fontFamily === option.value}
              aria-pressed={editor.fontFamily === option.value}
              style={`font-family:${option.value}`}
              onclick={() => {
                editor.commit();
                editor.fontFamily = option.value;
              }}
              type="button"
            >
              {option.label}
            </button>
          {/each}
        </div>

        <label class="range-row">
          <span>Type size <output>{editor.fontSize}px</output></span>
          <input
            type="range"
            min="10"
            max="52"
            step="1"
            bind:value={editor.fontSize}
            onpointerdown={() => editor.commit()}
          />
        </label>
        <label class="range-row">
          <span>Spacing <output>{editor.spacing}px</output></span>
          <input
            type="range"
            min="0"
            max="36"
            step="1"
            bind:value={editor.spacing}
            onpointerdown={() => editor.commit()}
          />
        </label>
      </section>

      <section class="control-section paper-section">
        <div class="section-heading">
          <h2>Paper</h2>
        </div>
        <div class="color-controls" role="group" aria-label="Poem colors">
          <label class="color-control">
            <span>Ink</span>
            <input
              type="color"
              aria-label="Ink color"
              bind:value={editor.inkColor}
              onpointerdown={() => editor.commit()}
            />
            <span
              class="color-swatch"
              style={`--swatch-color: ${editor.inkColor}`}
              aria-hidden="true"
            ></span>
          </label>
          <label class="color-control">
            <span>Paper</span>
            <input
              type="color"
              aria-label="Paper color"
              bind:value={editor.paperColor}
              onpointerdown={() => editor.commit()}
            />
            <span
              class="color-swatch"
              style={`--swatch-color: ${editor.paperColor}`}
              aria-hidden="true"
            ></span>
          </label>
        </div>
        {#if editor.animated}
          <p class="pose-note">
            Editing pose {String.fromCharCode(65 + editor.selectedIndex)} of
            {editor.keyframes.length} · <kbd>[</kbd> and <kbd>]</kbd> to switch
          </p>
        {/if}
        {#if editor.reducedMotion}
          <p class="pose-note">
            Your device requests reduced motion; exported embeds will respect
            that setting.
          </p>
        {/if}
      </section>
    </aside>

    <section class="stage-panel" aria-label="Poetry canvas">
      <Stage />
      <Timeline />
    </section>
  </main>

  {#if imageToolOpen}
    <ImageShapeTool
      onUseShape={useImportedShape}
      onClose={() => (imageToolOpen = false)}
    />
  {/if}
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    overflow: hidden;
    overscroll-behavior: none;
  }

  .poetry-app :global(button),
  .poetry-app :global(textarea),
  .poetry-app :global(input) {
    font: inherit;
  }

  .poetry-app :global(button) {
    color: inherit;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .poetry-app {
    --poetry-paper: #f0efe9;
    --poetry-stage: #191918;
    --poetry-image-workspace: #d9d9d3;
    --poetry-stage-ink: #eeeae0;
    --poetry-raised: rgba(255, 255, 255, 0.38);
    --poetry-rule: #242424;
    --poetry-rule-mid: rgba(36, 36, 36, 0.4);
    --poetry-rule-soft: rgba(36, 36, 36, 0.2);
    --poetry-muted: rgba(36, 36, 36, 0.68);
    --poetry-focus: var(--color-red-std);
    --poetry-primary: var(--color-orange-std);
    /* Dark-chrome scale shared by the header, tool rail, and timeline. */
    --poetry-chrome-muted: rgba(238, 234, 224, 0.7);
    --poetry-chrome-faint: rgba(238, 234, 224, 0.55);
    --poetry-chrome-rule: rgba(238, 234, 224, 0.35);
    --poetry-chrome-hairline: rgba(238, 234, 224, 0.25);
    --poetry-chrome-divider: rgba(238, 234, 224, 0.18);
    --poetry-chrome-panel: rgba(238, 234, 224, 0.16);
    --poetry-chrome-hover: rgba(255, 255, 255, 0.07);
    --poetry-chrome-active: rgba(244, 132, 95, 0.16);
    isolation: isolate;
    height: 100vh;
    overflow: hidden;
    background: var(--poetry-paper);
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

  .editor-shell {
    display: grid;
    grid-template-columns: minmax(280px, 304px) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    height: 100vh;
    min-height: 0;
    background: var(--poetry-stage);
  }

  .editor-header {
    position: relative;
    grid-column: 1 / -1;
    display: flex;
    min-width: 0;
    min-height: 52px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 7px 14px 6px 16px;
    background: var(--poetry-stage);
    color: var(--poetry-stage-ink);
  }

  .editor-brand {
    position: relative;
    z-index: 1;
    min-width: 0;
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1;
  }

  .editor-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    font-size: clamp(1.25rem, 1.8vw, 1.5rem);
    font-weight: 400;
    letter-spacing: -0.045em;
  }

  .editor-title em {
    font-weight: 200;
  }

  .editor-byline {
    margin-top: 3px;
    color: rgba(238, 234, 224, 0.58);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.625rem;
    letter-spacing: 0.1em;
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

  .header-middle {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  .header-middle .history-button {
    display: grid;
    width: 26px;
    min-height: 28px;
    place-items: center;
    border: 0;
    border-bottom: 1px solid var(--poetry-chrome-rule);
    background: transparent;
    color: var(--poetry-stage-ink);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .header-middle .history-button:hover:not(:disabled) {
    background: var(--poetry-chrome-hover);
    color: var(--color-red-std);
  }

  .header-middle .history-button:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .header-middle .reset-button {
    min-height: 28px;
    margin-left: 4px;
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

  .header-middle .reset-button:hover {
    background: var(--poetry-chrome-hover);
    color: var(--color-red-std);
  }

  .export-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .export-actions button {
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

  .export-actions button:hover {
    background: var(--poetry-chrome-hover);
    color: var(--color-red-std);
  }

  .export-actions button.primary {
    border-bottom-color: transparent;
    padding-right: 10px;
    padding-left: 10px;
    background: var(--color-orange-std);
    color: #191918;
    font-weight: 600;
  }

  .export-actions button.primary:hover {
    background: var(--color-yellow-std);
    color: #191918;
  }

  .control-panel {
    grid-column: 1;
    grid-row: 2;
    min-height: 0;
    margin: 10px 8px 12px 12px;
    overflow-y: auto;
    border: 1px solid rgba(36, 36, 36, 0.72);
    background: var(--poetry-paper);
    color: var(--color-dark);
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18);
    scrollbar-color: rgba(36, 36, 36, 0.42) transparent;
    scrollbar-width: thin;
  }

  .control-panel::-webkit-scrollbar {
    width: 6px;
  }

  .control-panel::-webkit-scrollbar-thumb {
    background: rgba(36, 36, 36, 0.42);
  }

  .control-section {
    --section-accent: var(--color-red-std);
    padding: 11px 14px 12px;
    border-bottom: 1px solid var(--poetry-rule-soft);
  }

  .words-section {
    padding-top: 14px;
  }

  .shape-section {
    --section-accent: var(--color-orange-std);
  }

  .build-section {
    --section-accent: var(--color-yellow-std);
  }

  .paper-section {
    --section-accent: var(--color-blue-std);
    border-bottom: 0;
  }

  .section-heading {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    margin-bottom: 6px;
  }

  .section-heading small,
  .control-label,
  .range-row > span {
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.675rem;
    letter-spacing: 0.065em;
    text-transform: uppercase;
  }

  .section-heading small {
    color: var(--section-accent);
    font-weight: 600;
  }

  .section-heading h2 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: 1.2rem;
    font-weight: 400;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .section-heading h2::before {
    content: "";
    width: 18px;
    height: 3px;
    flex: 0 0 18px;
    background: var(--section-accent);
    filter: blur(0.2px);
  }

  textarea {
    width: 100%;
    min-height: 66px;
    max-height: 112px;
    resize: vertical;
    border: 1px solid var(--poetry-rule-mid);
    padding: 7px 8px;
    background: var(--poetry-raised);
    color: var(--color-dark);
    font-size: 0.94rem;
    line-height: 1.3;
    outline: none;
  }

  textarea:focus-visible {
    border-color: var(--poetry-focus);
  }

  .control-label {
    display: block;
    margin: 10px 0 4px;
    color: var(--poetry-muted);
  }

  .segmented {
    display: flex;
    border: 1px solid var(--poetry-rule-mid);
  }

  .segmented button {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 0;
    padding: 7px 4px;
    background: transparent;
    font-size: 0.78rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .segmented button + button {
    border-left: 1px solid var(--poetry-rule-soft);
  }

  .segmented button:hover {
    background: rgba(255, 209, 102, 0.2);
  }

  .segmented button.active {
    background: var(--poetry-rule);
    color: var(--poetry-paper);
  }

  .segmented.two-up {
    margin-bottom: 2px;
  }

  .range-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 10px;
  }

  .range-row > span {
    display: flex;
    justify-content: space-between;
    color: var(--poetry-muted);
  }

  .range-row output {
    color: var(--color-dark);
    font-weight: 600;
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--color-orange-std);
  }

  .color-controls {
    display: flex;
    gap: 16px;
  }

  .color-control {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.675rem;
    letter-spacing: 0.065em;
    text-transform: uppercase;
  }

  .color-control input[type="color"] {
    position: absolute;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .color-swatch {
    width: 26px;
    height: 18px;
    border: 1px solid var(--poetry-rule-mid);
    background: var(--swatch-color);
  }

  .color-control:hover .color-swatch {
    border-color: var(--poetry-rule);
  }

  .pose-note {
    margin: 12px 0 0;
    color: var(--poetry-muted);
    font-size: 0.74rem;
    line-height: 1.45;
  }

  .pose-note kbd {
    padding: 1px 4px;
    border: 1px solid var(--poetry-rule-mid);
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.62rem;
  }

  .stage-panel {
    grid-column: 2;
    grid-row: 2;
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
  }

  :global(button:focus-visible),
  :global(input:focus-visible),
  .editor-byline:focus-visible {
    outline: 2px solid var(--color-red-std);
    outline-offset: 1px;
  }

  @media (max-width: 860px) {
    .editor-header {
      flex-wrap: wrap;
      row-gap: 6px;
    }

    .editor-shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto minmax(0, 1fr);
      height: 100dvh;
      overflow-y: auto;
    }

    .control-panel {
      grid-column: 1;
      grid-row: 2;
      max-height: 42vh;
      margin: 10px 12px 0;
    }

    .stage-panel {
      grid-column: 1;
      grid-row: 3;
      min-height: 480px;
    }
  }
</style>
