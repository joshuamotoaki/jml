import {
  DEFAULT_SETTINGS,
  MODES,
  type ModeId,
  type TimerSettings,
} from "./modes";

const STORAGE_KEY = "pomodoroSettings";
const GONG_URL = "/gong.mp3";
const GONG_TIME = 5000;

function loadSettings(): TimerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

export class PomodoroTimer {
  private currentMode: ModeId = "focus";
  private timeRemaining = DEFAULT_SETTINGS.focus.time * 60;
  private isRunning = false;
  private timerId: number | null = null;
  private endTime: number | null = null;
  private settings = loadSettings();
  private audio = new Audio(GONG_URL);
  private idleTitle = document.title;

  constructor() {
    this.audio.volume = 0.5;
  }

  init() {
    this.setupEventListeners();
    this.switchMode("focus");
  }

  private setupEventListeners() {
    const dialogs = document.querySelectorAll<HTMLElement>("[data-dialog]");
    const open = (id: string) => byId(id)?.classList.add("open");
    const closeAll = () =>
      dialogs.forEach((dialog) => dialog.classList.remove("open"));

    byId("start-stop-btn")?.addEventListener("click", () => this.toggleTimer());
    byId("reset-btn")?.addEventListener("click", () => open("reset-dialog"));
    byId("add-5-btn")?.addEventListener("click", () => this.add5Minutes());
    byId("settings-btn")?.addEventListener("click", () => {
      this.loadSettingsForm();
      open("settings-dialog");
    });

    document.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () =>
        this.switchMode(btn.getAttribute("data-mode") as ModeId),
      );
    });

    byId("save-settings")?.addEventListener("click", () => {
      this.saveSettings();
      closeAll();
    });
    byId("confirm-reset")?.addEventListener("click", () => {
      this.resetTimer();
      closeAll();
    });

    // Close on the close/cancel buttons, a backdrop click, or Escape.
    document
      .querySelectorAll("[data-dialog-close]")
      .forEach((btn) => btn.addEventListener("click", closeAll));
    dialogs.forEach((dialog) => {
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) closeAll();
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll();
    });
  }

  private formatTime(): string {
    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  private updateDisplay() {
    const formatted = this.formatTime();
    const timerDisplay = byId("timer-display");
    if (timerDisplay) timerDisplay.textContent = formatted;

    if (this.isRunning) {
      const label = MODES.find((mode) => mode.id === this.currentMode)!.label;
      document.title = `${formatted} (${label.toLowerCase()})`;
    } else {
      document.title = this.idleTitle;
    }
  }

  private updateBackgroundColor() {
    const background = byId("timer-bg");
    const color = this.settings[this.currentMode].color;
    if (background) {
      background.style.backgroundColor = `var(--color-${color}-std)`;
    }
  }

  private toggleTimer() {
    if (this.isRunning) {
      this.stopTimer();
    } else {
      this.startTimer();
    }
  }

  private startTimer() {
    this.isRunning = true;
    const startStopBtn = byId("start-stop-btn");
    if (startStopBtn) startStopBtn.textContent = "Stop";

    // Anchor to an absolute end time so the countdown stays accurate even
    // when the tab is backgrounded and setInterval is throttled.
    this.endTime = Date.now() + this.timeRemaining * 1000;
    this.updateDisplay();

    this.timerId = window.setInterval(() => this.tick(), 250);
  }

  private tick() {
    if (this.endTime === null) return;

    const remaining = Math.round((this.endTime - Date.now()) / 1000);

    if (remaining > 0) {
      this.timeRemaining = remaining;
      this.updateDisplay();
    } else {
      this.timeRemaining = 0;
      this.stopTimer();
      this.playGong();
    }
  }

  private stopTimer() {
    this.isRunning = false;
    this.endTime = null;
    const startStopBtn = byId("start-stop-btn");
    if (startStopBtn) startStopBtn.textContent = "Start";

    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.updateDisplay();
  }

  private switchMode(mode: ModeId) {
    this.currentMode = mode;
    this.resetTimer();
    this.updateBackgroundColor();

    document.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });
  }

  private resetTimer() {
    this.stopTimer();
    this.timeRemaining = this.settings[this.currentMode].time * 60;
    this.updateDisplay();
  }

  private add5Minutes() {
    this.timeRemaining += 5 * 60;
    if (this.endTime !== null) {
      this.endTime += 5 * 60 * 1000;
    }
    this.updateDisplay();
  }

  private loadSettingsForm() {
    for (const { id } of MODES) {
      const time = byId<HTMLInputElement>(`${id}-time`);
      const color = byId<HTMLSelectElement>(`${id}-color`);
      if (time) time.value = this.settings[id].time.toString();
      if (color) color.value = this.settings[id].color;
    }
  }

  private saveSettings() {
    for (const { id } of MODES) {
      const time = byId<HTMLInputElement>(`${id}-time`);
      const color = byId<HTMLSelectElement>(`${id}-color`);
      this.settings[id] = {
        time: parseInt(time?.value ?? "") || this.settings[id].time,
        color: color?.value ?? this.settings[id].color,
      };
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));

    if (!this.isRunning) {
      this.timeRemaining = this.settings[this.currentMode].time * 60;
      this.updateDisplay();
    }
    this.updateBackgroundColor();
  }

  private playGong() {
    this.audio.currentTime = 0;

    this.audio.play().catch((e) => {
      console.error("Failed to play gong sound:", e);
    });

    setTimeout(() => {
      this.audio.pause();
      this.audio.currentTime = 0;
    }, GONG_TIME);
  }
}
