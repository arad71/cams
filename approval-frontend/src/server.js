/* eslint-disable */
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();

// Allow your React dev origin only (adjust the port/origin as needed)
app.use(cors({ origin: ["http://localhost:3000", "http://localhost:3001"] }));
app.use(express.json({ limit: "25mb" })); // allow images in base64

// DO NOT hardcode secrets in source for prod; use env vars
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Health check
app.get("/healthz", (_, res) => res.json({ ok: true }));

// Proxy endpoint: forwards your body to Anthropic messages API
app.post("/api/claude", async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY" });
    }

    // Forward the request
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        // Use the current API version you target (examples):
        // "anthropic-version": "2023-06-01",
        // Or a newer date-based version depending on the SDK/docs you follow:
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const contentType = upstream.headers.get("content-type") || "application/json";
    res.setHeader("content-type", contentType);
    res.status(upstream.status);

    const text = await upstream.text();
    res.send(text);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`Proxy listening on http://localhost:${port}`));