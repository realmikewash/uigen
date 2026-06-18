# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Style

Only comment complex code — non-obvious algorithms, subtle invariants, or external workarounds. Skip comments on anything a readable name already explains.

## Commands

```bash
npm run setup        # Install deps + prisma generate + migrate (first-time setup)
npm run dev          # Start dev server at http://localhost:3000 (Turbopack)
npm run build        # Production build
npm run test         # Run all tests (vitest + jsdom)
npm run test -- src/components/chat/__tests__/ChatInterface.test.tsx  # Run a single test file
npm run db:reset     # Reset database (destructive)
npx prisma migrate dev   # Apply new schema migrations
npx prisma generate      # Regenerate Prisma client after schema changes
```

## Architecture

UIGen is a Next.js 15 App Router application where users chat with Claude to generate React components that render live in-browser via a virtual file system.

### Core data flow

1. User types a prompt in `ChatInterface` → sent to `POST /api/chat` along with the serialized virtual FS state
2. The API route streams a response using Vercel AI SDK's `streamText`, giving Claude two tools:
   - `str_replace_editor` (Anthropic's built-in text editor tool `anthropic.text_editor_20250124`) — create/view/edit files
   - `file_manager` — rename/delete files
3. Tool calls stream back to the client; `FileSystemContext.handleToolCall` applies each mutation to the in-memory `VirtualFileSystem` immediately as tokens arrive
4. `PreviewFrame` re-renders whenever `refreshTrigger` increments: it transpiles all VFS files with Babel standalone, builds a native browser import map using blob URLs, and writes the result as `iframe.srcdoc`

### Virtual file system (`src/lib/file-system.ts`)

`VirtualFileSystem` is an in-memory tree (root `FileNode` with `Map<string, FileNode>` children). It is **never written to disk**. Serialization produces a flat `Record<string, FileNode>` sent with every API request so the server can reconstruct it each turn.

All generated component files must use the `@/` import alias, which the import-map builder resolves to root-level VFS paths.

### Preview pipeline (`src/lib/transform/jsx-transformer.ts`)

- `createImportMap`: iterates VFS files, transpiles each `.jsx/.tsx` with Babel standalone, creates blob URLs, and builds a browser import map. Third-party packages are resolved via `https://esm.sh/`. Missing local imports get placeholder stub modules so the preview doesn't crash.
- `createPreviewHTML`: produces the full `srcdoc` HTML including Tailwind CDN, inline styles from `.css` files, the import map, and a module script that mounts `App.jsx` inside an `ErrorBoundary`.
- Entry point resolution order: `/App.jsx` → `/App.tsx` → `/index.jsx` → `/index.tsx` → `/src/App.jsx` → first `.jsx/.tsx` found.

### AI provider (`src/lib/provider.ts`)

`getLanguageModel()` returns `anthropic("claude-3-7-sonnet-latest")` when `ANTHROPIC_API_KEY` is set, otherwise falls back to `MockLanguageModel`. The mock streams canned component code through the same tool-call protocol so the app is fully functional without an API key.

### Auth (`src/lib/auth.ts`)

JWT-based session stored in an `httpOnly` cookie (`auth-token`, 7-day expiry). `jose` handles signing/verification. Secret comes from `JWT_SECRET` env var (falls back to a hardcoded dev string). Middleware at `src/middleware.ts` guards `/api/projects` and `/api/filesystem` but **`/api/chat` is unprotected** — anyone can stream generations.

### Persistence (Prisma + SQLite)

The database schema is defined in `prisma/schema.prisma`. Reference it anytime you need to understand the structure of data stored in the database.

Schema: `User` (email + bcrypt password) → `Project` (messages JSON + VFS data JSON). Only authenticated users get their work saved: after each streaming response the `onFinish` callback in the chat route serializes `allMessages` and `fileSystem.serialize()` into the project row.

Anonymous work is stored in `sessionStorage` via `src/lib/anon-work-tracker.ts` so the UI can prompt sign-up before data is lost.

### Routing

- `/` — anonymous users get `MainContent` directly; authenticated users are redirected to their most recent project (or a newly created one)
- `/[projectId]` — loads project messages + VFS from DB, provides them as `initialMessages`/`initialData` to `ChatProvider`/`FileSystemProvider`

### Context providers

Two client-side contexts wrap the workspace:
- `FileSystemContext` — owns the `VirtualFileSystem` instance, exposes file CRUD, and handles incoming tool calls
- `ChatContext` — wraps Vercel AI SDK's `useChat`, passes the serialized VFS in each request body, and delegates tool calls to `FileSystemContext.handleToolCall`

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | No | Real Claude API; mock used if absent |
| `JWT_SECRET` | No | Session signing; defaults to dev string |
| `DATABASE_URL` | No | Defaults to `file:./prisma/dev.db` |
