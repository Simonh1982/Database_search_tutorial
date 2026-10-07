# Notes for AI coding agents (GitHub Copilot, Claude Code)

- Proof-of-concept tutorial on biomedical database searching. Read `README.md` for the architecture.
- `web/` is plain ES modules with no build step: it must keep working when served as static files
  from GitHub Pages. Don't add a bundler or framework without discussing it first.
- `web/shared/` is imported by both the browser and the Node server. Keep it free of Node-only and
  DOM-only APIs (only `fetch`, `URL` and similar are allowed).
- Teaching content lives in `skills/*/SKILL.md`. Change pedagogy there, not in code.
- The AI must return the JSON shape described in `server/ai/prompt.js`. `server/ai/parse.js`
  normalises it. Update both, plus `web/app.js` (`feedbackPanel`), if the shape changes.
- Write all user-facing text in UK English, plainly, for students.
- Accessibility matters: use labelled form controls, keyboard support and `aria-live` for feedback,
  and never convey meaning by colour alone.
- Run `npm test` before committing.
