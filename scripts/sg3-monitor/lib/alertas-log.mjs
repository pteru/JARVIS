import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class AlertasLog {
  constructor(path) {
    this.path = path;
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
  }

  keyFor({ linhaId, diasRestantes, dia }) {
    return `${linhaId}:${diasRestantes}:${dia}`;
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  record(key, payload) {
    this.data[key] = { sent_at: new Date().toISOString(), ...payload };
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}
