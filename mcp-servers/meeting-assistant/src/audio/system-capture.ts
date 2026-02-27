/**
 * audio/system-capture.ts
 *
 * Captures system audio using PipeWire's `pw-record` or PulseAudio's `parec`.
 * Supports dual-capture mode: mix system audio (sink monitor) + microphone
 * into a single mono PCM stream for STT processing.
 *
 * Output format: raw PCM s16le at configurable sample rate (default 16kHz), mono.
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';

export interface AudioCaptureConfig {
  sampleRate?: number;      // Default: 16000
  channels?: number;        // Default: 1 (mono)
  chunkDurationMs?: number; // Default: 100ms
  device?: string;          // Single target (legacy). Ignored when targets is set.
  /** Multiple capture targets. Each spawns a separate pw-record/parec process; PCM is mixed. */
  targets?: string[];
  /** Indices into `targets` that are sinks (require stream.capture.sink=true for monitor capture). */
  sinkTargetIndices?: number[];
}

type AudioBackend = 'pipewire' | 'pulseaudio';

export class SystemAudioCapture {
  private processes: ChildProcess[] = [];
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
   * Auto-detect audio targets: sink (system audio) and source (microphone).
   * Returns an array of PipeWire node serial numbers or PulseAudio device names.
   */
  static detectTargets(backend: AudioBackend): { sink?: string; mic?: string } {
    const result: { sink?: string; mic?: string } = {};
    try {
      if (backend === 'pipewire') {
        const output = execSync('wpctl status 2>/dev/null', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        // Parse wpctl status output for default sink and source
        // Format: " *  52. USB Advanced Audio Device ..."
        const sinkMatch = output.match(/Sinks:[\s\S]*?\*\s+(\d+)\./);
        const sourceMatch = output.match(/Sources:[\s\S]*?\*\s+(\d+)\./);
        if (sinkMatch) result.sink = sinkMatch[1];
        if (sourceMatch) result.mic = sourceMatch[1];
      } else {
        // PulseAudio
        const sourcesOutput = execSync('pactl list short sources 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const lines = sourcesOutput.split('\n').filter(Boolean);
        const monitorLine = lines.find((l) => l.includes('.monitor'));
        const micLine = lines.find((l) => !l.includes('.monitor') && l.includes('RUNNING'));
        if (monitorLine) result.sink = monitorLine.split('\t')[1];
        if (micLine) result.mic = micLine.split('\t')[1];
      }
    } catch {
      // Auto-detection failed
    }
    return result;
  }

  /**
   * Detect the monitor source for the given backend.
   * Monitor sources capture system audio output (what you hear).
   */
  static detectMonitorSource(backend: AudioBackend): string | undefined {
    try {
      if (backend === 'pipewire') {
        const output = execSync('pw-record --list-targets 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const monitorLine = output.split('\n').find(
          (l) => l.includes('Monitor') || l.includes('monitor'),
        );
        if (monitorLine) {
          const match = monitorLine.match(/^\s*\*?\s*(\d+)/);
          return match ? match[1] : undefined;
        }
      } else {
        const output = execSync('pactl list short sources 2>/dev/null || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const monitorLine = output.split('\n').find((l) => l.includes('.monitor'));
        if (monitorLine) {
          const parts = monitorLine.split('\t');
          return parts[1];
        }
      }
    } catch {
      // Auto-detection failed
    }
    return undefined;
  }

  /**
   * Build the command and arguments for the given backend and a single target.
   * Exported for testing purposes.
   */
  static buildCommand(
    backend: AudioBackend,
    config: AudioCaptureConfig,
    target?: string,
    isSinkTarget?: boolean,
  ): { cmd: string; args: string[] } {
    const sampleRate = config.sampleRate ?? 16000;
    const channels = config.channels ?? 1;

    if (backend === 'pipewire') {
      const args: string[] = [];
      // When targeting a Sink node for monitor capture, set the PipeWire property
      // stream.capture.sink=true so WirePlumber links to the sink's monitor ports
      // instead of redirecting to the associated source (mic).
      if (isSinkTarget) {
        args.push('-P', '{ stream.capture.sink=true }');
      }
      args.push(
        `--format=s16`,
        `--rate=${sampleRate}`,
        `--channels=${channels}`,
      );
      if (target) {
        args.push(`--target=${target}`);
      }
      args.push('-'); // output to stdout
      return { cmd: 'pw-record', args };
    }

    // PulseAudio: monitor sources already have .monitor suffix, no special flag needed
    const args = [
      `--format=s16le`,
      `--rate=${sampleRate}`,
      `--channels=${channels}`,
    ];
    if (target) {
      args.push(`--device=${target}`);
    }
    return { cmd: 'parec', args };
  }

  /**
   * Calculate the chunk size in bytes for a given config.
   */
  static calculateChunkSize(config: AudioCaptureConfig): number {
    const sampleRate = config.sampleRate ?? 16000;
    const channels = config.channels ?? 1;
    const chunkDurationMs = config.chunkDurationMs ?? 100;
    const bytesPerSample = 2; // 16-bit = 2 bytes
    return Math.floor(sampleRate * channels * bytesPerSample * (chunkDurationMs / 1000));
  }

  /**
   * Mix multiple s16le PCM buffers by summing samples with clipping.
   * All buffers must be the same length.
   */
  static mixPCM(buffers: Buffer[]): Buffer {
    if (buffers.length === 0) return Buffer.alloc(0);
    if (buffers.length === 1) return buffers[0];

    const length = buffers[0].length;
    const mixed = Buffer.alloc(length);
    const sampleCount = length / 2; // 16-bit = 2 bytes per sample

    for (let i = 0; i < sampleCount; i++) {
      let sum = 0;
      for (const buf of buffers) {
        sum += buf.readInt16LE(i * 2);
      }
      // Clamp to s16 range
      if (sum > 32767) sum = 32767;
      else if (sum < -32768) sum = -32768;
      mixed.writeInt16LE(sum, i * 2);
    }
    return mixed;
  }

  /**
   * Start capturing audio from one or more targets.
   * When multiple targets are specified, streams are mixed into a single mono output.
   * Audio chunks are delivered via the onChunk callback.
   */
  async start(config: AudioCaptureConfig, onChunk: (chunk: Buffer) => void): Promise<void> {
    if (this.capturing) {
      throw new Error('Audio capture is already running. Call stop() first.');
    }

    const backend = SystemAudioCapture.detectBackend();
    const chunkSize = SystemAudioCapture.calculateChunkSize(config);

    // Determine targets and which ones are sinks (need monitor capture)
    let targets: string[];
    let sinkIndices: Set<number> = new Set();

    if (config.targets && config.targets.length > 0) {
      targets = config.targets;
      // If caller explicitly marked sink targets, use that
      if (config.sinkTargetIndices) {
        sinkIndices = new Set(config.sinkTargetIndices);
      }
    } else if (config.device) {
      targets = [config.device];
    } else {
      // Auto-detect: try to get both sink and mic
      const detected = SystemAudioCapture.detectTargets(backend);
      if (detected.sink && detected.mic) {
        targets = [detected.sink, detected.mic];
        sinkIndices.add(0); // First target is the sink
      } else if (detected.sink) {
        targets = [detected.sink];
        sinkIndices.add(0);
      } else if (detected.mic) {
        targets = [detected.mic];
      } else {
        // Fallback: no target (default device)
        targets = [''];
      }
    }

    this.capturing = true;

    if (targets.length === 1) {
      // Single target — simple capture, no mixing needed
      const isSink = sinkIndices.has(0);
      this.startSingleCapture(backend, config, targets[0] || undefined, chunkSize, onChunk, isSink);
    } else {
      // Multiple targets — capture each, mix PCM
      this.startMixedCapture(backend, config, targets, chunkSize, onChunk, sinkIndices);
    }
  }

  /**
   * Single-target capture (original behavior).
   */
  private startSingleCapture(
    backend: AudioBackend,
    config: AudioCaptureConfig,
    target: string | undefined,
    chunkSize: number,
    onChunk: (chunk: Buffer) => void,
    isSinkTarget = false,
  ): void {
    const { cmd, args } = SystemAudioCapture.buildCommand(backend, config, target, isSinkTarget);
    console.error(`[audio-capture] Starting single: ${cmd} ${args.join(' ')}`);

    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.processes.push(proc);

    let buffer = Buffer.alloc(0);

    proc.stdout?.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= chunkSize) {
        onChunk(buffer.subarray(0, chunkSize));
        buffer = buffer.subarray(chunkSize);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[audio-capture] ${cmd} stderr: ${msg}`);
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

  /**
   * Multi-target capture with PCM mixing.
   * Spawns one process per target, collects aligned chunks, mixes, and emits.
   */
  private startMixedCapture(
    backend: AudioBackend,
    config: AudioCaptureConfig,
    targets: string[],
    chunkSize: number,
    onChunk: (chunk: Buffer) => void,
    sinkIndices: Set<number> = new Set(),
  ): void {
    console.error(`[audio-capture] Starting mixed capture: ${targets.length} targets (${targets.join(', ')}), sinks: [${[...sinkIndices].join(',')}]`);

    // Per-target buffers and chunk queues
    const chunkQueues: Buffer[][] = targets.map(() => []);

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const isSink = sinkIndices.has(i);
      const { cmd, args } = SystemAudioCapture.buildCommand(backend, config, target || undefined, isSink);
      console.error(`[audio-capture]   [${i}] ${cmd} ${args.join(' ')}`);

      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.processes.push(proc);

      let buffer = Buffer.alloc(0);

      proc.stdout?.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= chunkSize) {
          chunkQueues[i].push(buffer.subarray(0, chunkSize));
          buffer = buffer.subarray(chunkSize);
        }
        // When all targets have at least one chunk queued, mix and emit
        this.tryMixAndEmit(chunkQueues, chunkSize, onChunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.error(`[audio-capture] [${i}] stderr: ${msg}`);
      });

      proc.on('error', (err) => {
        console.error(`[audio-capture] [${i}] Process error: ${err.message}`);
      });

      proc.on('close', (code) => {
        if (this.capturing) {
          console.error(`[audio-capture] [${i}] Process exited with code ${code}`);
        }
      });
    }
  }

  /**
   * When all queues have at least one chunk, pop one from each, mix, and emit.
   */
  private tryMixAndEmit(
    queues: Buffer[][],
    chunkSize: number,
    onChunk: (chunk: Buffer) => void,
  ): void {
    while (queues.every((q) => q.length > 0)) {
      const chunks = queues.map((q) => q.shift()!);
      const mixed = SystemAudioCapture.mixPCM(chunks);
      onChunk(mixed);
    }
  }

  /** Stop all audio capture processes. */
  stop(): void {
    this.capturing = false;
    for (const proc of this.processes) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may have already exited
      }
    }
    this.processes = [];
    console.error('[audio-capture] Stopped');
  }

  /** Whether audio is currently being captured. */
  isCapturing(): boolean {
    return this.capturing;
  }
}
