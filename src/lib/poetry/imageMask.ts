export type AutomaticSelectionMethod = "alpha" | "background";

export type PixelBuffer = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type AutomaticMask = {
  values: Float32Array;
  method: AutomaticSelectionMethod;
};

export function automaticMaskFromPixels(
  imageData: PixelBuffer,
): AutomaticMask | undefined {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  let transparentPixels = 0;
  let visiblePixels = 0;
  const alphaValues = new Float32Array(pixelCount);

  for (let index = 0; index < pixelCount; index += 1) {
    const alpha = data[index * 4 + 3] / 255;
    alphaValues[index] = alpha;
    if (alpha <= 0.03) transparentPixels += 1;
    if (alpha >= 0.5) visiblePixels += 1;
  }

  if (
    transparentPixels >= Math.max(12, pixelCount * 0.01) &&
    visiblePixels >= pixelCount * 0.005
  ) {
    return { values: alphaValues, method: "alpha" };
  }

  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  const sampleStep = Math.max(1, Math.floor(Math.max(width, height) / 300));
  const addSample = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    red.push(data[offset]);
    green.push(data[offset + 1]);
    blue.push(data[offset + 2]);
  };
  for (let x = 0; x < width; x += sampleStep) {
    addSample(x, 0);
    addSample(x, height - 1);
  }
  for (let y = sampleStep; y < height - sampleStep; y += sampleStep) {
    addSample(0, y);
    addSample(width - 1, y);
  }
  if (!red.length) return undefined;

  const sampledRed = [...red];
  const sampledGreen = [...green];
  const sampledBlue = [...blue];
  const middle = Math.floor(red.length / 2);
  const background = {
    red: red.sort((a, b) => a - b)[middle],
    green: green.sort((a, b) => a - b)[middle],
    blue: blue.sort((a, b) => a - b)[middle],
  };
  let matchingBorderPixels = 0;
  for (let index = 0; index < sampledRed.length; index += 1) {
    const difference = Math.hypot(
      sampledRed[index] - background.red,
      sampledGreen[index] - background.green,
      sampledBlue[index] - background.blue,
    );
    if (difference <= 24) matchingBorderPixels += 1;
  }
  if (matchingBorderPixels / sampledRed.length < 0.84) return undefined;

  const values = new Float32Array(pixelCount);
  let foregroundPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const difference = Math.hypot(
      data[offset] - background.red,
      data[offset + 1] - background.green,
      data[offset + 2] - background.blue,
    );
    const confidence = Math.max(0, Math.min(1, (difference - 7) / 28));
    values[index] = confidence;
    if (confidence >= 0.5) foregroundPixels += 1;
  }
  const foregroundRatio = foregroundPixels / pixelCount;
  if (foregroundRatio < 0.005 || foregroundRatio > 0.97) return undefined;
  return { values, method: "background" };
}
