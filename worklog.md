---
Task ID: 1
Agent: main (Z.ai Code)
Task: Build a Line Rider–style game in the existing Next.js project, then push to GitHub for Vercel hosting.

Work Log:
- Inspected project (Next.js 16 + TS + Tailwind 4 + shadcn/ui). Dev server already running on :3000.
- Created `src/components/line-rider-game.tsx`: a canvas game with a hand-rolled physics loop (gravity, line collision via closest-point-on-segment, friction, boost lines, adaptive substepping, speed clamp to prevent tunneling). Rider drawn as a sled+character rotated by velocity; motion trail; grid background; camera follow + zoom-to-cursor.
- Tools: draw (normal), draw (boost), erase (nearest line), pan, plus draggable green start flag. Right-click quick-erase, middle/space-drag pan, wheel zoom. Keyboard: Space play/pause, R reset, Ctrl+Z undo, 1–4 tools.
- UI: header with live Speed/Lines/Zoom stats, toolbar (Play/Pause, Reset, Undo, Clear, Save/Load/Export/Import, zoom controls, Fit), canvas, sticky footer, tips overlay. Save/Load via localStorage; Export/Import via JSON file.
- Rewrote `src/app/page.tsx` to render the game; updated `layout.tsx` metadata/title.
- Lint: resolved `react-hooks/immutability` (moved pure draw fns to module scope) and `react-hooks/refs` (sync action callbacks to refs via useEffect). Final `bun run lint` is clean (0 errors).
- Fixed runtime issues found via Agent Browser: replaced invalid `Sled` lucide icon with `Snowflake`; fixed non-moving default track (start now sits on a downward slope); fixed a canvas sizing runaway feedback loop by absolutely positioning the canvas (`absolute inset-0`) and only updating the drawing buffer in resize(); lowered canvas min-height to `min-h-0` so footer sticks to bottom on all viewport sizes.
- Verified end-to-end with Agent Browser: page renders with no console/runtime errors; Play → rider slides (speed 782); Pause+Reset → speed 0; draw line (5→6); boost draw (6→7); erase (7→6); zoom-in (173%); fit-view (20%); footer at bottom on both 577px and 900px viewports, no scroll.
- Git/GitHub: added gitignore rules to keep the repo deployable (excluded db/, prisma/, src/lib/db.ts, examples/, mini-services/, .zscripts/, Caddyfile, download/, screenshots, binaries). Untracked `.env` + `download/README.md` (were in the scaffold's initial commit) and amended into a single clean root commit (67 files, no secrets). Created public repo `JeffreyHamilton6399/line-glide` via GitHub API and pushed `main` (token used one-shot, NOT stored in git config).

Stage Summary:
- Game complete and browser-verified at http://localhost:3000 (route `/`).
- GitHub repo: https://github.com/JeffreyHamilton6399/line-glide (public, default branch main).
- Repo is Vercel-ready (clean Next.js app, no DB/Prisma, no socket.io samples).
- SECURITY: the user's GitHub PAT was pasted in plaintext in the chat — MUST be revoked/rotated.
