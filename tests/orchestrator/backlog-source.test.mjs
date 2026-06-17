import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRemote, resolveRepo, configuredRepos, resolveWorkspaceByRepo } from '../../scripts/lib/backlog-source.mjs';
import { refreshCache, listIssues, createIssue, closeIssue } from '../../scripts/lib/backlog-source.mjs';
import { installGhStub } from './helpers/gh-stub.mjs';

describe('backlog-source · repo resolution', () => {
  it('parses an ssh remote', () => {
    assert.deepEqual(parseRemote('git@github.com:strokmatic/diemaster.git'),
      { owner: 'strokmatic', repo: 'diemaster', slug: 'strokmatic/diemaster' });
  });

  it('parses an https remote (with and without .git)', () => {
    assert.equal(parseRemote('https://github.com/strokmatic/infra.git').slug, 'strokmatic/infra');
    assert.equal(parseRemote('https://github.com/strokmatic/infra').slug, 'strokmatic/infra');
  });

  it('returns null for a non-github or empty remote', () => {
    assert.equal(parseRemote(''), null);
    assert.equal(parseRemote('git@gitlab.com:x/y.git'), null);
  });

  it('resolves the orchestrator workspace to pteru/JARVIS', async () => {
    assert.equal((await resolveRepo('orchestrator')).slug, 'pteru/JARVIS');
  });

  it('accepts an owner/repo slug verbatim', async () => {
    assert.equal((await resolveRepo('strokmatic/visionking')).slug, 'strokmatic/visionking');
  });

  it('resolves a real workspace via workspaces.json remotes.origin', async () => {
    assert.equal((await resolveRepo('strokmatic.diemaster')).slug, 'strokmatic/diemaster');
  });

  it('lists the 10 configured repos', async () => {
    assert.equal((await configuredRepos()).length, 10);
  });

  it('reverse-maps a repo slug to a workspace (round-trips via resolveRepo)', async () => {
    assert.equal(await resolveWorkspaceByRepo('pteru/JARVIS'), 'orchestrator');
    const ws = await resolveWorkspaceByRepo('strokmatic/diemaster');
    assert.ok(ws, 'expected a workspace for strokmatic/diemaster');
    assert.equal((await resolveRepo(ws)).slug, 'strokmatic/diemaster');
  });
});

function withTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-home-'));
  fs.mkdirSync(path.join(home, 'config', 'orchestrator'), { recursive: true });
  fs.writeFileSync(path.join(home, 'config', 'orchestrator', 'issue-repos.json'),
    JSON.stringify({ repos: ['o/r'], default_label: 'backlog' }));
  fs.writeFileSync(path.join(home, 'config', 'orchestrator', 'workspaces.json'),
    JSON.stringify({ workspaces: {} }));
  return home;
}

const SAMPLE = JSON.stringify([
  { number: 7, title: 'Do a thing', body: 'b', state: 'OPEN', url: 'https://github.com/o/r/issues/7',
    updatedAt: '2026-06-16T00:00:00Z', labels: [{ name: 'backlog' }, { name: 'complex' }] },
]);

describe('backlog-source · cache + listIssues', () => {
  it('refreshes the cache from gh and lists issues with flattened labels', async () => {
    const home = withTempHome();
    const issuesJson = path.join(home, 'issues.json');
    fs.writeFileSync(issuesJson, SAMPLE);
    const gh = installGhStub();
    const prevHome = process.env.ORCHESTRATOR_HOME, prevPath = process.env.PATH;
    process.env.ORCHESTRATOR_HOME = home;
    process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    process.env.GH_STUB_LIST_JSON = issuesJson;
    try {
      const res = await refreshCache(['o/r']);
      assert.deepEqual(res, [{ repo: 'o/r', count: 1 }]);
      const issues = await listIssues('o/r', { refresh: 'never' });
      assert.equal(issues.length, 1);
      assert.deepEqual(issues[0].labels, ['backlog', 'complex']);
      const argv = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'list');
      assert.ok(argv.includes('--repo') && argv.includes('o/r') && argv.includes('--label') && argv.includes('backlog'));
    } finally {
      if (prevHome === undefined) delete process.env.ORCHESTRATOR_HOME; else process.env.ORCHESTRATOR_HOME = prevHome;
      if (prevPath === undefined) delete process.env.PATH; else process.env.PATH = prevPath;
      delete process.env.GH_STUB_LOG;
      delete process.env.GH_STUB_LIST_JSON; gh.cleanup();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('serves stale cache when gh fails (refresh never throws on read)', async () => {
    const home = withTempHome();
    const cacheDir = path.join(home, 'data', 'backlog-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'o__r.json'),
      JSON.stringify({ fetchedAt: '2000-01-01T00:00:00Z', repo: 'o/r',
        issues: [{ number: 1, title: 'old', body: '', labels: ['backlog'], state: 'open', url: 'u', updatedAt: 'x' }] }));
    const gh = installGhStub();
    const prevHome = process.env.ORCHESTRATOR_HOME, prevPath = process.env.PATH;
    process.env.ORCHESTRATOR_HOME = home;
    process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    process.env.GH_STUB_EXIT = '1'; // gh fails
    try {
      const issues = await listIssues('o/r', { refresh: 'if-stale' });
      assert.equal(issues.length, 1);
      assert.equal(issues[0].title, 'old');
    } finally {
      if (prevHome === undefined) delete process.env.ORCHESTRATOR_HOME; else process.env.ORCHESTRATOR_HOME = prevHome;
      if (prevPath === undefined) delete process.env.PATH; else process.env.PATH = prevPath;
      delete process.env.GH_STUB_LOG;
      delete process.env.GH_STUB_EXIT; gh.cleanup();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('backlog-source · createIssue/closeIssue', () => {
  it('ensures labels then creates an issue and returns number+url', async () => {
    const home = withTempHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home;
    process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    process.env.GH_STUB_CREATE_URL = 'https://github.com/o/r/issues/42';
    try {
      const res = await createIssue('o/r', { title: 'T', body: 'B', labels: ['backlog', 'medium'] });
      assert.deepEqual(res, { number: 42, url: 'https://github.com/o/r/issues/42' });
      const argv = gh.readArgs();
      assert.ok(argv.some(a => a[0] === 'label' && a[1] === 'create' && a.includes('backlog')));
      const create = argv.find(a => a[0] === 'issue' && a[1] === 'create');
      assert.ok(create.includes('--title') && create.includes('T') && create.includes('--label') && create.includes('backlog'));
    } finally {
      if (prev.home === undefined) delete process.env.ORCHESTRATOR_HOME; else process.env.ORCHESTRATOR_HOME = prev.home;
      if (prev.path === undefined) delete process.env.PATH; else process.env.PATH = prev.path;
      delete process.env.GH_STUB_LOG; delete process.env.GH_STUB_CREATE_URL;
      gh.cleanup(); fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('closes an issue with a comment', async () => {
    const home = withTempHome();
    const gh = installGhStub();
    const prev = { home: process.env.ORCHESTRATOR_HOME, path: process.env.PATH };
    process.env.ORCHESTRATOR_HOME = home;
    process.env.PATH = gh.env.PATH;
    process.env.GH_STUB_LOG = gh.env.GH_STUB_LOG;
    try {
      const res = await closeIssue('o/r', { number: 7, comment: 'done' });
      assert.equal(res.number, 7);
      const close = gh.readArgs().find(a => a[0] === 'issue' && a[1] === 'close');
      assert.ok(close.includes('7') && close.includes('--comment') && close.includes('done'));
    } finally {
      if (prev.home === undefined) delete process.env.ORCHESTRATOR_HOME; else process.env.ORCHESTRATOR_HOME = prev.home;
      if (prev.path === undefined) delete process.env.PATH; else process.env.PATH = prev.path;
      delete process.env.GH_STUB_LOG;
      gh.cleanup(); fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
