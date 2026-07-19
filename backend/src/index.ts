import "./env"; // must be first: loads .env before anything reads process.env
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionRoute } from "./routes/session";
import { authRoute } from "./routes/auth";
import { sessionsRoute } from "./routes/sessions";
import { pairingsRoute } from "./routes/pairings";
import { cameraRoute } from "./routes/camera";

const app = new Hono();

// The frontend calls this server-side, and the coach station calls it directly.
// CORS is permissive so a browser client could also reach it if needed.
app.use("*", cors());

app.get("/", (c) => c.json({ service: "racketcoach-backend", ok: true }));
app.get("/health", (c) => c.text("ok"));

app.route("/api/session", sessionRoute); // board write (singular)
app.route("/api/auth", authRoute);
app.route("/api/sessions", sessionsRoute); // list/detail (plural)
app.route("/api/pairings", pairingsRoute);
app.route("/api/camera", cameraRoute); // browser (Live Motion) camera metrics

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, hostname: "0.0.0.0", port });
console.log(`[backend] RacketCoach API listening on http://0.0.0.0:${port}`);
