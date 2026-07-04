import { google } from "googleapis";
import { withRetry, extractFileId, authModeParam, textResult } from "./helpers.js";

// ---------------------------------------------------------------------------
// Google Slides tools
// ---------------------------------------------------------------------------

export const toolDefinitions = [
  {
    name: "create_presentation",
    description: "Create a Google Slides presentation",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Presentation title" },
        template_id: {
          type: "string",
          description: "Optional template presentation ID to copy from",
        },
        auth_mode: authModeParam,
      },
      required: ["title"],
    },
  },
  {
    name: "add_slide",
    description: "Add a slide to a Google Slides presentation",
    inputSchema: {
      type: "object",
      properties: {
        presentation_id: {
          type: "string",
          description: "Presentation ID or URL",
        },
        layout: {
          type: "string",
          description: 'Slide layout (e.g. "TITLE_AND_BODY", "TITLE_ONLY", "BLANK")',
        },
        title: { type: "string", description: "Slide title text" },
        body: { type: "string", description: "Slide body text" },
        auth_mode: authModeParam,
      },
      required: ["presentation_id", "layout"],
    },
  },
  {
    name: "read_presentation",
    description: "Read a Google Slides presentation structure and text",
    inputSchema: {
      type: "object",
      properties: {
        presentation_id: {
          type: "string",
          description: "Presentation ID or URL",
        },
        auth_mode: authModeParam,
      },
      required: ["presentation_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function createPresentation(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
  const drive = google.drive({ version: "v3", auth });
  const slides = google.slides({ version: "v1", auth });

  let presentationId;

  if (args.template_id) {
    // Copy template
    const templateId = extractFileId(args.template_id);
    const copyRes = await withRetry(() =>
      drive.files.copy({
        fileId: templateId,
        requestBody: { name: args.title },
        supportsAllDrives: true,
      }),
    );
    presentationId = copyRes.data.id;
  } else {
    const createRes = await withRetry(() =>
      slides.presentations.create({
        requestBody: { title: args.title },
      }),
    );
    presentationId = createRes.data.presentationId;
  }

  return textResult(
    JSON.stringify(
      {
        presentationId,
        url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        title: args.title,
      },
      null,
      2,
    ),
  );
}

export async function addSlide(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
  const slides = google.slides({ version: "v1", auth });
  const presentationId = extractFileId(args.presentation_id);

  // Generate a unique object ID for the new slide
  const slideId = "slide_" + Date.now().toString(36);

  const requests = [
    {
      createSlide: {
        objectId: slideId,
        slideLayoutReference: {
          predefinedLayout: args.layout || "BLANK",
        },
      },
    },
  ];

  // Create the slide first
  const createRes = await withRetry(() =>
    slides.presentations.batchUpdate({
      presentationId,
      requestBody: { requests },
    }),
  );

  // Now read the slide to find placeholder shape IDs
  if (args.title || args.body) {
    const pres = await withRetry(() =>
      slides.presentations.get({ presentationId }),
    );

    const newSlide = pres.data.slides?.find((s) => s.objectId === slideId);
    if (newSlide) {
      const textRequests = [];
      for (const element of newSlide.pageElements || []) {
        const placeholder = element.shape?.placeholder;
        if (!placeholder) continue;

        if (placeholder.type === "TITLE" || placeholder.type === "CENTERED_TITLE") {
          if (args.title) {
            textRequests.push({
              insertText: {
                objectId: element.objectId,
                text: args.title,
                insertionIndex: 0,
              },
            });
          }
        } else if (
          placeholder.type === "BODY" ||
          placeholder.type === "SUBTITLE"
        ) {
          if (args.body) {
            textRequests.push({
              insertText: {
                objectId: element.objectId,
                text: args.body,
                insertionIndex: 0,
              },
            });
          }
        }
      }

      if (textRequests.length > 0) {
        await withRetry(() =>
          slides.presentations.batchUpdate({
            presentationId,
            requestBody: { requests: textRequests },
          }),
        );
      }
    }
  }

  return textResult(
    JSON.stringify({ slideId, presentationId, layout: args.layout }, null, 2),
  );
}

export async function readPresentation(ctx, args) {
  const auth = await ctx.authManager.getAuth(args.auth_mode);
  const slides = google.slides({ version: "v1", auth });
  const presentationId = extractFileId(args.presentation_id);

  const res = await withRetry(() =>
    slides.presentations.get({ presentationId }),
  );

  const presentation = {
    title: res.data.title,
    slideCount: res.data.slides?.length || 0,
    slides: (res.data.slides || []).map((slide, idx) => {
      const texts = [];
      for (const element of slide.pageElements || []) {
        if (element.shape?.text?.textElements) {
          let slideText = "";
          for (const te of element.shape.text.textElements) {
            if (te.textRun?.content) {
              slideText += te.textRun.content;
            }
          }
          if (slideText.trim()) {
            const placeholder = element.shape?.placeholder?.type || "TEXT";
            texts.push({ type: placeholder, content: slideText.trim() });
          }
        }
      }
      return {
        slideNumber: idx + 1,
        objectId: slide.objectId,
        texts,
      };
    }),
  };

  return textResult(JSON.stringify(presentation, null, 2));
}
