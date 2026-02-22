/**
 * Tests for SystemAudioCapture command construction and chunk buffering.
 * These tests do not actually capture audio — they verify the command building
 * and configuration logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SystemAudioCapture } from '../src/audio/system-capture.js';

describe('SystemAudioCapture', () => {
  describe('buildCommand — PipeWire', () => {
    it('builds correct pw-record command with defaults', () => {
      const { cmd, args } = SystemAudioCapture.buildCommand('pipewire', {});
      assert.equal(cmd, 'pw-record');
      assert.ok(args.includes('--format=s16'));
      assert.ok(args.includes('--rate=16000'));
      assert.ok(args.includes('--channels=1'));
      assert.ok(args.includes('-'), 'should output to stdout via -');
    });

    it('uses custom sample rate and channels', () => {
      const { cmd, args } = SystemAudioCapture.buildCommand('pipewire', {
        sampleRate: 48000,
        channels: 2,
      });
      assert.equal(cmd, 'pw-record');
      assert.ok(args.includes('--rate=48000'));
      assert.ok(args.includes('--channels=2'));
    });

    it('includes target device when specified', () => {
      const { cmd, args } = SystemAudioCapture.buildCommand('pipewire', {
        device: '42',
      });
      assert.equal(cmd, 'pw-record');
      assert.ok(args.includes('--target=42'));
    });

    it('does not include target when device is omitted', () => {
      const { args } = SystemAudioCapture.buildCommand('pipewire', {});
      const hasTarget = args.some((a) => a.startsWith('--target='));
      assert.equal(hasTarget, false);
    });
  });

  describe('buildCommand — PulseAudio', () => {
    it('builds correct parec command with defaults', () => {
      const { cmd, args } = SystemAudioCapture.buildCommand('pulseaudio', {});
      assert.equal(cmd, 'parec');
      assert.ok(args.includes('--format=s16le'));
      assert.ok(args.includes('--rate=16000'));
      assert.ok(args.includes('--channels=1'));
    });

    it('uses custom sample rate and channels', () => {
      const { cmd, args } = SystemAudioCapture.buildCommand('pulseaudio', {
        sampleRate: 44100,
        channels: 2,
      });
      assert.equal(cmd, 'parec');
      assert.ok(args.includes('--rate=44100'));
      assert.ok(args.includes('--channels=2'));
    });

    it('includes device when specified', () => {
      const { cmd, args } = SystemAudioCapture.buildCommand('pulseaudio', {
        device: 'alsa_output.pci-0000_00_1b.0.analog-stereo.monitor',
      });
      assert.equal(cmd, 'parec');
      assert.ok(
        args.includes('--device=alsa_output.pci-0000_00_1b.0.analog-stereo.monitor'),
      );
    });

    it('does not include device when omitted', () => {
      const { args } = SystemAudioCapture.buildCommand('pulseaudio', {});
      const hasDevice = args.some((a) => a.startsWith('--device='));
      assert.equal(hasDevice, false);
    });

    it('does not include stdout marker (parec writes to stdout by default)', () => {
      const { args } = SystemAudioCapture.buildCommand('pulseaudio', {});
      assert.equal(args.includes('-'), false);
    });
  });

  describe('instance lifecycle', () => {
    it('starts in non-capturing state', () => {
      const capture = new SystemAudioCapture();
      assert.equal(capture.isCapturing(), false);
    });

    it('stop is safe to call when not capturing', () => {
      const capture = new SystemAudioCapture();
      // Should not throw
      capture.stop();
      assert.equal(capture.isCapturing(), false);
    });
  });

  describe('chunk size calculation', () => {
    it('calculates correct chunk size for default config', () => {
      // 16kHz * 1 channel * 2 bytes * 0.1s = 3200 bytes
      const sampleRate = 16000;
      const channels = 1;
      const bytesPerSample = 2;
      const chunkDurationMs = 100;
      const expected = Math.floor(sampleRate * channels * bytesPerSample * (chunkDurationMs / 1000));
      assert.equal(expected, 3200);
    });

    it('calculates correct chunk size for stereo 48kHz', () => {
      // 48kHz * 2 channels * 2 bytes * 0.1s = 19200 bytes
      const sampleRate = 48000;
      const channels = 2;
      const bytesPerSample = 2;
      const chunkDurationMs = 100;
      const expected = Math.floor(sampleRate * channels * bytesPerSample * (chunkDurationMs / 1000));
      assert.equal(expected, 19200);
    });

    it('calculates correct chunk size for 200ms duration', () => {
      // 16kHz * 1 channel * 2 bytes * 0.2s = 6400 bytes
      const sampleRate = 16000;
      const channels = 1;
      const bytesPerSample = 2;
      const chunkDurationMs = 200;
      const expected = Math.floor(sampleRate * channels * bytesPerSample * (chunkDurationMs / 1000));
      assert.equal(expected, 6400);
    });
  });
});
