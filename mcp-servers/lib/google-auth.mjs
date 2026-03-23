/**
 * Shared Google API authentication helper.
 *
 * Provides service account + domain-wide delegation auth for Google APIs.
 * Used by: services/pr-review/upload-to-drive.mjs, services/pr-review/notify-chat.mjs,
 *          mcp-servers/google-workspace/index.js
 *
 * Usage:
 *   import { createGoogleAuth } from '../../mcp-servers/lib/google-auth.mjs';
 *
 *   const auth = createGoogleAuth({
 *     credentialsPath: '/path/to/gcp-service-account.json',
 *     scopes: ['https://www.googleapis.com/auth/drive'],
 *     subject: 'user@domain.com',
 *   });
 *
 *   const drive = google.drive({ version: 'v3', auth });
 */
import { readFileSync } from 'fs';
import { google } from 'googleapis';

/**
 * Create an authenticated Google API client using a service account.
 *
 * @param {Object} options
 * @param {string} options.credentialsPath - Path to GCP service account JSON key file
 * @param {string[]} options.scopes - OAuth2 scopes to request
 * @param {string} [options.subject] - Email to impersonate via domain-wide delegation
 * @returns {import('googleapis').Auth.GoogleAuth} Authenticated GoogleAuth instance
 */
export function createGoogleAuth({ credentialsPath, scopes, subject }) {
  const keyContent = readFileSync(credentialsPath, 'utf-8');
  const credentials = JSON.parse(keyContent);

  const authOptions = {
    credentials,
    scopes,
  };

  if (subject) {
    authOptions.clientOptions = { subject };
  }

  return new google.auth.GoogleAuth(authOptions);
}
