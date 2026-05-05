import { TABS } from './sheet-schema.mjs';
import { makeLogger } from './logger.mjs';

const log = makeLogger('sheet-client');

export class SheetClient {
  constructor(sheets, sheetId) {
    this.sheets = sheets;
    this.sheetId = sheetId;
  }

  async readTab(name) {
    const tab = TABS.find(t => t.name === name);
    if (!tab) throw new Error(`unknown tab: ${name}`);
    const range = `${name}!A1:ZZ`;
    const r = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range });
    const [header, ...rows] = r.data.values ?? [[]];
    if (!header) return [];
    return rows.map(row => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ''])));
  }

  async readAll() {
    const out = {};
    for (const tab of TABS) out[tab.name] = await this.readTab(tab.name);
    return out;
  }

  async writeRows(name, rows, columns) {
    if (rows.length === 0) return;
    const values = rows.map(r => columns.map(c => r[c] ?? ''));
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: `${name}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async overwriteRow(name, rowIndex0Based, columns, row) {
    const values = [columns.map(c => row[c] ?? '')];
    const rangeRow = rowIndex0Based + 2; // +1 for header, +1 for 1-based
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: `${name}!A${rangeRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async batchOverwriteRows(updates) {
    if (updates.length === 0) return;
    const data = updates.map(({ name, rowIndex0Based, columns, row }) => ({
      range: `${name}!A${rowIndex0Based + 2}`,
      values: [columns.map(c => row[c] ?? '')],
    }));
    for (let i = 0; i < data.length; i += 100) {
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 100) },
      });
    }
  }

  async getColumns(name) {
    const r = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: `${name}!A1:ZZ1`,
    });
    return r.data.values?.[0] ?? [];
  }
}
