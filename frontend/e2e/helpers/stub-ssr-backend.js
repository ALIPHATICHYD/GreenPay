/**
 * e2e/helpers/stub-ssr-backend.js
 *
 * Minimal HTTP server standing in for the GreenPay backend during e2e runs.
 *
 * Playwright's `page.route()` only intercepts requests the *browser* makes —
 * it cannot see requests made by the Next.js server process itself. Most
 * pages fetch client-side, so `page.route()` mocks cover them fine, but
 * `pages/donate/[id].tsx` fetches its project via `getServerSideProps`,
 * which runs entirely server-side. Without a real HTTP server behind
 * NEXT_PUBLIC_API_URL, that fetch fails outright and the page always
 * renders its "project not found" state.
 *
 * This server exists only to answer that one request, with the same
 * `{ success, data }` envelope the real backend uses (see
 * backend/src/routes/projects.js `GET /:id`). It is wired up as a second
 * Playwright `webServer` entry in playwright.config.ts and started/stopped
 * around the whole e2e run — it never handles anything else, since every
 * other page's data fetching happens client-side and is mocked directly in
 * each spec file via `page.route()`.
 */
const http = require("http");

const PORT = process.env.STUB_BACKEND_PORT || 4000;

const KNOWN_PROJECT_ID = "8d9ac19b-52eb-42f7-80d9-19a88ba59e43";
const MOCK_WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const KNOWN_PROJECT = {
  id: KNOWN_PROJECT_ID,
  name: "Amazon Reforestation Initiative",
  description: "Planting 1 million native trees in the Brazilian Amazon.",
  category: "Reforestation",
  walletAddress: MOCK_WALLET,
  goalXLM: "50000",
  raisedXLM: "18420",
};

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  const match = req.url.match(/^\/api\/v1\/projects\/([^/?]+)/);
  if (req.method === "GET" && match) {
    const id = decodeURIComponent(match[1]);
    if (id === KNOWN_PROJECT_ID) {
      return send(res, 200, { success: true, data: KNOWN_PROJECT });
    }
    return send(res, 404, { success: false, error: "Project not found" });
  }
  return send(res, 404, { success: false, error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[stub-ssr-backend] listening on :${PORT}`);
});
