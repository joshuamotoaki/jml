const DEFAULTS = {
  focus: { time: 25, color: "red" },
  short: { time: 5, color: "green" },
  long: { time: 15, color: "blue" },
};

const GONG_URL = "/gong.mp3";
const GONG_TIME = 5000;

export interface TimerSettings {
  focus: { time: number; color: string };
  short: { time: number; color: string };
  long: { time: number; color: string };
}

export interface PomodoroSession {
  mode: string;
  duration: number; // in seconds
  completedAt: string; // ISO date string
}

export interface DailyStats {
  date: string; // YYYY-MM-DD format
  totalFocusTime: number; // in minutes
  totalBreakTime: number; // in minutes
  focusSessions: number;
  shortBreaks: number;
  longBreaks: number;
}

export class PomodoroTimer {
  private currentMode: string = "focus";
  private timeRemaining: number = 25 * 60;
  private isRunning: boolean = false;
  private timerId: number | null = null;
  private settings: TimerSettings;
  private audio: HTMLAudioElement;
  private completedFocusSessions: number = 0;
  private focusSessionsBeforeLongBreak: number = 4;
  private autoStartNextSession: boolean = true;

  private readonly defaultSettings: TimerSettings = DEFAULTS;

  constructor() {
    // Load settings from localStorage or use defaults
    const savedSettings = localStorage.getItem("pomodoroSettings");
    this.settings = savedSettings
      ? JSON.parse(savedSettings)
      : { ...this.defaultSettings };

    // Load additional settings
    const savedFocusSessions = localStorage.getItem(
      "focusSessionsBeforeLongBreak",
    );
    this.focusSessionsBeforeLongBreak = savedFocusSessions
      ? parseInt(savedFocusSessions)
      : 4;

    const savedAutoStart = localStorage.getItem("autoStartNextSession");
    this.autoStartNextSession = savedAutoStart
      ? savedAutoStart === "true"
      : true;

    // Load current session state
    const savedCompletedSessions = localStorage.getItem(
      "completedFocusSessions",
    );
    this.completedFocusSessions = savedCompletedSessions
      ? parseInt(savedCompletedSessions)
      : 0;

    // Initialize audio
    this.audio = new Audio(GONG_URL);
    this.audio.volume = 0.5; // Set volume to 50%
  }

  init() {
    this.setupEventListeners();
    this.switchMode("focus");
    this.updateDisplay();
    this.updateFocusCircles();
  }

  private setupEventListeners() {
    const startStopBtn = document.getElementById("start-stop-btn");
    const resetBtn = document.getElementById("reset-btn");
    const add5Btn = document.getElementById("add-5-btn");
    const settingsBtn = document.getElementById("settings-btn");
    const statsBtn = document.getElementById("stats-btn");
    const modeButtons = document.querySelectorAll(".mode-btn");

    const settingsDialog = document.getElementById("settings-dialog");
    const statsDialog = document.getElementById("stats-dialog");
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
    statsBtn?.addEventListener("click", () => {
      statsDialog?.classList.add("open");
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
        red: "#e63946",
        orange: "#f4845f",
        yellow: "#ffd166",
        green: "#06d6a0",
        blue: "#118ab2",
        indigo: "#5c6bc0",
        violet: "#9b5de5",
      };

      cont.style.backgroundColor = colorMap[color] || "#e63946";
    }
  }

  private updateFocusCircles() {
    const container = document.getElementById("focus-circles");
    if (!container) return;

    // Clear existing circles
    // container.innerHTML = "";

    // Create circles based on focusSessionsBeforeLongBreak
    for (let i = 0; i < this.focusSessionsBeforeLongBreak; i++) {
      const circle = document.createElement("div");
      circle.className = "focus-circle";
      circle.setAttribute("data-index", i.toString());

      if (i < this.completedFocusSessions) {
        circle.classList.add("filled");
      }

      container.appendChild(circle);
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
        this.playGong();
        this.handleSessionComplete();
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

    // Reset focus sessions if in focus mode
    if (this.currentMode === "focus") {
      this.completedFocusSessions = 0;
      localStorage.setItem("completedFocusSessions", "0");
      this.updateFocusCircles();
    }
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
    const focusSessionsCount = document.getElementById(
      "focus-sessions-count",
    ) as HTMLInputElement;
    const autoStartNext = document.getElementById(
      "auto-start-next",
    ) as HTMLInputElement;

    if (focusTime) focusTime.value = this.settings.focus.time.toString();
    if (focusColor) focusColor.value = this.settings.focus.color;
    if (shortTime) shortTime.value = this.settings.short.time.toString();
    if (shortColor) shortColor.value = this.settings.short.color;
    if (longTime) longTime.value = this.settings.long.time.toString();
    if (longColor) longColor.value = this.settings.long.color;
    if (focusSessionsCount)
      focusSessionsCount.value = this.focusSessionsBeforeLongBreak.toString();
    if (autoStartNext) autoStartNext.checked = this.autoStartNextSession;
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
    const focusSessionsCount = document.getElementById(
      "focus-sessions-count",
    ) as HTMLInputElement;
    const autoStartNext = document.getElementById(
      "auto-start-next",
    ) as HTMLInputElement;

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

    // Save session settings
    this.focusSessionsBeforeLongBreak = parseInt(focusSessionsCount.value);
    this.autoStartNextSession = autoStartNext.checked;

    // Save to localStorage
    localStorage.setItem("pomodoroSettings", JSON.stringify(this.settings));
    localStorage.setItem(
      "focusSessionsBeforeLongBreak",
      this.focusSessionsBeforeLongBreak.toString(),
    );
    localStorage.setItem(
      "autoStartNextSession",
      this.autoStartNextSession.toString(),
    );

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

    // Update focus circles if needed
    this.updateFocusCircles();

    // Close dialog
    const settingsDialog = document.getElementById("settings-dialog");
    settingsDialog?.classList.remove("open");
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

    // Save the completed session
    this.saveSession();
  }

  private saveSession() {
    const session: PomodoroSession = {
      mode: this.currentMode,
      duration:
        this.settings[this.currentMode as keyof TimerSettings].time * 60,
      completedAt: new Date().toISOString(),
    };

    // Get existing sessions
    const sessionsJson = localStorage.getItem("pomodoroSessions");
    const sessions: PomodoroSession[] = sessionsJson
      ? JSON.parse(sessionsJson)
      : [];

    // Add new session
    sessions.push(session);

    // Keep only last 30 days of sessions
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const filteredSessions = sessions.filter(
      (s) => new Date(s.completedAt) > thirtyDaysAgo,
    );

    // Save back to localStorage
    localStorage.setItem("pomodoroSessions", JSON.stringify(filteredSessions));

    // Dispatch custom event for UI updates
    window.dispatchEvent(
      new CustomEvent("pomodoroSessionComplete", { detail: session }),
    );

    // Show completion notification
    this.showCompletionNotification();
  }

  public getTodaysSessions(): PomodoroSession[] {
    const sessionsJson = localStorage.getItem("pomodoroSessions");
    if (!sessionsJson) return [];

    const sessions: PomodoroSession[] = JSON.parse(sessionsJson);
    const today = new Date().toDateString();

    return sessions.filter(
      (session) => new Date(session.completedAt).toDateString() === today,
    );
  }

  public getWeeklySessions(): PomodoroSession[] {
    const sessionsJson = localStorage.getItem("pomodoroSessions");
    if (!sessionsJson) return [];

    const sessions: PomodoroSession[] = JSON.parse(sessionsJson);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return sessions.filter(
      (session) => new Date(session.completedAt) > sevenDaysAgo,
    );
  }

  public calculateDailyStats(date: Date): DailyStats {
    const sessionsJson = localStorage.getItem("pomodoroSessions");
    if (!sessionsJson) {
      return {
        date: date.toISOString().split("T")[0],
        totalFocusTime: 0,
        totalBreakTime: 0,
        focusSessions: 0,
        shortBreaks: 0,
        longBreaks: 0,
      };
    }

    const sessions: PomodoroSession[] = JSON.parse(sessionsJson);
    const dateString = date.toDateString();

    const daySessions = sessions.filter(
      (session) => new Date(session.completedAt).toDateString() === dateString,
    );

    const stats: DailyStats = {
      date: date.toISOString().split("T")[0],
      totalFocusTime: 0,
      totalBreakTime: 0,
      focusSessions: 0,
      shortBreaks: 0,
      longBreaks: 0,
    };

    daySessions.forEach((session) => {
      const durationMinutes = session.duration / 60;

      switch (session.mode) {
        case "focus":
          stats.totalFocusTime += durationMinutes;
          stats.focusSessions++;
          break;
        case "short":
          stats.totalBreakTime += durationMinutes;
          stats.shortBreaks++;
          break;
        case "long":
          stats.totalBreakTime += durationMinutes;
          stats.longBreaks++;
          break;
      }
    });

    return stats;
  }

  public getStreakDays(): number {
    const sessionsJson = localStorage.getItem("pomodoroSessions");
    if (!sessionsJson) return 0;

    const sessions: PomodoroSession[] = JSON.parse(sessionsJson);
    if (sessions.length === 0) return 0;

    // Get unique days with sessions
    const uniqueDays = new Set(
      sessions.map((s) => new Date(s.completedAt).toDateString()),
    );

    // Convert to sorted array of dates
    const sortedDates = Array.from(uniqueDays)
      .map((dateStr) => new Date(dateStr))
      .sort((a, b) => b.getTime() - a.getTime());

    if (sortedDates.length === 0) return 0;

    // Check if today has sessions
    const today = new Date().toDateString();
    const hasSessionToday = sortedDates[0].toDateString() === today;

    // If no session today, check if yesterday had sessions
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const hasSessionYesterday =
      sortedDates[0].toDateString() === yesterday.toDateString();

    if (!hasSessionToday && !hasSessionYesterday) return 0;

    // Count consecutive days
    let streak = hasSessionToday ? 1 : 0;
    let currentDate = new Date();

    if (!hasSessionToday) {
      currentDate = yesterday;
      streak = 1;
    }

    for (let i = 1; i < sortedDates.length; i++) {
      currentDate.setDate(currentDate.getDate() - 1);

      if (sortedDates[i].toDateString() === currentDate.toDateString()) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  private showCompletionNotification() {
    const modeText =
      this.currentMode === "focus"
        ? "Focus session"
        : this.currentMode === "short"
          ? "Short break"
          : "Long break";

    // Create notification element
    const notification = document.createElement("div");
    notification.className = "completion-notification";
    notification.innerHTML = `
      <div class="notification-content">
        <h3>${modeText} completed!</h3>
        <p>Great job! Keep up the momentum.</p>
      </div>
    `;

    // Add styles
    notification.style.cssText = `
      position: fixed;
      top: 2rem;
      right: 2rem;
      background: var(--color-light);
      color: var(--color-dark);
      padding: 1.5rem 2rem;
      border-radius: 0;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      z-index: 2000;
      opacity: 0;
      transform: translateY(-1rem);
      transition: all 0.3s ease;
      max-width: 320px;
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.style.opacity = "1";
      notification.style.transform = "translateY(0)";
    }, 10);

    // Remove after delay
    setTimeout(() => {
      notification.style.opacity = "0";
      notification.style.transform = "translateY(-1rem)";

      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 4000);
  }

  private handleSessionComplete() {
    if (this.currentMode === "focus") {
      // Increment completed focus sessions
      this.completedFocusSessions++;
      localStorage.setItem(
        "completedFocusSessions",
        this.completedFocusSessions.toString(),
      );
      this.updateFocusCircles();

      // Determine next mode
      if (this.completedFocusSessions >= this.focusSessionsBeforeLongBreak) {
        // Time for long break
        this.switchMode("long");
      } else {
        // Time for short break
        this.switchMode("short");
      }
    } else if (this.currentMode === "short") {
      // After short break, go back to focus
      this.switchMode("focus");
    } else if (this.currentMode === "long") {
      // After long break, reset focus sessions and go back to focus
      this.completedFocusSessions = 0;
      localStorage.setItem("completedFocusSessions", "0");
      this.updateFocusCircles();
      this.switchMode("focus");
    }

    // Auto-start next session if enabled
    if (this.autoStartNextSession) {
      setTimeout(() => {
        this.startTimer();
      }, 1000); // Small delay to allow mode switch to complete
    }
  }
}
