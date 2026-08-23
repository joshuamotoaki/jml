<script lang="ts">
  type Point = { x: number; y: number };
  type Layout = "outline" | "fill" | "columns";
  type Unit = "phrase" | "word" | "letter";
  type Orientation = "follow" | "upright" | "radial";
  type Placement = Point & { text: string; angle: number; index: number };

  const WIDTH = 900;
  const HEIGHT = 650;

  const layouts: { value: Layout; label: string; mark: string }[] = [
    { value: "outline", label: "Outline", mark: "○" },
    { value: "fill", label: "Fill", mark: "●" },
    { value: "columns", label: "Columns", mark: "↕" },
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
  $: characterCount = Array.from(poem).length;

  function getTokens(value: string, selectedUnit: Unit) {
    const cleaned = value.replace(/\s+/g, " ").trim() || "word";
    if (selectedUnit === "letter")
      return Array.from(cleaned.replace(/ /g, " · "));
    if (selectedUnit === "word") return cleaned.split(" ").filter(Boolean);
    return value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
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

  function makeWave(): Point[] {
    return Array.from({ length: 140 }, (_, index) => {
      const ratio = index / 139;
      return {
        x: 85 + ratio * 730,
        y: 325 + Math.sin(ratio * Math.PI * 4) * 145,
      };
    });
  }

  function makeSpiral(): Point[] {
    return Array.from({ length: 180 }, (_, index) => {
      const ratio = index / 179;
      const angle = ratio * Math.PI * 6 - Math.PI / 2;
      const radius = 18 + ratio * 245;
      return {
        x: 450 + Math.cos(angle) * radius,
        y: 325 + Math.sin(angle) * radius,
      };
    });
  }

  function makeBird(): Point[] {
    const anchors: Point[] = [
      { x: 450, y: 298 },
      { x: 385, y: 252 },
      { x: 300, y: 205 },
      { x: 155, y: 176 },
      { x: 260, y: 282 },
      { x: 170, y: 402 },
      { x: 330, y: 343 },
      { x: 450, y: 486 },
      { x: 570, y: 343 },
      { x: 730, y: 402 },
      { x: 640, y: 282 },
      { x: 745, y: 176 },
      { x: 600, y: 205 },
      { x: 515, y: 252 },
    ];

    return densify(anchors, 9, true);
  }

  function densify(source: Point[], steps: number, closed: boolean) {
    const result: Point[] = [];
    const segmentCount = closed ? source.length : source.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const start = source[index];
      const end = source[(index + 1) % source.length];
      for (let step = 0; step < steps; step += 1) {
        const ratio = step / steps;
        result.push({
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
        });
      }
    }
    if (!closed) result.push(source[source.length - 1]);
    return result;
  }

  function applyPreset(name: "circle" | "heart" | "wave" | "spiral" | "bird") {
    previousPoints = points;
    drawing = false;
    if (name === "circle") points = makeCircle();
    if (name === "heart") points = makeHeart();
    if (name === "wave") points = makeWave();
    if (name === "spiral") points = makeSpiral();
    if (name === "bird") points = makeBird();
    closePath = name !== "wave" && name !== "spiral";
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

  function tokenWidth(text: string, size: number) {
    return Math.max(size * 0.62, Array.from(text).length * size * 0.54);
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
      while (cursor < total - size * 0.25 && index < 700) {
        const text = sourceTokens[index % sourceTokens.length];
        const width = tokenWidth(text, size);
        const pathPoint = pointOnPath(segments, cursor + width / 2);
        result.push({
          ...pathPoint.point,
          text,
          angle: placementAngle(
            selectedOrientation,
            pathPoint.angle,
            pathPoint.point,
            center,
            selectedLayout,
          ),
          index,
        });
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

    if (selectedLayout === "columns") {
      const columnGap = size * 1.05 + gap;
      const rowGap = size * 1.12 + gap * 0.45;
      let column = 0;
      for (let x = minX + columnGap / 2; x < maxX; x += columnGap) {
        const columnPoints: Point[] = [];
        for (let y = minY + size; y < maxY; y += rowGap) {
          const point = { x, y };
          if (!pointInPolygon(point, source)) continue;
          columnPoints.push(point);
        }
        if (column % 2 === 1) columnPoints.reverse();
        for (const point of columnPoints) {
          const text = sourceTokens[index % sourceTokens.length];
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
        column += 1;
      }
      return result;
    }

    const rowGap = size * 1.25 + gap;
    for (let y = minY + size; y < maxY; y += rowGap) {
      let x = minX + size / 2;
      while (x < maxX && index < 1200) {
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

  function startDrawing(event: PointerEvent) {
    if (!drawing) return;
    event.preventDefault();
    previousPoints = points;
    isPointerDown = true;
    svgElement.setPointerCapture(event.pointerId);
    points = [pointerPoint(event)];
  }

  function continueDrawing(event: PointerEvent) {
    if (!drawing || !isPointerDown) return;
    const point = pointerPoint(event);
    const last = points[points.length - 1];
    if (!last || distance(last, point) > 5) points = [...points, point];
  }

  function finishDrawing(event: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    if (svgElement.hasPointerCapture(event.pointerId))
      svgElement.releasePointerCapture(event.pointerId);
    drawing = false;
    if (points.length < 2) points = previousPoints;
  }

  function undoShape() {
    if (!previousPoints.length) return;
    const current = points;
    points = previousPoints;
    previousPoints = current;
  }

  function clearShape() {
    previousPoints = points;
    points = [];
    drawing = true;
  }

  function announce(message: string) {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 2400);
  }

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
    const markup = exportMarkup().replace(/^<\?xml[^>]+>\n/, "");
    try {
      await navigator.clipboard.writeText(markup);
      announce("SVG copied — paste it into HTML");
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
          ? "SVG copied — paste it into HTML"
          : "Copy was blocked — use Download SVG",
      );
    }
  }
</script>

<div class="poetry-app">
  <header class="editor-header">
    <a
      class="editor-brand"
      href="/"
      aria-label="Back to Joshua Motoaki Lau home"
    >
      <span class="brand-jp">劉元明</span>
      <span>JML</span>
    </a>
    <div class="editor-title">
      <span>Concrete</span>
      <em>Poetry</em>
    </div>
    <div class="editor-index">/poetry — 01</div>
  </header>

  <main class="editor-shell">
    <aside class="control-panel">
      <section class="control-section words-section">
        <div class="section-heading">
          <span>01</span>
          <h2>Words</h2>
          <small>{characterCount} characters</small>
        </div>
        <textarea bind:value={poem} aria-label="Poem text" spellcheck="true"
        ></textarea>
      </section>

      <section class="control-section">
        <div class="section-heading">
          <span>02</span>
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
          <label for="orientation">Direction</label>
          <select id="orientation" bind:value={orientation}>
            {#each orientations as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>

        <div class="select-row">
          <label for="font">Typeface</label>
          <select id="font" bind:value={fontFamily}>
            <option value={"Georgia, serif"}>Georgia</option>
            <option value={'"Times New Roman", Times, serif'}>Times</option>
            <option value={"Arial, sans-serif"}>Arial</option>
            <option value={'"Courier New", monospace'}>Monospace</option>
          </select>
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

      <section class="control-section">
        <div class="section-heading">
          <span>03</span>
          <h2>Shape</h2>
        </div>
        <div class="shape-grid">
          <button type="button" on:click={() => applyPreset("circle")}
            ><span>○</span>Circle</button
          >
          <button type="button" on:click={() => applyPreset("heart")}
            ><span>♡</span>Heart</button
          >
          <button type="button" on:click={() => applyPreset("bird")}
            ><span>⌁</span>Bird</button
          >
          <button type="button" on:click={() => applyPreset("wave")}
            ><span>∿</span>Wave</button
          >
          <button type="button" on:click={() => applyPreset("spiral")}
            ><span>＠</span>Spiral</button
          >
          <button
            class:active={drawing}
            type="button"
            on:click={() => (drawing = !drawing)}
          >
            <span>✎</span>{drawing ? "Drawing…" : "Draw"}
          </button>
        </div>
        <div class="toggle-row">
          <label
            ><input type="checkbox" bind:checked={closePath} /> Close shape</label
          >
          <label
            ><input type="checkbox" bind:checked={showGuide} /> Show guide</label
          >
        </div>
      </section>
    </aside>

    <section class="stage-panel" aria-label="Poetry canvas">
      <div class="stage-toolbar">
        <p>
          {drawing
            ? "Drag anywhere on the paper to draw a new path."
            : `${placements.length} pieces of text · ${layout}`}
        </p>
        <div>
          <button
            type="button"
            on:click={undoShape}
            disabled={!previousPoints.length}>Undo shape</button
          >
          <button type="button" on:click={clearShape}>Clear + draw</button>
        </div>
      </div>

      <div class:drawing class="canvas-wrap">
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

          {#each placements as placement}
            <g
              transform={`translate(${placement.x.toFixed(2)} ${placement.y.toFixed(2)}) rotate(${placement.angle.toFixed(2)})`}
            >
              <text
                class="poetry-token"
                x="0"
                y="0"
                fill={inkColor}
                font-family={fontFamily}
                font-size={fontSize}
                text-anchor="middle"
                dominant-baseline="middle">{placement.text}</text
              >
            </g>
          {/each}

          {#if showGuide && pathData}
            <g data-editor-guide="true" aria-hidden="true">
              <path
                d={pathData}
                fill="none"
                stroke={inkColor}
                stroke-width="1.5"
                stroke-dasharray="5 7"
                opacity="0.28"
              />
              {#if points[0]}
                <circle
                  cx={points[0].x}
                  cy={points[0].y}
                  r="5"
                  fill={paperColor}
                  stroke={inkColor}
                  stroke-width="1.5"
                  opacity="0.7"
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
          <button type="button" on:click={copySvg}>Copy embed</button>
          <button type="button" on:click={downloadPng}>PNG</button>
          <button class="primary" type="button" on:click={downloadSvg}
            >Download SVG ↘</button
          >
        </div>
      </div>
    </section>
  </main>

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
  select,
  input {
    font: inherit;
  }

  button {
    color: inherit;
  }

  .poetry-app {
    height: 100vh;
    overflow: hidden;
    background: var(--color-light);
    color: var(--color-dark);
  }

  .editor-header {
    height: 76px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 18px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--color-dark);
    background: var(--color-light);
  }

  .editor-brand {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: fit-content;
    color: inherit;
    text-decoration: none;
    font-size: clamp(1.9rem, 3.2vw, 2.9rem);
    letter-spacing: -0.08em;
  }

  .brand-jp {
    font-family: var(--font-noto-serif-jp);
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

  .editor-index {
    justify-self: end;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .editor-shell {
    display: grid;
    grid-template-columns: minmax(290px, 330px) minmax(0, 1fr);
    height: calc(100vh - 76px);
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
    grid-template-columns: 27px 1fr auto;
    align-items: baseline;
    margin-bottom: 7px;
  }

  .section-heading > span,
  .section-heading small,
  .control-label,
  .select-row label,
  .range-row > span,
  .toggle-row {
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.68rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .section-heading > span,
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
  select:focus-visible,
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-yellow-std);
    outline-offset: 2px;
  }

  .layout-grid,
  .shape-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid rgba(36, 36, 36, 0.5);
    border-left: 1px solid rgba(36, 36, 36, 0.5);
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

  select {
    width: 100%;
    border: 0;
    border-bottom: 1px solid rgba(36, 36, 36, 0.5);
    border-radius: 0;
    padding: 4px 21px 4px 1px;
    background: transparent;
    color: var(--color-dark);
    outline: none;
    font-size: 0.85rem;
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
    gap: 16px;
    margin-top: 9px;
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
  .export-actions button:hover,
  .export-actions button.primary {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .stage-toolbar button:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .canvas-wrap {
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

    .editor-header {
      height: 72px;
    }

    .editor-index {
      display: none;
    }

    .editor-header {
      grid-template-columns: 1fr auto;
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

    .control-section:last-child {
      grid-column: 1 / -1;
    }

    .control-section:last-child .shape-grid {
      grid-template-columns: repeat(6, 1fr);
    }

    .stage-panel {
      min-height: 620px;
    }
  }

  @media (max-width: 620px) {
    .editor-header {
      padding: 8px 11px;
    }

    .editor-title {
      flex-direction: column;
      align-items: flex-end;
      gap: 0;
      line-height: 0.9;
    }

    .control-panel {
      grid-template-columns: 1fr;
    }

    .control-section:last-child {
      grid-column: auto;
    }

    .control-section:last-child .shape-grid {
      grid-template-columns: repeat(3, 1fr);
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
</style>
