import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../../scripts/sg3-monitor/lib/config.mjs';
import { buildClients } from '../../../scripts/sg3-monitor/lib/google-clients.mjs';
import { SheetClient } from '../../../scripts/sg3-monitor/lib/sheet-client.mjs';

const TEST_SHEET_ID = process.env.SG3_TEST_SHEET_ID;

describe('SheetClient', { skip: !TEST_SHEET_ID }, () => {
  let client;
  before(() => {
    const cfg = loadConfig();
    const { sheets } = buildClients(cfg);
    client = new SheetClient(sheets, TEST_SHEET_ID);
  });

  it('reads a tab', async () => {
    const rows = await client.readTab('empresas');
    assert.ok(Array.isArray(rows));
  });
});
