import { evaluateMotion, type MotionSegment } from "./motion";
import { HEIGHT, WIDTH, type MotionDoc, type Placement } from "./types";

export type ExportStyle = {
  inkColor: string;
  paperColor: string;
  fontFamily: string;
  fontSize: number;
};

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function shortHash(value: string) {
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

/**
 * Bake the full timeline into a self-contained animated SVG. Easing and
 * stagger are already applied by `evaluateMotion`, so the CSS animation
 * itself runs linear between densely sampled frames.
 */
export function animatedExportMarkup(
  segments: MotionSegment[],
  motion: MotionDoc,
  sequenceLength: number,
  style: ExportStyle,
  seed: string,
) {
  if (!segments.length || segments.some((segment) => !segment.plan)) return "";

  const prefix = `cp-${shortHash(
    `${seed}-${motion.duration}-${motion.loop}-${motion.stagger}-${segments.length}`,
  )}`;

  const forwardSpan = sequenceLength;
  const positions: number[] = [];
  const staggerBoost = motion.stagger === "none" ? 1 : 1.6;
  const framesPerSegment = Math.round(10 * staggerBoost);
  const forwardSteps = Math.max(
    12,
    Math.min(72, segments.length * framesPerSegment),
  );
  const forward = Array.from(
    { length: forwardSteps + 1 },
    (_, index) => (index / forwardSteps) * forwardSpan,
  );
  if (motion.loop === "pingpong") {
    positions.push(...forward, ...[...forward].reverse().slice(1));
  } else {
    positions.push(...forward);
  }

  const frames = positions.map(
    (position) => evaluateMotion(segments, motion, position)?.placements ?? [],
  );
  if (frames.some((frame) => !frame.length)) return "";

  const pieceCount = Math.max(...frames.map((frame) => frame.length));
  const totalDuration = motion.duration * (motion.loop === "pingpong" ? 2 : 1);
  const repeat = motion.loop === "once" ? "1 forwards" : "infinite";
  const animationTargets =
    motion.trigger === "hover"
      ? [`.${prefix}:hover`, `.${prefix}:focus`]
      : [`.${prefix}`];
  const lastFrameIndex = frames.length - 1;

  // A piece can be absent from some segments (smaller roster). While absent
  // it holds its nearest known placement at opacity 0.
  const pieceAt = (frameIndex: number, index: number): Placement => {
    const direct = frames[frameIndex][index];
    if (direct) return direct;
    for (let offset = 1; offset < frames.length; offset += 1) {
      const before = frames[frameIndex - offset]?.[index];
      if (before) return { ...before, opacity: 0 };
      const after = frames[frameIndex + offset]?.[index];
      if (after) return { ...after, opacity: 0 };
    }
    return {
      x: WIDTH / 2,
      y: HEIGHT / 2,
      angle: 0,
      text: "",
      index,
      opacity: 0,
    };
  };

  const animationRules = Array.from({ length: pieceCount }, (_, pieceIndex) => {
    const keyframes = frames
      .map((_, frameIndex) => {
        const percentage = (frameIndex / lastFrameIndex) * 100;
        const piece = pieceAt(frameIndex, pieceIndex);
        return `${percentage.toFixed(3)}%{transform:${placementTransform(piece)};opacity:${(piece.opacity ?? 1).toFixed(3)}}`;
      })
      .join("");
    const selectors = animationTargets
      .map((target) => `${target} .${prefix}-piece-${pieceIndex}`)
      .join(",");
    return `@keyframes ${prefix}-piece-${pieceIndex}{${keyframes}}\n${selectors}{animation:${prefix}-piece-${pieceIndex} ${totalDuration.toFixed(2)}s linear ${repeat}}`;
  }).join("\n");

  const pieces = Array.from({ length: pieceCount }, (_, index) => {
    const placement = pieceAt(0, index);
    return `<g class="${prefix}-piece ${prefix}-piece-${index}" style="transform:${placementTransform(placement)};opacity:${(placement.opacity ?? 1).toFixed(3)}"><text x="0" y="0" fill="${escapeXml(style.inkColor)}" font-family="${escapeXml(style.fontFamily)}" font-size="${style.fontSize}" text-anchor="middle" dominant-baseline="middle">${escapeXml(placement.text)}</text></g>`;
  }).join("");

  const hoverAttributes =
    motion.trigger === "hover" ? ' tabindex="0" focusable="true"' : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg class="${prefix}"${hoverAttributes} xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Animated concrete poem">
  <title>Animated concrete poem</title>
  <style><![CDATA[
    .${prefix} .${prefix}-piece{transform-box:view-box;transform-origin:0 0;will-change:transform,opacity}
    ${animationRules}
    @media (prefers-reduced-motion: reduce){.${prefix} .${prefix}-piece{animation:none!important}}
  ]]></style>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${escapeXml(style.paperColor)}" />
  ${pieces}
</svg>`;
}

/** Render the current placements as a plain (non-animated) SVG document. */
export function staticExportMarkup(
  placements: Placement[],
  style: ExportStyle,
) {
  const pieces = placements
    .map(
      (placement) =>
        `<g transform="translate(${placement.x.toFixed(2)} ${placement.y.toFixed(2)}) rotate(${placement.angle.toFixed(2)}) scale(${(placement.scale ?? 1).toFixed(3)})" opacity="${(placement.opacity ?? 1).toFixed(3)}"><text x="0" y="0" fill="${escapeXml(style.inkColor)}" font-family="${escapeXml(style.fontFamily)}" font-size="${style.fontSize}" text-anchor="middle" dominant-baseline="middle">${escapeXml(placement.text)}</text></g>`,
    )
    .join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Concrete poem">
  <title>Concrete poem</title>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${escapeXml(style.paperColor)}" />
  ${pieces}
</svg>`;
}
