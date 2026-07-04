import fs from "fs/promises";
import path from "path";
import { google } from "googleapis";
import { ORCHESTRATOR_HOME } from "../../lib/config-loader.js";
import { textResult, errorResult } from "./helpers.js";

const CREDENTIALS_DIR = path.join(ORCHESTRATOR_HOME, "config", "credentials");
const SERVICE_ACCOUNT_PATH = path.join(CREDENTIALS_DIR, "gcp-service-account.json");
const OAUTH_CONFIG_PATH = path.join(CREDENTIALS_DIR, "google-oauth-config.json");
const OAUTH_TOKENS_PATH = path.join(CREDENTIALS_DIR, "google-oauth-tokens.json");

// Subject impersonated via domain-wide delegation (service-account mode)
const IMPERSONATION_SUBJECT = "pedro@lumesolutions.com";

// Canonical OAuth scope list. The pre-split code carried three copies of this
// list (service-account auth, OAuth2 consent URL x2) that were identical as
// sets, differing only in ordering — hoisted to a single array here.
const GOOGLE_API_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
  "https://www.googleapis.com/auth/chat.messages",
];

// ---------------------------------------------------------------------------
// Auth Manager — dual-mode authentication
// ---------------------------------------------------------------------------

export class AuthManager {
  constructor() {
    this._serviceAccountAuth = null;
    this._oauth2Client = null;
  }

  async getAuth(mode = "service_account") {
    if (mode === "oauth2") {
      return await this.getOAuth2Client();
    }
    return await this.getServiceAccountAuth();
  }

  async getServiceAccountAuth() {
    if (this._serviceAccountAuth) return this._serviceAccountAuth;

    const keyContent = await fs.readFile(SERVICE_ACCOUNT_PATH, "utf-8");
    const key = JSON.parse(keyContent);

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: GOOGLE_API_SCOPES,
      clientOptions: {
        subject: IMPERSONATION_SUBJECT,
      },
    });

    this._serviceAccountAuth = auth;
    return auth;
  }

  async getOAuth2Client() {
    if (this._oauth2Client) return this._oauth2Client;

    const configContent = await fs.readFile(OAUTH_CONFIG_PATH, "utf-8");
    const config = JSON.parse(configContent);
    const { client_id, client_secret, redirect_uri } = config;

    const client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

    // Try to load stored tokens
    try {
      const tokensContent = await fs.readFile(OAUTH_TOKENS_PATH, "utf-8");
      const tokens = JSON.parse(tokensContent);
      client.setCredentials(tokens);

      // Set up automatic token refresh persistence
      client.on("tokens", async (newTokens) => {
        try {
          let existing = tokens;
          if (newTokens.refresh_token) {
            existing.refresh_token = newTokens.refresh_token;
          }
          existing.access_token = newTokens.access_token;
          existing.expiry_date = newTokens.expiry_date;
          await fs.writeFile(OAUTH_TOKENS_PATH, JSON.stringify(existing, null, 2), "utf-8");
        } catch {
          // Silently ignore token persistence errors
        }
      });
    } catch {
      // No tokens stored — caller must use google_oauth_callback flow
      throw new Error(
        "No OAuth2 tokens found. Please authorize first. Visit this URL:\n" +
          client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: GOOGLE_API_SCOPES,
          }),
      );
    }

    this._oauth2Client = client;
    return client;
  }

  // NOTE: currently unused — kept for behavior preservation during the
  // per-service module split.
  getOAuth2AuthUrl() {
    // Build a client without tokens just to generate the URL
    return fs
      .readFile(OAUTH_CONFIG_PATH, "utf-8")
      .then((content) => {
        const config = JSON.parse(content);
        const client = new google.auth.OAuth2(
          config.client_id,
          config.client_secret,
          config.redirect_uri,
        );
        return client.generateAuthUrl({
          access_type: "offline",
          prompt: "consent",
          scope: GOOGLE_API_SCOPES,
        });
      });
  }

  async exchangeCode(code) {
    const configContent = await fs.readFile(OAUTH_CONFIG_PATH, "utf-8");
    const config = JSON.parse(configContent);
    const client = new google.auth.OAuth2(
      config.client_id,
      config.client_secret,
      config.redirect_uri,
    );

    const { tokens } = await client.getToken(code);
    await fs.mkdir(path.dirname(OAUTH_TOKENS_PATH), { recursive: true });
    await fs.writeFile(OAUTH_TOKENS_PATH, JSON.stringify(tokens, null, 2), "utf-8");

    client.setCredentials(tokens);
    this._oauth2Client = client;

    return tokens;
  }

  clearCache() {
    this._serviceAccountAuth = null;
    this._oauth2Client = null;
  }
}

// ---------------------------------------------------------------------------
// OAuth callback tool
// ---------------------------------------------------------------------------

export const toolDefinitions = [
  {
    name: "google_oauth_callback",
    description: "Exchange an OAuth2 authorization code for tokens",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Authorization code from OAuth flow" },
      },
      required: ["code"],
    },
  },
];

export async function oauthCallback(ctx, args) {
  try {
    const tokens = await ctx.authManager.exchangeCode(args.code);
    return textResult(
      JSON.stringify(
        {
          success: true,
          message: "OAuth2 tokens stored successfully",
          has_refresh_token: !!tokens.refresh_token,
          expiry_date: tokens.expiry_date,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    return errorResult(`OAuth2 token exchange failed: ${error.message}`);
  }
}
