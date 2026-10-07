export const MODES = [
  { id: "focus", label: "Focus", minutes: 25, color: "red" },
  { id: "short", label: "Short Break", minutes: 5, color: "green" },
  { id: "long", label: "Long Break", minutes: 15, color: "blue" },
] as const;

/** Names of the `--color-*-std` swatches in global.css. */
export const COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "indigo",
  "violet",
] as const;

export type ModeId = (typeof MODES)[number]["id"];

export type TimerSettings = Record<ModeId, { time: number; color: string }>;

export const DEFAULT_SETTINGS = Object.fromEntries(
  MODES.map((mode) => [mode.id, { time: mode.minutes, color: mode.color }]),
) as TimerSettings;
