Original prompt: 想要做一个帮助小学生学英语的网站。希望兼顾趣味性和有效性。希望包括听说读写比较全面的练习。需要可以根据提供的教材范围来更新教学内容，比如附图就是目前第一阶段的主要教学内容，后续需要可以更改。我想听听你的建议。

## Progress
- Initialized a Vite + React + TypeScript app in an empty workspace.
- Confirmed the project is a greenfield MVP targeting mobile-first family learning.
- Decided to implement a data-driven single-page app with four zones: map, lesson flow, parent report, and content admin.
- Replaced the pure-frontend demo with an Express + SQLite backend for admin auth, subjects, images, drafts, provider settings, and usage logs.
- Seeded the formal subject `海宝体验课` with framework units and moved learning progress persistence to a dedicated frontend helper.
- Added real provider adapters for OpenAI Responses, Qwen native/compatible modes, and Alibaba OCR SDK, plus usage/cost estimation logging.
- Rebuilt the admin UI around bootstrap/login, subject management, image upload, draft publishing, provider settings, and usage logs.
- Verified the browser path with the Playwright client against the new app shell and confirmed no runtime errors in the fresh run.

## TODO
- Replace demo speaking evaluation with a real speech scoring service when credentials and product rules are ready.
- Expand the draft editor from unit-level editing to activity-level editing once real教材图片 is uploaded.

## 2026-03-13 Updates
- Moved success/error lesson audio cues into `public/audio/` and wired them into immediate choice feedback.
- Added local speaking history persistence keyed by `unitId + activityId`, including replay, delete, and score retention per recording.
- Reworked speaking submit UX to show `提交中...`, explicit inline failure messages, and visible score details after the response returns.
- Changed choice activities to auto-submit on click, removed their manual submit button, and renamed the remaining manual submit CTA to `提交答案`.
- Added reward animation and result auto-scroll so correct answers surface visible feedback immediately.
- Added eye-toggle secret inputs for provider credentials in the settings panel.
- Verified `npm test`, `npm run build`, and `npm run lint` pass after the interaction changes.
- Attempted Playwright validation with the bundled web-game client, but it failed on the local self-signed HTTPS certificate (`ERR_CERT_AUTHORITY_INVALID`), so no screenshot artifact was captured from that client run.

## 2026-03-13 Diagnostics
- Updated HTTPS certificate generation to prefer `mkcert` and include current LAN IPs/hostname in SAN, so local HTTPS now covers `192.168.112.149` as well as `localhost`.
- Verified the generated certificate metadata is now `method: mkcert` and the SAN list includes the current LAN IP.
- Adjusted star rewards so low-score / wrong answers no longer earn stars; only passing answers can trigger star gain and the reward bubble.
- Improved OpenAI client error mapping with explicit timeout/network messages.
- Confirmed the current machine still cannot reach OpenAI from the terminal:
  - `curl -I --max-time 10 https://api.openai.com` timed out
  - direct `fetch(.../models)` returned `fetch failed`
  - direct transcription test returned `Request timed out.`
- This means the current speaking timeout is not caused by the saved API key shape alone; the host machine's outbound connectivity to OpenAI is failing.

## 2026-03-13 More Updates
- Added daily progress summaries to learning progress so the homepage can show today's study duration, stars, and badge gains without a new backend table.
- Reworked recommendation logic to continue from the next meaningful activity/unit instead of always restarting the first unit, and treat “today is enough” as “completed at least one full-star unit today”.
- Added unit-level star totals, full-star medal markers, and total medal count displays on the student homepage.
- Added three-star lock behavior across all activity kinds; three-star activities now open in read-only mode, and speaking hides recording/submission once maxed.
- Reworked reward effects so success stars render from the same persistent star anchor used in result/history cards instead of a detached bottom-right toast.
- Strengthened username inputs with english-first mobile hints (`inputMode=url`, `enterKeyHint`, username pattern) while keeping the known Web limitation that browsers/input methods may still override keyboard choice.
- Changed result scrolling to target the top of the result card so fill-in feedback is visible immediately on mobile.
- Verified with `npm test`, `npm run lint`, and `npm run build`.
- Tried the bundled Playwright client against `https://localhost:3134`, but it did not produce screenshot artifacts in this environment; local HTTPS/browser trust remains the main blocker for screenshot-based verification.
