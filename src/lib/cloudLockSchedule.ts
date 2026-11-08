import { useEffect, useState, useMemo } from 'react';
import {
  ACTIVATION_EPOCH_MS,
  BRIDGE_CUTOFF_EPOCH_MS,
  isCloudLockActive,
  isBridgeCardVisible,
  calculateNextTransitionDelay,
  clampTimeoutDelay,
} from '../config/cloudLockConfig';

export interface CloudLockScheduleState {
  isLocked: boolean;
  showBridge: boolean;
  currentTimeMs: number;
}

export interface CloudLockSchedulerOptions {
  getCurrentTime?: () => number;
  activationMs?: number;
  cutoffMs?: number;
  pollIntervalMs?: number;
  onScheduleChange?: (state: CloudLockScheduleState) => void;
}

/**
 * Pure controller managing scheduled transitions and wake-from-sleep events.
 * Extracted so unit tests exercise actual runtime scheduler mechanics (fake clocks,
 * boundary triggers, tab wake, event cleanup) without mock divergence.
 */
export class CloudLockScheduler {
  private getCurrentTime: () => number;
  private activationMs: number;
  private cutoffMs: number;
  private pollIntervalMs: number;
  private onScheduleChange?: (state: CloudLockScheduleState) => void;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private currentState: CloudLockScheduleState;

  private boundWakeHandler = () => this.handleWakeOrFocus();

  constructor(options: CloudLockSchedulerOptions = {}) {
    this.getCurrentTime = options.getCurrentTime ?? (() => Date.now());
    this.activationMs = options.activationMs ?? ACTIVATION_EPOCH_MS;
    this.cutoffMs = options.cutoffMs ?? BRIDGE_CUTOFF_EPOCH_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000;
    this.onScheduleChange = options.onScheduleChange;

    const now = this.getCurrentTime();
    this.currentState = this.computeState(now);
  }

  public getState(): CloudLockScheduleState {
    return { ...this.currentState };
  }

  public computeState(nowMs: number): CloudLockScheduleState {
    return {
      isLocked: nowMs >= this.activationMs,
      showBridge: nowMs < this.cutoffMs,
      currentTimeMs: nowMs,
    };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.checkAndNotify();
    this.scheduleNextTransitionTimer();

    // Regular efficient background poll interval as safety net
    if (this.pollIntervalMs > 0) {
      this.intervalId = setInterval(() => {
        this.checkAndNotify();
      }, this.pollIntervalMs);
    }

    // Attach wake / focus / bfcache visibility handlers
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.boundWakeHandler);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', this.boundWakeHandler);
      window.addEventListener('pageshow', this.boundWakeHandler);
    }
  }

  public stop(): void {
    this.isRunning = false;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.boundWakeHandler);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('focus', this.boundWakeHandler);
      window.removeEventListener('pageshow', this.boundWakeHandler);
    }
  }

  /**
   * Called on visibility change (tab foregrounded), window focus, or pageshow (bfcache restore).
   * Immediately re-evaluates current timestamp to recover from sleeping device time jumps.
   */
  public handleWakeOrFocus(): void {
    if (!this.isRunning) return;
    this.checkAndNotify();
    this.scheduleNextTransitionTimer();
  }

  public refresh(): CloudLockScheduleState {
    return this.checkAndNotify();
  }

  private checkAndNotify(): CloudLockScheduleState {
    const now = this.getCurrentTime();
    const newState = this.computeState(now);

    const changed =
      newState.isLocked !== this.currentState.isLocked ||
      newState.showBridge !== this.currentState.showBridge;

    this.currentState = newState;

    if (changed && this.onScheduleChange) {
      this.onScheduleChange(newState);
      this.scheduleNextTransitionTimer();
    }

    return newState;
  }

  private scheduleNextTransitionTimer(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (!this.isRunning) return;

    const now = this.getCurrentTime();
    const delay = calculateNextTransitionDelay(now, this.activationMs, this.cutoffMs);

    if (delay !== null && delay >= 0) {
      const clampedDelay = clampTimeoutDelay(delay);
      this.timeoutId = setTimeout(() => {
        this.checkAndNotify();
        this.scheduleNextTransitionTimer();
      }, clampedDelay);
    }
  }
}

/**
 * React hook subscribing to scheduled transitions and wake-from-sleep events.
 */
export function useCloudLockSchedule(pollIntervalMs = 15_000): CloudLockScheduleState {
  const [state, setState] = useState<CloudLockScheduleState>(() => ({
    isLocked: isCloudLockActive(),
    showBridge: isBridgeCardVisible(),
    currentTimeMs: Date.now(),
  }));

  const scheduler = useMemo(() => {
    return new CloudLockScheduler({
      pollIntervalMs,
      onScheduleChange: (nextState) => {
        setState(nextState);
      },
    });
  }, [pollIntervalMs]);

  useEffect(() => {
    scheduler.start();
    // Synchronize current state immediately on mount
    setState(scheduler.getState());

    return () => {
      scheduler.stop();
    };
  }, [scheduler]);

  return state;
}
