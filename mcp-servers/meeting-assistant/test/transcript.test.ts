import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptAccumulator } from '../src/transcript.js';

describe('TranscriptAccumulator', () => {
  let acc: TranscriptAccumulator;

  beforeEach(() => {
    acc = new TranscriptAccumulator();
  });

  describe('session lifecycle', () => {
    it('starts with no session and no lines', () => {
      assert.equal(acc.getSessionId(), null);
      assert.equal(acc.getCount(), 0);
    });

    it('sets session ID on startSession', () => {
      acc.startSession('test-001');
      assert.equal(acc.getSessionId(), 'test-001');
    });

    it('clears lines on startSession', () => {
      acc.append('A', 'hello');
      assert.equal(acc.getCount(), 1);
      acc.startSession('test-002');
      assert.equal(acc.getCount(), 0);
    });

    it('clears session ID on endSession but preserves lines', () => {
      acc.startSession('test-003');
      acc.append('A', 'hello');
      acc.endSession();
      assert.equal(acc.getSessionId(), null);
      assert.equal(acc.getCount(), 1);
    });
  });

  describe('append', () => {
    it('adds a line with timestamp, speaker, and text', () => {
      const line = acc.append('Pedro', 'Hello world');
      assert.equal(line.speaker, 'Pedro');
      assert.equal(line.text, 'Hello world');
      assert.ok(line.timestamp.match(/^\d{4}-\d{2}-\d{2}T/), 'timestamp should be ISO 8601');
    });

    it('trims speaker and text', () => {
      const line = acc.append('  Pedro  ', '  Hello  ');
      assert.equal(line.speaker, 'Pedro');
      assert.equal(line.text, 'Hello');
    });

    it('defaults empty speaker to Unknown', () => {
      const line = acc.append('', 'Hello');
      assert.equal(line.speaker, 'Unknown');
    });

    it('increments count', () => {
      acc.append('A', 'one');
      acc.append('B', 'two');
      acc.append('C', 'three');
      assert.equal(acc.getCount(), 3);
    });
  });

  describe('getAll', () => {
    it('returns a copy of all lines', () => {
      acc.append('A', 'one');
      acc.append('B', 'two');
      const all = acc.getAll();
      assert.equal(all.length, 2);
      // Should be a copy, not a reference
      all.push({ timestamp: 'fake', speaker: 'X', text: 'injected' });
      assert.equal(acc.getCount(), 2);
    });
  });

  describe('getSince', () => {
    it('returns lines from given index', () => {
      acc.append('A', 'one');
      acc.append('B', 'two');
      acc.append('C', 'three');

      const since1 = acc.getSince(1);
      assert.equal(since1.length, 2);
      assert.equal(since1[0].text, 'two');
      assert.equal(since1[1].text, 'three');
    });

    it('returns empty when index equals count', () => {
      acc.append('A', 'one');
      assert.equal(acc.getSince(1).length, 0);
    });

    it('returns all when index is 0', () => {
      acc.append('A', 'one');
      acc.append('B', 'two');
      assert.equal(acc.getSince(0).length, 2);
    });
  });

  describe('format', () => {
    it('formats all lines by default', () => {
      acc.append('Pedro', 'Hello');
      acc.append('Guest', 'Hi there');
      const output = acc.format();
      const lines = output.split('\n');
      assert.equal(lines.length, 2);
      assert.ok(lines[0].includes('] Pedro: Hello'));
      assert.ok(lines[1].includes('] Guest: Hi there'));
    });

    it('formats a subset of lines when provided', () => {
      acc.append('A', 'one');
      acc.append('B', 'two');
      acc.append('C', 'three');
      const subset = acc.getSince(2);
      const output = acc.format(subset);
      assert.equal(output.split('\n').length, 1);
      assert.ok(output.includes('] C: three'));
    });

    it('returns empty string when no lines', () => {
      assert.equal(acc.format(), '');
    });
  });

  describe('clear', () => {
    it('removes all lines', () => {
      acc.append('A', 'one');
      acc.append('B', 'two');
      acc.clear();
      assert.equal(acc.getCount(), 0);
      assert.equal(acc.getAll().length, 0);
    });
  });
});
