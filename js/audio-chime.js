/**
 * Audio Chime System for Live Attendance Feed
 * Uses Web Audio API for a crisp, latency-free, synthesized enterprise check-in sound.
 * Zero external audio files required.
 */

const STORAGE_KEY_SOUND = 'attendpro_sound_enabled';

class SoundController {
  constructor() {
    this.audioCtx = null;
    this.enabled = localStorage.getItem(STORAGE_KEY_SOUND) !== 'false'; // default true
  }

  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  isEnabled() {
    return this.enabled;
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem(STORAGE_KEY_SOUND, String(this.enabled));
    if (this.enabled) {
      this.playDing();
    }
    return this.enabled;
  }

  /**
   * Plays a clean, pleasant two-tone enterprise check-in chime (D5 -> A5)
   */
  playDing() {
    if (!this.enabled) return;

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Note 1: 587.33 Hz (D5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.25, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.3);

      // Note 2: 880.00 Hz (A5)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.0, now + 0.1);

      gain2.gain.setValueAtTime(0, now + 0.1);
      gain2.gain.linearRampToValueAtTime(0.3, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc2.start(now + 0.1);
      osc2.stop(now + 0.7);
    } catch (e) {
      console.warn('Audio chime playback error:', e);
    }
  }
}

export const soundController = new SoundController();
