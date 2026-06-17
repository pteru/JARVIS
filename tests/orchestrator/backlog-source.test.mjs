import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote, resolveRepo, configuredRepos, resolveWorkspaceByRepo } from '../../scripts/lib/backlog-source.mjs';

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
