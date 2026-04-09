import { http, HttpResponse } from "msw";
import { buildDebriefResult } from "./index";

// Default MSW handlers for tests that still test API calls directly
// (dispatchAction, postChatMessage, replyEmail, setSpeed via the game loop
// calling those methods, which in the engine-direct architecture route through
// the game loop — but tests that verify the HTTP path can still use these).
export const defaultHandlers = [
  http.post(
    "/api/sessions/:id/actions",
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.post(
    "/api/sessions/:id/chat",
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.post(
    "/api/sessions/:id/email/reply",
    () => new HttpResponse(null, { status: 204 }),
  ),
  http.post(
    "/api/sessions/:id/speed",
    () => new HttpResponse(null, { status: 204 }),
  ),
  // Kept for any residual test that fetches debrief directly
  http.get("/api/sessions/:id/debrief", () =>
    HttpResponse.json(buildDebriefResult()),
  ),
];
