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
      const { cmd, args } = SystemAudioCapture.buildCommand('pipewire', {}, '42');
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
      const { cmd, args } = SystemAudioCapture.buildCommand(
        'pulseaudio',
        {},
        'alsa_output.pci-0000_00_1b.0.analog-stereo.monitor',
      );
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

  describe('calculateChunkSize', () => {
    it('calculates correct chunk size for default config', () => {
      // 16kHz * 1 channel * 2 bytes * 0.1s = 3200 bytes
      assert.equal(SystemAudioCapture.calculateChunkSize({}), 3200);
    });

    it('calculates correct chunk size for stereo 48kHz', () => {
      // 48kHz * 2 channels * 2 bytes * 0.1s = 19200 bytes
      assert.equal(
        SystemAudioCapture.calculateChunkSize({ sampleRate: 48000, channels: 2 }),
        19200,
      );
    });

    it('calculates correct chunk size for 200ms duration', () => {
      // 16kHz * 1 channel * 2 bytes * 0.2s = 6400 bytes
      assert.equal(
        SystemAudioCapture.calculateChunkSize({ chunkDurationMs: 200 }),
        6400,
      );
    });
  });

  describe('mixPCM', () => {
    it('returns empty buffer for empty input', () => {
      const result = SystemAudioCapture.mixPCM([]);
      assert.equal(result.length, 0);
    });

    it('returns the same buffer for single input', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt16LE(1000, 0);
      buf.writeInt16LE(-500, 2);
      const result = SystemAudioCapture.mixPCM([buf]);
      assert.equal(result.readInt16LE(0), 1000);
      assert.equal(result.readInt16LE(2), -500);
    });

    it('sums two buffers correctly', () => {
      const buf1 = Buffer.alloc(4);
      const buf2 = Buffer.alloc(4);
      buf1.writeInt16LE(100, 0);
      buf1.writeInt16LE(200, 2);
      buf2.writeInt16LE(300, 0);
      buf2.writeInt16LE(-50, 2);
      const result = SystemAudioCapture.mixPCM([buf1, buf2]);
      assert.equal(result.readInt16LE(0), 400);
      assert.equal(result.readInt16LE(2), 150);
    });

    it('clamps to positive max (32767)', () => {
      const buf1 = Buffer.alloc(2);
      const buf2 = Buffer.alloc(2);
      buf1.writeInt16LE(30000, 0);
      buf2.writeInt16LE(10000, 0);
      const result = SystemAudioCapture.mixPCM([buf1, buf2]);
      assert.equal(result.readInt16LE(0), 32767);
    });

    it('clamps to negative min (-32768)', () => {
      const buf1 = Buffer.alloc(2);
      const buf2 = Buffer.alloc(2);
      buf1.writeInt16LE(-30000, 0);
      buf2.writeInt16LE(-10000, 0);
      const result = SystemAudioCapture.mixPCM([buf1, buf2]);
      assert.equal(result.readInt16LE(0), -32768);
    });

    it('mixes three buffers', () => {
      const buf1 = Buffer.alloc(2);
      const buf2 = Buffer.alloc(2);
      const buf3 = Buffer.alloc(2);
      buf1.writeInt16LE(100, 0);
      buf2.writeInt16LE(200, 0);
      buf3.writeInt16LE(300, 0);
      const result = SystemAudioCapture.mixPCM([buf1, buf2, buf3]);
      assert.equal(result.readInt16LE(0), 600);
    });
  });
});
