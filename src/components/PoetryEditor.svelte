<script lang="ts">
  import { contours } from "d3-contour";
  import { onDestroy, tick } from "svelte";
  import { automaticMaskFromPixels } from "../lib/poetry-image-mask";

  type Point = { x: number; y: number };
  type Layout = "outline" | "fill" | "columns";
  type Unit = "phrase" | "word" | "letter";
  type Orientation = "follow" | "upright" | "radial";
  type Placement = Point & { text: string; angle: number; index: number };
  type SelectionTool = "keep" | "remove" | "lasso";
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

  function applyPreset(name: "circle" | "heart") {
    previousPoints = points;
    drawing = false;
    if (name === "circle") points = makeCircle();
    if (name === "heart") points = makeHeart();
    closePath = true;
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

  async function chooseImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      selectionError = "Choose a PNG, JPEG, or WebP image.";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      selectionError = "That image is over 20 MB. Please choose a smaller one.";
      return;
    }

    selectionError = "";
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
    imageUrl = URL.createObjectURL(file);
    selectionStatus = "Reading the image edge…";

    try {
      const source = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
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
    const brushMode =
      selectionTool === "keep" ? 1 : selectionTool === "remove" ? 2 : 3;
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
          brushMode:
            selectionTool === "keep" ? 1 : selectionTool === "remove" ? 2 : 3,
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
    previousPoints = points;
    points = importedShapePreview;
    closePath = true;
    drawing = false;
    showGuide = true;
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

  onDestroy(() => {
    if (noticeTimer) clearTimeout(noticeTimer);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    pendingBitmap?.close();
    segmenterWorker?.postMessage({ type: "CLOSE" });
    segmenterWorker?.terminate();
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
          <button
            class:active={drawing}
            type="button"
            on:click={() => (drawing = !drawing)}
          >
            <span>✎</span>{drawing ? "Drawing…" : "Draw"}
          </button>
          <button type="button" on:click={openImageTool}>
            <span>▧</span>From image
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-tool-title"
        tabindex="-1"
      >
        <header class="image-tool-header">
          <div>
            <span>Shape study</span>
            <h2 id="image-tool-title">Make a shape from an image</h2>
          </div>
          <button
            type="button"
            on:click={closeImageTool}
            aria-label="Close image shape tool">Close ×</button
          >
        </header>

        {#if !imageUrl}
          <button
            class="image-dropzone"
            type="button"
            on:click={() => imageInputElement.click()}
            on:dragover={(event) => event.preventDefault()}
            on:drop={handleImageDrop}
          >
            <span>▧</span>
            <strong>Drop an image here</strong>
            <small>or choose a PNG, JPEG, or WebP · up to 20 MB</small>
          </button>
          <p class="model-status" class:error={selectionError}>
            {selectionError || selectionStatus}
          </p>
        {:else}
          <div class="image-tool-body">
            <div class="selection-workspace">
              <div class="selection-toolbar">
                <div>
                  <strong>{imageName}</strong>
                  <span class:error={selectionError}>
                    {selectionError || selectionStatus}
                  </span>
                </div>
                <button type="button" on:click={() => imageInputElement.click()}
                  >Replace image</button
                >
              </div>

              <div class="subject-stage">
                <div
                  class:busy={segmenterBusy}
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
                  {#if segmenterBusy}
                    <div class="selection-busy" aria-live="polite">
                      <span></span>{selectionStatus}
                    </div>
                  {/if}
                </div>
              </div>

              <div class="selection-key" aria-hidden="true">
                {#if selectionMethod === "alpha"}
                  <span class="exact-edge-label">Exact transparency edge</span>
                {:else if selectionMethod === "background"}
                  <span class="exact-edge-label">Flat background edge</span>
                {:else}
                  <span class="keep-dot"></span>Keep
                  <span class="remove-dot"></span>Remove
                  <span class="lasso-dot"></span>Lasso
                {/if}
              </div>
            </div>

            <aside class="selection-controls">
              <section>
                <div class="import-section-heading">
                  <span>01</span>
                  <h3>Select</h3>
                </div>
                {#if selectionMethod === "alpha"}
                  <p>
                    This PNG already has transparency, so its real pixel edge is
                    used directly. No AI guess is needed.
                  </p>
                {:else if selectionMethod === "background"}
                  <p>
                    The background is flat enough to remove directly, preserving
                    the artwork’s crisp edge.
                  </p>
                {:else}
                  <p>
                    Click or paint over the subject. Add another stroke to
                    correct the selection.
                  </p>
                {/if}

                {#if segmenterImageReady}
                  <div class="selection-tools" aria-label="Selection brush">
                    <button
                      class:active={selectionTool === "keep"}
                      type="button"
                      on:click={() => (selectionTool = "keep")}
                    >
                      <span class="keep-dot"></span>Keep
                    </button>
                    <button
                      class:active={selectionTool === "remove"}
                      type="button"
                      on:click={() => (selectionTool = "remove")}
                    >
                      <span class="remove-dot"></span>Remove
                    </button>
                    <button
                      class:active={selectionTool === "lasso"}
                      type="button"
                      on:click={() => (selectionTool = "lasso")}
                    >
                      <span class="lasso-dot"></span>Lasso
                    </button>
                  </div>
                  <div class="selection-actions">
                    <button
                      type="button"
                      disabled={!selectionStrokes.length || segmenterBusy}
                      on:click={undoSelectionStroke}>Undo mark</button
                    >
                    <button
                      type="button"
                      disabled={!selectionStrokes.length || segmenterBusy}
                      on:click={resetSelection}>Start over</button
                    >
                  </div>
                {:else if selectionMethod === "alpha" || selectionMethod === "background"}
                  <button
                    class="ai-refine-button"
                    type="button"
                    disabled={segmenterBusy}
                    on:click={startAiRefinement}
                  >
                    Refine with AI brush
                  </button>
                {/if}
              </section>

              <section>
                <div class="import-section-heading">
                  <span>02</span>
                  <h3>Refine</h3>
                </div>
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
                    <span>Your extracted silhouette will appear here.</span>
                  {/if}
                </div>
              </section>

              <div class="selection-confirm">
                <p>
                  The image stays in your browser. Only the outer silhouette
                  becomes part of the poem.
                </p>
                <button
                  type="button"
                  disabled={importedShapePreview.length < 3 || segmenterBusy}
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
          accept="image/png,image/jpeg,image/webp"
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

  .shape-grid {
    grid-template-columns: repeat(4, 1fr);
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
    padding: 16px;
    background: rgba(36, 36, 36, 0.72);
  }

  .image-tool {
    position: relative;
    width: min(1120px, calc(100vw - 32px));
    height: min(780px, calc(100vh - 32px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid var(--color-dark);
    background: var(--color-light);
    box-shadow: 9px 9px 0 rgba(36, 36, 36, 0.45);
  }

  .image-tool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    min-height: 68px;
    padding: 9px 13px 9px 16px;
    border-bottom: 1px solid var(--color-dark);
  }

  .image-tool-header > div {
    display: flex;
    align-items: baseline;
    gap: 16px;
  }

  .image-tool-header span,
  .model-status,
  .selection-toolbar,
  .selection-key,
  .import-section-heading > span,
  .import-range > span,
  .selection-confirm p {
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.68rem;
    letter-spacing: 0.065em;
    text-transform: uppercase;
  }

  .image-tool-header span {
    opacity: 0.55;
  }

  .image-tool-header h2 {
    margin: 0;
    font-size: clamp(1.3rem, 2.5vw, 2rem);
    font-weight: 400;
    letter-spacing: -0.035em;
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

  .image-tool-header button:hover,
  .selection-toolbar button:hover,
  .selection-actions button:hover,
  .selection-confirm button:hover,
  .selection-confirm button:not(:disabled) {
    background: var(--color-dark);
    color: var(--color-light);
  }

  .image-dropzone {
    width: calc(100% - 36px);
    height: calc(100% - 36px);
    align-self: center;
    justify-self: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px dashed var(--color-dark);
    background: #deded8;
    color: var(--color-dark);
    cursor: pointer;
  }

  .image-dropzone > span {
    font-size: 4rem;
    line-height: 1;
  }

  .image-dropzone strong {
    font-size: clamp(1.35rem, 3vw, 2.25rem);
    font-weight: 400;
  }

  .image-dropzone small {
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.72rem;
    text-transform: uppercase;
  }

  .model-status {
    position: absolute;
    bottom: 32px;
    margin: 0;
  }

  .error {
    color: #b92f28 !important;
  }

  .image-tool-body {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 304px;
  }

  .selection-workspace {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    padding: 11px 13px 9px;
    background: #d7d7d1;
  }

  .selection-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 9px;
  }

  .selection-toolbar > div {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .selection-toolbar strong,
  .selection-toolbar span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selection-toolbar strong {
    font-weight: 500;
  }

  .selection-toolbar span {
    opacity: 0.65;
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
    justify-content: flex-end;
    gap: 6px;
    min-height: 27px;
  }

  .selection-key span:not(:first-child) {
    margin-left: 8px;
  }

  .exact-edge-label {
    padding: 3px 6px;
    border: 1px solid rgba(36, 36, 36, 0.5);
    background: var(--color-light);
  }

  .keep-dot,
  .remove-dot,
  .lasso-dot {
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

  .lasso-dot {
    background: #315fb4;
  }

  .selection-controls {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-left: 1px solid var(--color-dark);
  }

  .selection-controls > section {
    padding: 12px 14px 14px;
    border-bottom: 1px solid rgba(36, 36, 36, 0.4);
  }

  .import-section-heading {
    display: grid;
    grid-template-columns: 28px 1fr;
    align-items: baseline;
    margin-bottom: 5px;
  }

  .import-section-heading > span {
    opacity: 0.55;
  }

  .import-section-heading h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 400;
  }

  .selection-controls section > p {
    margin: 0 0 9px 28px;
    font-size: 0.84rem;
    line-height: 1.25;
  }

  .selection-tools {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin-left: 28px;
    border: 1px solid rgba(36, 36, 36, 0.55);
  }

  .selection-tools button {
    min-height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 0;
    border-right: 1px solid rgba(36, 36, 36, 0.55);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-pp-editorial-sans);
    font-size: 0.67rem;
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
    margin: 8px 0 0 28px;
  }

  .selection-actions button {
    flex: 1;
  }

  .ai-refine-button {
    width: calc(100% - 28px);
    min-height: 32px;
    margin: 0 0 0 28px;
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
  .selection-confirm button:disabled {
    cursor: default;
    opacity: 0.35;
    background: transparent;
    color: var(--color-dark);
  }

  .import-range {
    display: block;
    margin: 7px 0 0 28px;
  }

  .import-range > span {
    display: flex;
    justify-content: space-between;
    opacity: 0.72;
  }

  .shape-result {
    height: 124px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 9px 0 0 28px;
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
    font-size: 0.78rem;
    line-height: 1.25;
    opacity: 0.55;
  }

  .selection-confirm {
    margin-top: auto;
    padding: 11px 14px 13px;
  }

  .selection-confirm p {
    margin: 0 0 8px;
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
      grid-template-columns: repeat(4, 1fr);
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

    .image-tool-header > div {
      display: block;
    }

    .image-tool-header span {
      display: none;
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
