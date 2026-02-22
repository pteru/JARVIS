/**
 * audio/system-capture.ts
 *
 * Captures system audio output using PipeWire's `pw-record` or PulseAudio's `parec`.
 * Outputs raw PCM s16le at 16kHz mono, streamed via stdout to a callback.
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';

export interface AudioCaptureConfig {
  sampleRate?: number;      // Default: 16000
  channels?: number;        // Default: 1 (mono)
  chunkDurationMs?: number; // Default: 100ms
  device?: string;          // Specific PipeWire/PulseAudio source (auto-detect if omitted)
}

type AudioBackend = 'pipewire' | 'pulseaudio';

export class SystemAudioCapture {
  private process: ChildProcess | null = null;
  private capturing = false;

  /**
   * Detect which audio backend is available.
   * Checks for pw-record (PipeWire) first, then parec (PulseAudio).
   */
  static detectBackend(): AudioBackend {
    try {
      execSync('which pw-record', { stdio: 'pipe' });
      return 'pipewire';
    } catch {
      // pw-record not found, try parec
    }
    try {
      execSync('which parec', { stdio: 'pipe' });
      return 'pulseaudio';
    } catch {
      // parec not found either
    }
    throw new Error(
      'No audio capture backend found. Install PipeWire (pw-record) or PulseAudio (parec).',
    );
  }

  /**
   * Detect the monitor source for the given backend.
   * Monitor sources capture system audio output (what you hear).
   */
  static detectMonitorSource(backend: AudioBackend): string | undefined {
    try {
      if (backend === 'pipewire') {
        // pw-record --list-targets lists available targets; look for Monitor
        const output = execSync('pw-record --list-targets 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const monitorLine = output.split('\n').find(
          (l) => l.includes('Monitor') || l.includes('monitor'),
        );
        if (monitorLine) {
          // Extract the target ID/name (varies by system)
          const match = monitorLine.match(/^\s*\*?\s*(\d+)/);
          return match ? match[1] : undefined;
        }
      } else {
        // PulseAudio: find monitor source
        const output = execSync('pactl list short sources 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const monitorLine = output.split('\n').find((l) => l.includes('.monitor'));
        if (monitorLine) {
          const parts = monitorLine.split('\t');
          return parts[1]; // source name
        }
      }
    } catch {
      // Auto-detection failed — will use default
    }
    return undefined;
  }

  /**
   * Build the command and arguments for the given backend.
   * Exported for testing purposes.
   */
  static buildCommand(
    backend: AudioBackend,
    config: AudioCaptureConfig,
  ): { cmd: string; args: string[] } {
    const sampleRate = config.sampleRate ?? 16000;
    const channels = config.channels ?? 1;

    if (backend === 'pipewire') {
      const args = [
        `--format=s16`,
        `--rate=${sampleRate}`,
        `--channels=${channels}`,
      ];
      if (config.device) {
        args.push(`--target=${config.device}`);
      }
      args.push('-'); // output to stdout
      return { cmd: 'pw-record', args };
    }

    // PulseAudio
    const args = [
      `--format=s16le`,
      `--rate=${sampleRate}`,
      `--channels=${channels}`,
    ];
    if (config.device) {
      args.push(`--device=${config.device}`);
    }
    return { cmd: 'parec', args };
  }

  /**
   * Start capturing system audio.
   * Audio chunks are delivered via the onChunk callback.
   */
  async start(config: AudioCaptureConfig, onChunk: (chunk: Buffer) => void): Promise<void> {
    if (this.capturing) {
      throw new Error('Audio capture is already running. Call stop() first.');
    }

    const backend = SystemAudioCapture.detectBackend();
    const sampleRate = config.sampleRate ?? 16000;
    const channels = config.channels ?? 1;
    const chunkDurationMs = config.chunkDurationMs ?? 100;

    // Auto-detect monitor source if not specified
    if (!config.device) {
      const monitor = SystemAudioCapture.detectMonitorSource(backend);
      if (monitor) {
        config = { ...config, device: monitor };
      }
    }

    const { cmd, args } = SystemAudioCapture.buildCommand(backend, config);

    console.error(`[audio-capture] Starting: ${cmd} ${args.join(' ')}`);

    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process = proc;
    this.capturing = true;

    // Calculate chunk size: sampleRate * channels * bytesPerSample * (duration / 1000)
    const bytesPerSample = 2; // 16-bit = 2 bytes
    const chunkSize = Math.floor(sampleRate * channels * bytesPerSample * (chunkDurationMs / 1000));

    // Buffer incoming data and emit in consistent chunk sizes
    let buffer = Buffer.alloc(0);

    proc.stdout?.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= chunkSize) {
        const chunk = buffer.subarray(0, chunkSize);
        buffer = buffer.subarray(chunkSize);
        onChunk(chunk);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error(`[audio-capture] ${cmd} stderr: ${msg}`);
      }
    });

    proc.on('error', (err) => {
      console.error(`[audio-capture] Process error: ${err.message}`);
      this.capturing = false;
    });

    proc.on('close', (code) => {
      if (this.capturing) {
        console.error(`[audio-capture] Process exited with code ${code}`);
        this.capturing = false;
      }
    });
  }

  /** Stop the audio capture process. */
  stop(): void {
    if (this.process) {
      this.capturing = false;
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Process may have already exited
      }
      this.process = null;
      console.error('[audio-capture] Stopped');
    }
  }

  /** Whether audio is currently being captured. */
  isCapturing(): boolean {
    return this.capturing;
  }
}
