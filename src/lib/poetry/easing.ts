import { clampProgress, type EasingName } from "./types";

export const easingOptions: { value: EasingName; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "snappy", label: "Snappy" },
  { value: "playful", label: "Playful" },
  { value: "bounce", label: "Bounce" },
  { value: "linear", label: "Linear" },
];

export function ease(name: EasingName, value: number) {
  const progress = clampProgress(value);
  switch (name) {
    case "linear":
      return progress;
    case "snappy":
      return 1 - Math.pow(1 - progress, 3);
    case "playful": {
      const amount = 1.35;
      const scale = amount * 1.525;
      if (progress < 0.5) {
        const doubled = progress * 2;
        return (doubled * doubled * ((scale + 1) * doubled - scale)) / 2;
      }
      const doubled = progress * 2 - 2;
      return (doubled * doubled * ((scale + 1) * doubled + scale) + 2) / 2;
    }
    case "bounce": {
      const c4 = (2 * Math.PI) / 3.2;
      if (progress === 0 || progress === 1) return progress;
      return (
        Math.pow(2, -9 * progress) * Math.sin((progress * 9 - 0.75) * c4) + 1
      );
    }
    case "smooth":
    default:
      return progress * progress * (3 - 2 * progress);
  }
}

/** A small path for drawing an easing preview curve inside a w×h box. */
export function easingCurvePath(
  name: EasingName,
  width: number,
  height: number,
) {
  const steps = 24;
  const inset = height * 0.18;
  const usable = height - inset * 2;
  const commands: string[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const value = ease(name, t);
    const x = t * width;
    const y = height - inset - value * usable;
    commands.push(`${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return commands.join(" ");
}
