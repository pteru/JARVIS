// ---------------------------------------------------------------------------
// Shared helpers for the google-workspace MCP server modules
// ---------------------------------------------------------------------------

// Retry wrapper for Google API calls
export async function withRetry(fn, maxAttempts = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error?.response?.status || error?.code;
      const isRateLimit = status === 429 || status === 503;
      if (isRateLimit && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
}

// Helper: extract doc/spreadsheet/presentation ID from URL or raw ID
export function extractFileId(input) {
  if (!input) return input;
  // Match Google Docs/Sheets/Slides URL patterns
  const urlMatch = input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // If it looks like a raw ID already
  return input.trim();
}

// Shared auth_mode parameter used by every service's tool input schemas
export const authModeParam = {
  type: "string",
  enum: ["service_account", "oauth2"],
  description: "Authentication mode (default: service_account)",
};

export function textResult(text) {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
