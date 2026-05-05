import { resolve } from 'node:path';
import { google } from 'googleapis';
import { createGoogleAuth } from '../../../mcp-servers/lib/google-auth.mjs';
import { ROOT_DIR } from './config.mjs';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.spaces',
];

export function buildClients(config) {
  const auth = createGoogleAuth({
    credentialsPath: resolve(ROOT_DIR, config.service_account_path),
    scopes: SCOPES,
    subject: config.impersonate_subject,
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    drive:  google.drive({ version: 'v3', auth }),
    gmail:  google.gmail({ version: 'v1', auth }),
    chat:   google.chat({ version: 'v1', auth }),
  };
}
