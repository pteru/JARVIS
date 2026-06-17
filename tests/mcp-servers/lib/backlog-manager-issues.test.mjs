import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installGhStub } from '../../orchestrator/helpers/gh-stub.mjs';
import { listTasks, addTask, completeTask } from '../../../mcp-servers/backlog-manager/issues.mjs';

function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-home-'));
  fs.mkdirSync(path.join(home, 'config', 'orchestrator'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config', 'orchestrator', 'issue-repos.json'), JSON.stringify({ repos: ['o/r'] }));
  fs.writeFileSync(path.join(home, 'config', 'orchestrator', 'workspaces.json'), JSON.stringify({ workspaces: {} }));
  const cacheDir = path.join(home, 'data', 'backlog-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'o__r.json'), JSON.stringify({
    fetchedAt: new Date().toISOString(), repo: 'o/r',
    issues: [{ number: 5, title: 'Existing task', body: '', labels: ['backlog', 'simple'], state: 'open', url: 'u', updatedAt: 'x' }],
  }));
  return home;
}

describe('backlog-manager · issue-backed handlers', () => {
  it('list returns cached open issues as task objects', async () => {
    const home = tmpHome();
    const prev = process.env.ORCHESTRATOR_HOME; process.env.ORCHESTRATOR_HOME = home;
    try {
      const tasks = await listTasks('o/r');
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].number, 5);
      assert.equal(tasks[0].complexity, 'simple');
    } finally {
      if (prev === undefined) delete process.env.ORCHESTRATOR_HOME; else process.env.ORCHESTRATOR_HOME = prev;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('add creates an issue with backlog + complexity labels', async () => {
    const home = tmpHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home; process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    process.env.GH_STUB_CREATE_URL = 'https://github.com/o/r/issues/9';
    try {
      const out = await addTask('o/r', 'New thing', 'high', 'complex');
      assert.match(out, /issues\/9/);
      const create = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'create');
      assert.ok(create.includes('backlog') && create.includes('complex') && create.includes('high'));
    } finally {
      if (prev.home === undefined) delete process.env.ORCHESTRATOR_HOME; else process.env.ORCHESTRATOR_HOME = prev.home;
      if (prev.path === undefined) delete process.env.PATH; else process.env.PATH = prev.path;
      delete process.env.GH_STUB_LOG; delete process.env.GH_STUB_CREATE_URL;
      gh.cleanup(); fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('complete closes by issue number', async () => {
    const home = tmpHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home; process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    try {
      const out = await completeTask('o/r', '5');
      assert.match(out, /issues\/5/);
      const close = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'close');
      assert.ok(close.includes('5'));
    } finally {
      if (prev.home === undefined) delete process.env.ORCHESTRATOR_HOME; else process.env.ORCHESTRATOR_HOME = prev.home;
      if (prev.path === undefined) delete process.env.PATH; else process.env.PATH = prev.path;
      delete process.env.GH_STUB_LOG;
      gh.cleanup(); fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('complete closes by unique title substring', async () => {
    const home = tmpHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home; process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    try {
      const out = await completeTask('o/r', 'Existing');
      assert.match(out, /issues\/5/);
      const close = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'close');
      assert.ok(close.includes('5'));
    } finally {
      if (prev.home === undefined) delete process.env.ORCHESTRATOR_HOME; else process.env.ORCHESTRATOR_HOME = prev.home;
      if (prev.path === undefined) delete process.env.PATH; else process.env.PATH = prev.path;
      delete process.env.GH_STUB_LOG;
      gh.cleanup(); fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
