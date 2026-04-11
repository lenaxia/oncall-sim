import type { SimEvent } from "@shared/types/events";

export interface SimClock {
  getSimTime(): number;
  tick(realElapsedMs: number): void;
  setSpeed(speed: 1 | 2 | 5 | 10): void;
  getSpeed(): 1 | 2 | 5 | 10;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  toSimTimeEvent(): Extract<SimEvent, { type: "sim_time" }>;
}

export function createSimClock(initialSpeed: 1 | 2 | 5 | 10 = 1): SimClock {
  let _simTime = 0;
  let _speed: 1 | 2 | 5 | 10 = initialSpeed;
  let _paused = false;

  return {
    getSimTime() {
      return _simTime;
    },

    tick(realElapsedMs: number) {
      if (_paused) return;
      _simTime += (realElapsedMs / 1000) * _speed;
    },

    setSpeed(speed) {
      _speed = speed;
    },
    getSpeed() {
      return _speed;
    },

    pause() {
      _paused = true;
    },
    resume() {
      _paused = false;
    },
    isPaused() {
      return _paused;
    },

    toSimTimeEvent() {
      return {
        type: "sim_time",
        simTime: _simTime,
        speed: _speed,
        paused: _paused,
      };
    },
  };
}
