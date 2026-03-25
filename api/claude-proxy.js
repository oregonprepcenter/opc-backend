// /api/claude-proxy.js — Vercel Serverless Function
// Proxies tracking lookups through Claude API server-side
// so the API key never touches the browser
//
// SETUP: Add ANTHROPIC_API_KEY to Vercel environment variables

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });

  try {
    var tracking = (req.body.tracking || "").trim();
    if (!tracking || tracking.length < 6) {
      return res.status(400).json({ error: "Invalid tracking number" });
    }

    var response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: "Look up the real current tracking status for package tracking number: " + tracking + ". Search the web to find the actual delivery status from the carrier (UPS, FedEx, USPS, Amazon, DHL, etc). After searching, respond ONLY with this exact JSON format and nothing else, no markdown, no explanation: {\"carrier\":\"...\",\"status\":\"Delivered or In Transit or Out for Delivery or Arrived or Exception or Label Created\",\"location\":\"...\",\"eta\":\"...\",\"events\":[{\"date\":\"...\",\"time\":\"...\",\"desc\":\"...\",\"loc\":\"...\"}]} Include all tracking events you find. If you cannot find real tracking data, set carrier to Unknown and status to Not Found."
        }]
      })
    });

    var data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("[Claude Proxy] Error:", error.message || error);
    return res.status(500).json({ error: "Tracking lookup failed: " + (error.message || "Unknown error") });
  }
};
