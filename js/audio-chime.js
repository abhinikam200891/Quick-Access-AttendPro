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
    this.initAutoplayUnlock();
  }

  initAutoplayUnlock() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      try {
        const ctx = this.getAudioContext();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      } catch (e) {}
      window.removeEventListener('click', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('click', unlock, true);
    window.addEventListener('touchstart', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  getAudioContext() {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  isEnabled() {
    return this.enabled;
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(STORAGE_KEY_SOUND, String(this.enabled));
    } catch (e) {}
    if (this.enabled) {
      this.playDing();
    }
    return this.enabled;
  }

  /**
   * Plays a crisp, melodic 3-tone chime (C5 -> E5 -> G5) to clearly alert admins
   * when attendance is recorded in real time.
   */
  async playDing() {
    if (!this.enabled) return;

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;

      // Note 1: 523.25 Hz (C5) - Opening ping
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(523.25, now);

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.4, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.28);

      // Note 2: 659.25 Hz (E5) - Harmonic middle
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.08);

      gain2.gain.setValueAtTime(0, now + 0.08);
      gain2.gain.linearRampToValueAtTime(0.45, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.45);

      // Note 3: 783.99 Hz (G5) - High triumphant chime resolution
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(783.99, now + 0.16);

      gain3.gain.setValueAtTime(0, now + 0.16);
      gain3.gain.linearRampToValueAtTime(0.5, now + 0.18);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(now + 0.16);
      osc3.stop(now + 0.8);
    } catch (e) {
      console.warn('Audio chime playback error:', e);
    }
  }
}

export const soundController = new SoundController();
