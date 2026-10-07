<script lang="ts">
  import { contours } from "d3-contour";
  import { onDestroy, tick } from "svelte";
  import { automaticMaskFromPixels } from "../../lib/poetry/imageMask";
  import {
    distance,
    pointsToPath,
    polygonArea,
    reduceNearbyPoints,
    simplifyClosedPath,
    smoothClosedPath,
  } from "../../lib/poetry/geometry";
  import { HEIGHT, WIDTH, type Point } from "../../lib/poetry/types";

  let {
    onUseShape,
    onClose,
  }: {
    onUseShape: (points: Point[], name: string) => void;
    onClose: () => void;
  } = $props();

  type SelectionTool = "keep" | "remove";
  type SelectionMethod = "none" | "alpha" | "background" | "ai";
  type SelectionStroke = {
    brushMode: 1 | 2 | 3;
    point: Point[];
    isCompleted: boolean;
  };

  let imageUrl = $state("");
  let imageName = $state("");
  let imageWidth = $state(0);
  let imageHeight = $state(0);
  let imageInputElement: HTMLInputElement;
  let selectionCanvasElement: HTMLCanvasElement | undefined = $state();
  let segmenterWorker: Worker | undefined;
  let pendingBitmap: ImageBitmap | undefined;
  let segmenterReady = $state(false);
  let segmenterImageReady = $state(false);
  let segmenterBusy = $state(false);
  let imageImporting = $state(false);
  let selectionStatus = $state("Upload an image to begin.");
  let selectionError = $state("");
  let selectionTool = $state<SelectionTool>("keep");
  let selectionStrokes = $state<SelectionStroke[]>([]);
  let activeSelectionStroke = $state<Point[]>([]);
  let selectionPointerDown = false;
  let selectionMask = $state<Float32Array | undefined>(undefined);
  let automaticSelectionMask: Float32Array | undefined;
  let automaticSelectionMethod: "alpha" | "background" | undefined;
  let selectionMethod = $state<SelectionMethod>("none");
  let selectionMaskWidth = $state(0);
  let selectionMaskHeight = $state(0);
  let selectionThreshold = $state(0.5);
  let selectionDetail = $state(8);
  let selectionSmoothness = $state(0);

  const importedMaskContour = $derived.by(() =>
    selectionMask
      ? contourFromMask(
          selectionMask,
          selectionMaskWidth,
          selectionMaskHeight,
          selectionThreshold,
        )
      : [],
  );
  const importedShapePreview = $derived.by(() =>
    fitImportedContour(
      importedMaskContour,
      selectionDetail,
      selectionSmoothness,
    ),
  );
  const importedShapePath = $derived.by(() =>
    pointsToPath(importedShapePreview, true),
  );

  $effect(() => {
    selectionMask;
    selectionThreshold;
    selectionStrokes;
    activeSelectionStroke;
    if (selectionCanvasElement) drawSelectionOverlay();
  });

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

  function ensureSegmenter() {
    if (segmenterWorker) return;
    selectionStatus = "Loading the subject selector…";
    segmenterBusy = true;
    segmenterWorker = new Worker(
      new URL("../../lib/poetry/segmenter.worker.ts", import.meta.url),
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
    const rect = selectionCanvasElement!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function startSelectionStroke(event: PointerEvent) {
    if (!segmenterImageReady || segmenterBusy || !selectionCanvasElement)
      return;
    event.preventDefault();
    selectionPointerDown = true;
    selectionCanvasElement.setPointerCapture(event.pointerId);
    activeSelectionStroke = [normalizedSelectionPoint(event)];
  }

  function continueSelectionStroke(event: PointerEvent) {
    if (!selectionPointerDown || !selectionCanvasElement) return;
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
    if (!selectionPointerDown || !selectionCanvasElement) return;
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

  function useImportedShape() {
    if (importedShapePreview.length < 3) return;
    onUseShape(
      importedShapePreview.map((point) => ({ ...point })),
      imageName || "image",
    );
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  onDestroy(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    pendingBitmap?.close();
    segmenterWorker?.postMessage({ type: "CLOSE" });
    segmenterWorker?.terminate();
  });
</script>

<div
  class="image-tool-backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
  onkeydown={handleKeydown}
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
        onclick={onClose}
        aria-label="Close image shape tool">×</button
      >
    </header>

    {#if !imageUrl}
      <button
        class="image-dropzone"
        type="button"
        disabled={imageImporting}
        onclick={() => imageInputElement.click()}
        ondragover={(event) => event.preventDefault()}
        ondrop={handleImageDrop}
      >
        <span aria-hidden="true">▧</span>
        <strong>{imageImporting ? "Opening image…" : "Choose an image"}</strong>
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
              onclick={() => imageInputElement.click()}>Replace</button
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
                onpointerdown={startSelectionStroke}
                onpointermove={continueSelectionStroke}
                onpointerup={finishSelectionStroke}
                onpointercancel={finishSelectionStroke}
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
                  aria-pressed={selectionTool === "keep"}
                  type="button"
                  onclick={() => (selectionTool = "keep")}
                >
                  <span class="keep-dot"></span>Add
                </button>
                <button
                  class:active={selectionTool === "remove"}
                  aria-pressed={selectionTool === "remove"}
                  type="button"
                  onclick={() => (selectionTool = "remove")}
                >
                  <span class="remove-dot"></span>Remove
                </button>
              </div>
              <div class="selection-actions">
                <button
                  type="button"
                  disabled={!selectionStrokes.length || segmenterBusy}
                  onclick={undoSelectionStroke}>Undo</button
                >
                <button
                  type="button"
                  disabled={!selectionStrokes.length || segmenterBusy}
                  onclick={resetSelection}>Reset</button
                >
              </div>
            {:else if selectionMethod === "alpha" || selectionMethod === "background"}
              <button
                class="ai-refine-button"
                type="button"
                disabled={segmenterBusy}
                onclick={startAiRefinement}
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
                  >Edge <output>{Math.round(selectionThreshold * 100)}%</output
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
              onclick={useImportedShape}>Use this shape →</button
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
      onchange={handleImageInput}
    />
  </section>
</div>

<style>
  .image-tool-backdrop {
    position: fixed;
    z-index: 40;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(12, 12, 11, 0.62);
    backdrop-filter: blur(3px);
  }

  .image-tool {
    display: flex;
    width: min(980px, 100%);
    max-height: min(720px, calc(100vh - 48px));
    flex-direction: column;
    border: 1px solid rgba(36, 36, 36, 0.72);
    background: var(--poetry-paper, #f0efe9);
    color: var(--color-dark, #242424);
    box-shadow: 0 26px 60px rgba(0, 0, 0, 0.45);
  }

  .image-tool.upload-only {
    width: min(520px, 100%);
  }

  .image-tool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(36, 36, 36, 0.2);
  }

  .image-tool-header h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 400;
  }

  .image-tool-header button {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border: 1px solid rgba(36, 36, 36, 0.4);
    background: transparent;
    font-size: 1.05rem;
    cursor: pointer;
  }

  .image-tool-header button:hover {
    background: rgba(36, 36, 36, 0.08);
  }

  .image-dropzone {
    display: flex;
    min-height: 200px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    margin: 16px;
    border: 1.5px dashed rgba(36, 36, 36, 0.45);
    background: rgba(255, 255, 255, 0.4);
    cursor: pointer;
  }

  .image-dropzone:hover {
    border-color: var(--color-orange-std, #f4845f);
    background: rgba(244, 132, 95, 0.07);
  }

  .image-dropzone span {
    font-size: 1.7rem;
  }

  .image-dropzone strong {
    font-size: 1rem;
    font-weight: 500;
  }

  .image-dropzone small {
    color: rgba(36, 36, 36, 0.6);
    font-size: 0.75rem;
  }

  .model-status {
    margin: 0 16px 14px;
    font-size: 0.8rem;
  }

  .model-status.error {
    color: #b3261e;
  }

  .image-tool-body {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(0, 1fr) 265px;
    gap: 0;
  }

  .selection-workspace {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    padding: 12px 14px 12px 16px;
  }

  .selection-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 0.78rem;
  }

  .selection-toolbar strong {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selection-toolbar button {
    border: 1px solid rgba(36, 36, 36, 0.4);
    padding: 4px 10px;
    background: transparent;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .selection-toolbar button:hover {
    background: rgba(36, 36, 36, 0.08);
  }

  .subject-stage {
    display: flex;
    min-height: 0;
    flex: 1;
    align-items: center;
    justify-content: center;
    background: var(--poetry-image-workspace, #d9d9d3);
  }

  .subject-image {
    position: relative;
    max-width: 100%;
    max-height: 100%;
  }

  .subject-image img {
    display: block;
    width: 100%;
    max-height: 430px;
    object-fit: contain;
    user-select: none;
  }

  .subject-image canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
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
    bottom: 10px;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    background: rgba(21, 21, 20, 0.85);
    color: #eeeae0;
    font-size: 0.72rem;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .selection-busy span {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(238, 234, 224, 0.35);
    border-top-color: #eeeae0;
    border-radius: 50%;
    animation: selection-spin 0.85s linear infinite;
  }

  @keyframes selection-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .selection-key {
    display: flex;
    min-height: 22px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 8px;
    font-size: 0.72rem;
  }

  .selection-key .error {
    color: #b3261e;
  }

  .exact-edge-label {
    padding: 2px 8px;
    background: rgba(20, 134, 93, 0.14);
    color: #14865d;
    font-size: 0.66rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .selection-controls {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-left: 1px solid rgba(36, 36, 36, 0.18);
    overflow-y: auto;
  }

  .selection-step h3 {
    margin: 0 0 4px;
    font-size: 0.95rem;
    font-weight: 500;
  }

  .selection-step p {
    margin: 0 0 8px;
    color: rgba(36, 36, 36, 0.68);
    font-size: 0.76rem;
  }

  .selection-tools {
    display: flex;
    border: 1px solid rgba(36, 36, 36, 0.35);
  }

  .selection-tools button {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 0;
    padding: 7px 4px;
    background: transparent;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .selection-tools button + button {
    border-left: 1px solid rgba(36, 36, 36, 0.25);
  }

  .selection-tools button.active {
    background: rgba(36, 36, 36, 0.88);
    color: #f0efe9;
  }

  .keep-dot,
  .remove-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .keep-dot {
    background: #14865d;
  }

  .remove-dot {
    background: #d34b42;
  }

  .selection-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .selection-actions button {
    flex: 1;
    border: 1px solid rgba(36, 36, 36, 0.35);
    padding: 5px;
    background: transparent;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .selection-actions button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .ai-refine-button {
    width: 100%;
    border: 1px solid rgba(36, 36, 36, 0.4);
    padding: 7px;
    background: rgba(255, 255, 255, 0.5);
    font-size: 0.76rem;
    cursor: pointer;
  }

  .ai-refine-button:hover {
    background: rgba(36, 36, 36, 0.06);
  }

  .refine-details summary {
    font-size: 0.78rem;
    cursor: pointer;
  }

  .refine-sliders {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 8px;
  }

  .import-range {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .import-range > span {
    display: flex;
    justify-content: space-between;
    font-size: 0.68rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .import-range input {
    accent-color: var(--color-orange-std, #f4845f);
  }

  .shape-result {
    display: grid;
    min-height: 110px;
    place-items: center;
    border: 1px solid rgba(36, 36, 36, 0.25);
    background: rgba(255, 255, 255, 0.5);
  }

  .shape-result svg {
    width: 100%;
    height: 110px;
  }

  .shape-result.empty span {
    color: rgba(36, 36, 36, 0.45);
    font-size: 0.74rem;
  }

  .selection-confirm {
    margin-top: auto;
  }

  .selection-confirm p {
    margin: 0 0 6px;
    color: rgba(36, 36, 36, 0.55);
    font-size: 0.68rem;
  }

  .selection-confirm button {
    width: 100%;
    border: 0;
    padding: 10px;
    background: var(--color-orange-std, #f4845f);
    color: #191918;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .selection-confirm button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    clip: rect(0 0 0 0);
    overflow: hidden;
    white-space: nowrap;
  }

  @media (max-width: 760px) {
    .image-tool-body {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }

    .selection-controls {
      border-top: 1px solid rgba(36, 36, 36, 0.18);
      border-left: 0;
    }
  }
</style>
