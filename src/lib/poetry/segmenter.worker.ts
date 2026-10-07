import {
  FilesetResolver,
  InteractiveSegmenter,
  type Stroke,
} from "@mediapipe/tasks-vision";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task";

let segmenter: InteractiveSegmenter | undefined;
let renderCanvas: OffscreenCanvas | undefined;

type WorkerRequest =
  | { type: "INITIALIZE" }
  | { type: "SET_IMAGE"; bitmap: ImageBitmap }
  | { type: "SEGMENT"; strokes: Stroke[] }
  | { type: "CLOSE" };

function sendError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  self.postMessage({ type: "ERROR", message });
}

async function initialize() {
  if (segmenter) {
    self.postMessage({ type: "READY" });
    return;
  }

  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH, true);
  renderCanvas = new OffscreenCanvas(1, 1);
  segmenter = await InteractiveSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate: "CPU",
    },
    canvas: renderCanvas,
  });
  self.postMessage({ type: "READY" });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.type === "INITIALIZE") {
      await initialize();
      return;
    }

    if (event.data.type === "SET_IMAGE") {
      if (!segmenter) throw new Error("The subject selector is not ready yet.");
      if (renderCanvas) {
        renderCanvas.width = event.data.bitmap.width;
        renderCanvas.height = event.data.bitmap.height;
      }
      segmenter.setImage(event.data.bitmap);
      event.data.bitmap.close();
      self.postMessage({ type: "IMAGE_READY" });
      return;
    }

    if (event.data.type === "SEGMENT") {
      if (!segmenter) throw new Error("The subject selector is not ready yet.");
      const startedAt = performance.now();
      const mask = segmenter.segment(event.data.strokes);
      const values = new Float32Array(mask.getAsFloat32Array());
      const width = mask.width;
      const height = mask.height;
      mask.close();
      self.postMessage(
        {
          type: "MASK",
          values,
          width,
          height,
          elapsed: performance.now() - startedAt,
        },
        { transfer: [values.buffer] },
      );
      return;
    }

    if (event.data.type === "CLOSE") {
      segmenter?.close();
      segmenter = undefined;
      renderCanvas = undefined;
      self.close();
    }
  } catch (error) {
    sendError(error);
  }
};
