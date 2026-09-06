/**
 * AI Web-Design Agent — reads and writes the iROC GmbH and Spirecut Patient
 * website source files using OpenAI tool-calling.
 *
 * POST /api/iroc/agent/chat
 *   body: { history: [{role, content}][], message: string, website: 'iroc' | 'spirecut' | 'both' }
 *   response: { reply: string, toolsUsed: ToolActivity[] }
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireIrocAuth } from "./iroc.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as babelParser from "@babel/parser";

const router: IRouter = Router();

// ── Workspace root ────────────────────────────────────────────────────────────
// dist/index.mjs is at artifacts/api-server/dist/index.mjs
// so three levels up is the workspace root.
const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(DIST_DIR, "../../..");

// ── Access control ────────────────────────────────────────────────────────────
const READABLE_ROOTS = [
  "artifacts/iroc-website/src",
  "artifacts/spirecut-patient/src",
];
const WRITABLE_ROOTS = [
  "artifacts/iroc-website/src",
  "artifacts/spirecut-patient/src",
];

function absAllowed(relPath: string, roots: string[]): string | null {
  const abs = path.resolve(WORKSPACE_ROOT, relPath);
  const ok = roots.some((r) =>
    abs.startsWith(path.resolve(WORKSPACE_ROOT, r)),
  );
  return ok ? abs : null;
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolListFiles(relPath: string): Promise<string> {
  const abs = absAllowed(relPath, READABLE_ROOTS);
  if (!abs) return "Access denied — path is outside the allowed website directories.";
  try {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    if (entries.length === 0) return "(empty directory)";
    return entries
      .map((e) => `${e.isDirectory() ? "[dir] " : "      "}${e.name}`)
      .join("\n");
  } catch (err) {
    return `Error: ${String(err)}`;
  }
}

async function toolReadFile(relPath: string): Promise<string> {
  const abs = absAllowed(relPath, READABLE_ROOTS);
  if (!abs) return "Access denied — path is outside the allowed website directories.";
  try {
    const content = await fs.readFile(abs, "utf8");
    // Truncate very large files to stay within token budget
    if (content.length > 60_000) {
      return (
        content.slice(0, 60_000) +
        `\n\n[... TRUNCATED — file is ${content.length} chars, showing first 60,000 ...]`
      );
    }
    return content;
  } catch (err) {
    return `Error reading file: ${String(err)}`;
  }
}

/**
 * Pre-validate TypeScript / JSX syntax before writing.
 * Returns an error string if the content is syntactically broken, null if OK.
 * Prevents the agent from leaving source files in a broken state.
 */
function validateSourceSyntax(content: string, relPath: string): string | null {
  if (!/\.(tsx?|jsx?)$/.test(relPath)) return null;
  const isTS  = /\.tsx?$/.test(relPath);
  const isJSX = /\.(tsx|jsx)$/.test(relPath);
  try {
    babelParser.parse(content, {
      sourceType: "module",
      plugins: [
        ...(isTS  ? (["typescript"] as const) : []),
        ...(isJSX ? (["jsx"]        as const) : []),
      ],
    });
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function toolWriteFile(relPath: string, content: string): Promise<string> {
  const abs = absAllowed(relPath, WRITABLE_ROOTS);
  if (!abs)
    return "Write denied — only files under artifacts/iroc-website/src or artifacts/spirecut-patient/src may be written.";

  // Reject before touching disk if the content has a syntax error
  const syntaxError = validateSourceSyntax(content, relPath);
  if (syntaxError) {
    return (
      `Write REJECTED — syntax error in ${relPath}. The existing file was NOT modified.\n\n` +
      `Error: ${syntaxError}\n\n` +
      `Fix the syntax and call write_file again.`
    );
  }

  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return `✓ Wrote ${content.split("\n").length} lines (${content.length} chars) to ${relPath}`;
  } catch (err) {
    return `Error writing file: ${String(err)}`;
  }
}

// ── OpenAI tools schema ───────────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description:
        "List the files and sub-directories inside a given directory. Only works within artifacts/iroc-website/src and artifacts/spirecut-patient/src.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Relative path from workspace root, e.g. 'artifacts/iroc-website/src/pages'",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the complete content of a source file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Relative path from workspace root, e.g. 'artifacts/iroc-website/src/pages/Home.tsx'",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file with complete new content. Always write the FULL file — never partial. The path must be within artifacts/iroc-website/src or artifacts/spirecut-patient/src.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path from workspace root",
          },
          content: {
            type: "string",
            description: "Complete file content to write (not a diff — full content)",
          },
        },
        required: ["path", "content"],
      },
    },
  },
];

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert JavaScript, TypeScript, and React website designer and developer. You are directly integrated into the admin panel and have full control over two live websites via file-system tools.

## Your capabilities
- Read any file in the two website source directories
- Write (create or overwrite) any file — changes are picked up instantly by the Vite dev server (HMR)
- Add new pages, redesign existing ones, change text, fix bugs, add translations, and implement any feature

## The two websites you manage

### 1. iROC GmbH Website — artifacts/iroc-website/src/
The company's main professional medical website.

**Tech stack:** React 18 + TypeScript + Tailwind CSS + shadcn/ui + Wouter routing + React Query

**Key files:**
- src/App.tsx — root app (uses PAGE_LINKS; do not add routes here directly)
- src/config/navLinks.ts — **THE SINGLE SOURCE OF TRUTH for all pages and routing**
- src/pages/ — page components (Home, Events, Spirecut, MiniStem, Doctors, Order, Contact, …)
- src/components/ — Layout.tsx, Navigation.tsx, TeamSection.tsx, DynamicSections.tsx, …
- src/components/ui/ — shadcn/ui primitive components
- src/hooks/useWebsiteSettings.ts — returns all CMS settings from DB
- src/contexts/LanguageContext.tsx — exports useLanguage() hook
- src/index.css — global styles and CSS custom properties

**Adding a new page to iROC website:**
1. Create src/pages/MyPage.tsx
2. Add one entry to PAGE_LINKS in src/config/navLinks.ts:
   { href: '/my-page', labelDE: 'Titel DE', labelEN: 'Title EN', inFooter: true, group: 'flat', component: lazy(() => import('@/pages/MyPage')) }
   Valid group values: 'flat' (top nav link), 'product' (Products dropdown), 'service' (Services dropdown), 'hidden' (routed but not in nav)
   That is all — routing and navigation update automatically.

**Language handling in iROC website:**
Every page imports useLanguage and uses the t() helper inline:
  import { useLanguage } from '@/contexts/LanguageContext';
  const { t } = useLanguage();
  // Usage: t('Deutschertext', 'English text')
Never use hard-coded strings — always wrap in t().

**useWebsiteSettings pattern:**
  import { useWebsiteSettings } from '@/hooks/useWebsiteSettings';
  const ws = useWebsiteSettings();
  ws.ws_hero_image_url  ws.ws_footer_email  ws.ws_company_name  etc.

---

### 2. Spirecut Patient Website — artifacts/spirecut-patient/src/
Patient-facing website for the Spirecut hand surgery product.

**Tech stack:** React 18 + TypeScript + Tailwind CSS + shadcn/ui + Wouter routing + react-i18next

**Key files:**
- src/App.tsx — root app + routes for utility/hidden pages (add Route here for hidden pages)
- src/config/navLinks.ts — PAGE_LINKS array for nav-linked pages
- src/pages/ — Home, HowItWorks, PraktischeInformationen, PostoperativeEntwicklung, FAQ, Kontakt, FindDoctor, Karpaltunnelsyndrom, Schnappfinger, Impressum, Datenschutz, Admin, not-found
- src/components/ — Layout.tsx, Navigation.tsx, Chatbot.tsx, …
- src/components/ui/ — shadcn/ui primitives
- src/locales/de.json — German translation keys
- src/locales/en.json — English translation keys
- src/i18n.ts — i18next setup (loads CMS overrides from API)
- src/hooks/useSpirecutSettings.ts — CMS settings hook

**Adding a new page to Spirecut:**
For nav-linked pages:
1. Create src/pages/MyPage.tsx
2. Add to PAGE_LINKS in navLinks.ts: { href: '/my-page', navLabelKey: 'nav.myPage', footerLabelKey: 'footer.links.myPage', Icon: SomeIcon, component: lazy(() => import('@/pages/MyPage')) }
3. Add 'nav.myPage' and 'footer.links.myPage' to BOTH src/locales/de.json AND src/locales/en.json

For utility/hidden pages:
1. Create src/pages/MyPage.tsx
2. Import it in App.tsx (with lazy) and add: <Route path="/my-page" component={MyPage} />

**Language handling in Spirecut:**
Uses react-i18next. In every page/component:
  import { useTranslation } from 'react-i18next';
  const { t } = useTranslation();
  t('nav.myPage')   ← looks up key in de.json or en.json
  t('home.title', { defaultValue: 'Fallback text' })

When adding new content: add translation keys to BOTH locales/de.json AND locales/en.json.

---

## Workflow
1. Read the relevant files first to understand the current state before making changes
2. Write complete updated file contents (never partial — always the full file)
3. For new pages: update BOTH the page file AND the router file (navLinks.ts or App.tsx)
4. For Spirecut translations: always update both de.json and en.json
5. Changes apply automatically — no build step needed in development

## Code standards
- Tailwind CSS for all styling — no inline styles unless a value is dynamic
- TypeScript — no implicit 'any', keep types correct
- shadcn/ui components from '@/components/ui/'
- Wouter Link for internal navigation: import { Link } from 'wouter'
- Keep existing import style, naming conventions, and file structure
- Export pages as default exports
- Use React.lazy for page components loaded via router
- Be precise — do not remove or break existing functionality unless instructed

## Important
Always confirm what you changed at the end of your response. If you wrote multiple files, list them. If something needs admin attention (like restarting the server), mention it — but usually HMR handles it automatically.`;

// ── Chat endpoint ─────────────────────────────────────────────────────────────

interface OAIMessage {
  role: string;
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export interface ToolActivity {
  name: string;
  path?: string;
  resultSummary: string;
  wrote?: boolean;
}

router.post(
  "/iroc/agent/chat",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const {
      history = [],
      message,
    } = req.body as {
      history?: { role: string; content: string }[];
      message: string;
    };

    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

    if (!baseUrl || !apiKey) {
      res.status(503).json({ error: "AI service not configured" });
      return;
    }

    // Build the OpenAI messages array
    const messages: OAIMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      // Replay conversation history as plain user/assistant turns
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const toolsUsed: ToolActivity[] = [];
    const MAX_ROUNDS = 10;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      let resp: Response;
      let data: {
        choices: {
          finish_reason: string;
          message: OAIMessage;
        }[];
      };

      try {
        const raw = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-5",
            max_completion_tokens: 16_000,
            messages,
            tools: TOOLS,
            tool_choice: "auto",
          }),
        });
        if (!raw.ok) {
          let detail = `${raw.status} ${raw.statusText}`;
          try {
            const errBody = await raw.json() as { error?: { message?: string } | string };
            const msg =
              typeof errBody.error === "string"
                ? errBody.error
                : errBody.error?.message;
            if (msg) detail = msg;
          } catch { /* keep status text */ }
          res.status(502).json({ error: `AI service error: ${detail}` });
          return;
        }
        data = await raw.json() as typeof data;
      } catch (err) {
        res.status(502).json({ error: `AI request failed: ${String(err)}` });
        return;
      }

      const choice = data.choices?.[0];
      if (!choice) {
        res.status(502).json({ error: "Empty response from AI service" });
        return;
      }

      // ── Final text answer ──────────────────────────────────────────────────
      if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
        res.json({
          reply: choice.message.content ?? "(no response)",
          toolsUsed,
        });
        return;
      }

      // ── Execute tool calls ─────────────────────────────────────────────────
      // Add the assistant's tool-call message to history
      messages.push(choice.message);

      for (const call of choice.message.tool_calls) {
        let args: Record<string, string>;
        try {
          args = JSON.parse(call.function.arguments) as Record<string, string>;
        } catch {
          args = {};
        }

        let result: string;
        const toolName = call.function.name;
        const filePath = args.path ?? "";

        switch (toolName) {
          case "list_files":
            result = await toolListFiles(filePath);
            toolsUsed.push({ name: "list_files", path: filePath, resultSummary: `Listed ${filePath}` });
            break;

          case "read_file":
            result = await toolReadFile(filePath);
            toolsUsed.push({ name: "read_file", path: filePath, resultSummary: `Read ${filePath}` });
            break;

          case "write_file": {
            const content = args.content ?? "";
            result = await toolWriteFile(filePath, content);
            toolsUsed.push({
              name: "write_file",
              path: filePath,
              resultSummary: result.startsWith("✓")
                ? `Wrote ${filePath} (${content.split("\n").length} lines)`
                : result,
              wrote: result.startsWith("✓"),
            });
            break;
          }

          default:
            result = `Unknown tool: ${toolName}`;
            toolsUsed.push({ name: toolName, resultSummary: result });
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    // Reached max rounds without a final answer
    res.json({
      reply: "The agent reached its maximum reasoning steps. Please try a simpler request or split it into smaller tasks.",
      toolsUsed,
    });
  },
);

export default router;
