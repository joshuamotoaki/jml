export interface TimerSettings {
  focus: { time: number; color: string };
  short: { time: number; color: string };
  long: { time: number; color: string };
}

export class PomodoroTimer {
  private currentMode: string = "focus";
  private timeRemaining: number = 25 * 60;
  private isRunning: boolean = false;
  private timerId: number | null = null;
  private settings: TimerSettings;

  private readonly defaultSettings: TimerSettings = {
    focus: { time: 25, color: "red" },
    short: { time: 5, color: "green" },
    long: { time: 15, color: "blue" },
  };

  constructor() {
    // Load settings from localStorage or use defaults
    const savedSettings = localStorage.getItem("pomodoroSettings");
    this.settings = savedSettings
      ? JSON.parse(savedSettings)
      : { ...this.defaultSettings };
  }

  init() {
    this.setupEventListeners();
    this.switchMode("focus");
    this.updateDisplay();
  }

  private setupEventListeners() {
    const startStopBtn = document.getElementById("start-stop-btn");
    const resetBtn = document.getElementById("reset-btn");
    const add5Btn = document.getElementById("add-5-btn");
    const settingsBtn = document.getElementById("settings-btn");
    const modeButtons = document.querySelectorAll(".mode-btn");

    const settingsDialog = document.getElementById("settings-dialog");
    const resetDialog = document.getElementById("reset-dialog");
    const closeSettingsBtn = document.getElementById("close-settings");
    const saveSettingsBtn = document.getElementById("save-settings");
    const confirmResetBtn = document.getElementById("confirm-reset");
    const cancelResetBtn = document.getElementById("cancel-reset");

    // Control buttons
    startStopBtn?.addEventListener("click", () => this.toggleTimer());
    resetBtn?.addEventListener("click", () =>
      resetDialog?.classList.add("open"),
    );
    add5Btn?.addEventListener("click", () => this.add5Minutes());
    settingsBtn?.addEventListener("click", () => {
      this.loadSettingsForm();
      settingsDialog?.classList.add("open");
    });

    // Mode buttons
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-mode");
        if (mode) this.switchMode(mode);
      });
    });

    // Dialog controls
    closeSettingsBtn?.addEventListener("click", () =>
      settingsDialog?.classList.remove("open"),
    );
    saveSettingsBtn?.addEventListener("click", () => this.saveSettings());
    confirmResetBtn?.addEventListener("click", () => {
      this.resetTimer();
      resetDialog?.classList.remove("open");
    });
    cancelResetBtn?.addEventListener("click", () =>
      resetDialog?.classList.remove("open"),
    );

    // Close dialogs on outside click
    settingsDialog?.addEventListener("click", (e) => {
      if (e.target === settingsDialog) {
        settingsDialog.classList.remove("open");
      }
    });
    resetDialog?.addEventListener("click", (e) => {
      if (e.target === resetDialog) {
        resetDialog.classList.remove("open");
      }
    });

    // Close dialogs with Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        settingsDialog?.classList.remove("open");
        resetDialog?.classList.remove("open");
      }
    });
  }

  private updateDisplay() {
    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    const timerDisplay = document.getElementById("timer-display");
    if (timerDisplay) {
      timerDisplay.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
  }

  private updateBackgroundColor() {
    const cont = document.getElementById("cont");
    const color = this.settings[this.currentMode as keyof TimerSettings].color;
    if (cont) {
      // Map color names to the actual CSS variable values
      const colorMap: { [key: string]: string } = {
        red: '#e63946',
        orange: '#f4845f',
        yellow: '#ffd166',
        green: '#06d6a0',
        blue: '#118ab2',
        indigo: '#5c6bc0',
        violet: '#9b5de5'
      };
      
      cont.style.backgroundColor = colorMap[color] || '#e63946';
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
    const startStopBtn = document.getElementById("start-stop-btn");
    if (startStopBtn) startStopBtn.textContent = "Stop";

    this.timerId = window.setInterval(() => {
      if (this.timeRemaining > 0) {
        this.timeRemaining--;
        this.updateDisplay();
      } else {
        this.stopTimer();
      }
    }, 1000);
  }

  private stopTimer() {
    this.isRunning = false;
    const startStopBtn = document.getElementById("start-stop-btn");
    if (startStopBtn) startStopBtn.textContent = "Start";

    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private switchMode(mode: string) {
    this.stopTimer();
    this.currentMode = mode;
    this.timeRemaining = this.settings[mode as keyof TimerSettings].time * 60;
    this.updateDisplay();
    this.updateBackgroundColor();

    // Update active button
    const modeButtons = document.querySelectorAll(".mode-btn");
    modeButtons.forEach((btn) => {
      if (btn.getAttribute("data-mode") === mode) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  private resetTimer() {
    this.stopTimer();
    this.timeRemaining =
      this.settings[this.currentMode as keyof TimerSettings].time * 60;
    this.updateDisplay();
  }

  private add5Minutes() {
    this.timeRemaining += 5 * 60;
    this.updateDisplay();
  }

  private loadSettingsForm() {
    const focusTime = document.getElementById("focus-time") as HTMLInputElement;
    const focusColor = document.getElementById(
      "focus-color",
    ) as HTMLSelectElement;
    const shortTime = document.getElementById("short-time") as HTMLInputElement;
    const shortColor = document.getElementById(
      "short-color",
    ) as HTMLSelectElement;
    const longTime = document.getElementById("long-time") as HTMLInputElement;
    const longColor = document.getElementById(
      "long-color",
    ) as HTMLSelectElement;

    if (focusTime) focusTime.value = this.settings.focus.time.toString();
    if (focusColor) focusColor.value = this.settings.focus.color;
    if (shortTime) shortTime.value = this.settings.short.time.toString();
    if (shortColor) shortColor.value = this.settings.short.color;
    if (longTime) longTime.value = this.settings.long.time.toString();
    if (longColor) longColor.value = this.settings.long.color;
  }

  private saveSettings() {
    const focusTime = document.getElementById("focus-time") as HTMLInputElement;
    const focusColor = document.getElementById(
      "focus-color",
    ) as HTMLSelectElement;
    const shortTime = document.getElementById("short-time") as HTMLInputElement;
    const shortColor = document.getElementById(
      "short-color",
    ) as HTMLSelectElement;
    const longTime = document.getElementById("long-time") as HTMLInputElement;
    const longColor = document.getElementById(
      "long-color",
    ) as HTMLSelectElement;

    this.settings = {
      focus: {
        time: parseInt(focusTime.value),
        color: focusColor.value,
      },
      short: {
        time: parseInt(shortTime.value),
        color: shortColor.value,
      },
      long: {
        time: parseInt(longTime.value),
        color: longColor.value,
      },
    };

    // Save to localStorage
    localStorage.setItem("pomodoroSettings", JSON.stringify(this.settings));

    // Update current timer if needed
    if (!this.isRunning) {
      this.timeRemaining =
        this.settings[this.currentMode as keyof TimerSettings].time * 60;
      this.updateDisplay();
    }
    this.updateBackgroundColor();

    // Update mode button data attributes
    const modeButtons = document.querySelectorAll(".mode-btn");
    modeButtons.forEach((btn) => {
      const mode = btn.getAttribute("data-mode") as string;
      if (mode && this.settings[mode as keyof TimerSettings]) {
        btn.setAttribute(
          "data-time",
          this.settings[mode as keyof TimerSettings].time.toString(),
        );
        btn.setAttribute(
          "data-color",
          this.settings[mode as keyof TimerSettings].color,
        );
      }
    });

    // Close dialog
    const settingsDialog = document.getElementById("settings-dialog");
    settingsDialog?.classList.remove("open");
  }
}
