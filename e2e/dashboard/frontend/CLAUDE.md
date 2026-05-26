# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check (`tsc -b`) then bundle with Vite
- `npm run lint` — run ESLint over the repo
- `npm run preview` — serve the built `dist/`

There is no test runner configured.

## Stack & architecture

- **Vite + React 19 + TypeScript**, entry at `src/main.tsx` → `src/App.tsx`. `main.tsx` wraps the app with `ThemeProvider` → `TooltipProvider` → `AuthBootstrap`. Routes live in `src/router.tsx` (`createBrowserRouter`). `App.tsx` only renders `<RouterProvider />`.
- **Tailwind v4** via `@tailwindcss/vite` (no `tailwind.config.*`). Tokens, `@custom-variant dark`, `@theme inline` mappings, and `:root` / `.dark` CSS variables live in `src/index.css`. Visual style is intentionally flat — `rounded-none` is used on most surfaces (dropdowns, dialogs, popovers).
- **shadcn/ui** configured via `components.json` (style `radix-sera`, base color `neutral`, icon lib `lucide`). Primitives under `src/components/ui/` (`button`, `card`, `dialog`, `dropdown-menu`, `popover`, `tooltip`, `sidebar`, etc.). Use `npx shadcn@latest add <name>` to pull more.
- **Path alias `@/* → ./src/*`** is configured in three files that must stay in sync: `tsconfig.json`, `tsconfig.app.json` (both `baseUrl` + `paths`), and `vite.config.ts` (`resolve.alias`).
- **Theming** is class-based on `<html>`: `ThemeProvider` in `src/components/theme-provider.tsx` toggles the `dark` class and persists to `localStorage` (`scout-ui-theme`). Use `useTheme()` or drop in `<ModeToggle />`.

## Auth & API

- **Backend:** Scout API at `import.meta.env.VITE_SCOUT_API_URL` (defaults to `http://localhost:8080`). All app endpoints are under `/api/v1`. Auth is a JWT obtained via Google OAuth (`GET /api/v1/auth/google` full-page redirect → `/auth/callback?token=…`).
- **Token storage:** `scout_token` cookie (path `/`, `SameSite=Lax`, 7-day expiry, `Secure` on HTTPS). Helpers in `src/lib/auth.ts` (`setAuthCookie` / `getAuthToken` / `clearAuthCookie`; legacy aliases `setToken`/`getToken`/`clearToken` are kept for `api.ts`). Cookie is JS-readable so the axios interceptor can attach `Authorization: Bearer …`.
- **Axios client (`src/lib/api.ts`):** baseURL `${API_BASE_URL}/api/v1`. Request interceptor attaches the bearer header; response interceptor clears the cookie and redirects to `/login` on 401. Do **not** create separate clients — every call should go through the exported `api` (or `streamChat` for SSE).
- **Zustand auth store (`src/lib/auth.ts`, `useAuthStore`):** single source of truth for `user`, `orgs`, `isPlatformAdmin`, `isLoading`, `isAuthenticated`. Pages read org/user via `useAuthStore((s) => s.orgs[0] ?? null)` etc. — do **not** re-fetch `/auth/me` per page. `loadMe()` is kicked off once by `AuthBootstrap` in `main.tsx`; `logout()` POSTs `/auth/logout`, clears the cookie, and hard-navigates to `/login`.
- **Route guards (`src/components/require-auth.tsx`):** `RequireAuth` wraps protected routes (shows a centered spinner while `isLoading`, redirects to `/login?redirect=<path>` if not authed). `RedirectIfAuthed` wraps `/login` so already-signed-in users bounce to `/dashboard`. `/auth/callback` stays unguarded.
- **Typed API helpers (`src/lib/scout-api.ts`):** wrappers for every backend area — `authApi`, `runsApi`, `pipelinesApi`, `overviewApi`, `environmentsApi`, `membersApi`, `archiveApi`, `aiConfigApi`, `gitlabApi`, `notificationsApi`, plus `streamChat` (SSE fetch helper) and the `AI_MODELS` / `AI_CONFIG_DEFAULTS` constants. Add new endpoints here as typed wrappers, not inline in pages.

## App layout

- **`/dashboard` + `/projects` + `/runs/:id`** all render inside `DashboardLayout` (`src/pages/dashboard-layout.tsx`). Layout owns the sidebar, the header (`SidebarTrigger` + breadcrumb + `<NotificationsBell />` + `<ModeToggle />`), and the page-content padding (`p-6`). Per-page chrome lives in the page, not duplicated.
- **Breadcrumb title** is resolved from `pathname` in `dashboard-layout.tsx`'s `resolveTitle` map — extend it when adding a new top-level route.
- **Sidebar (`src/components/app-sidebar.tsx`):** static `data` blob defines `teams`, `navMain`, and `navSettings`. `NavMain` (`src/components/nav-main.tsx`) derives the active highlight from `useLocation()`; collapsible groups (Settings) auto-open when a child is active. `NavUser` reads the current user from the auth store.
- **Notifications:** `NotificationsBell` (`src/components/notifications-bell.tsx`) polls `GET /me/notifications?limit=1` every 30 s for the unread count, fetches `limit=20` when the popover opens, and supports optimistic mark-read + "mark all read".

## UI patterns

- **Polling:** pages that poll (`dashboard`, `runs`, `notifications-bell`) use a `useEffect` with `setInterval`, a `cancelled` flag, and clear the interval on unmount. Skeletons render only on first load (state is `null` vs `[]`) so background refreshes don't flash placeholders.
- **Dialogs:** built on `src/components/ui/dialog.tsx` (radix-ui-backed). Reusable dialog forms live under `src/components/dialogs/` (e.g. `add-pipeline-dialog.tsx`, `add-project-dialog.tsx`). New cross-page modal forms should go there.
- **Toasts:** there is no global toast system yet — settings pages use a local in-page banner that auto-dismisses after 3.5 s. If you need one, propose adding a shared component instead of duplicating the pattern further.
- **Error surfacing:** API errors are read via `(err as { response?: { data?: { error?: string } } }).response?.data?.error` — most pages have a local `readError(err, fallback)` helper.
- **Streaming chat (`ai-assistant.tsx`):** uses `fetch` (not axios) because axios doesn't stream. Bypass `api` and call `streamChat` directly; it still pulls the token via `getToken()` and handles 401 → `/login`.

## TS config notes

`tsconfig.app.json` enables `verbatimModuleSyntax`, `erasableSyntaxOnly`, and `noUnusedLocals` — prefer `import type` for type-only imports, avoid TS-only runtime syntax (enums, parameter properties, namespaces), and clean up unused imports or the build fails.
