module.exports = async function handler(req, res) {
  var clientId = process.env.QBO_CLIENT_ID;
  var clientSecret = process.env.QBO_CLIENT_SECRET;
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET env vars" });
  }

  var portalUrl = req.query.portal_url || "https://oregonprepcenter.com/portal";
  var redirectUri = "https://opc-backend.vercel.app/api/qb-callback";

  // Save the portal URL for the callback to redirect back to
  if (supabaseUrl && supabaseKey) {
    try {
      await fetch(supabaseUrl + "/rest/v1/portal_data?key=eq.opc-qb-state", {
        method: "DELETE",
        headers: { "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey }
      });
      await fetch(supabaseUrl + "/rest/v1/portal_data", {
        method: "POST",
        headers: { "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ key: "opc-qb-state", value: JSON.stringify({ portalUrl: portalUrl, ts: Date.now() }) })
      });
    } catch (e) {}
  }

  var scope = "com.intuit.quickbooks.accounting";
  var authUrl = "https://appcenter.intuit.com/connect/oauth2" +
    "?client_id=" + encodeURIComponent(clientId) +
    "&response_type=code" +
    "&scope=" + encodeURIComponent(scope) +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&state=opc";

  res.writeHead(302, { Location: authUrl });
  res.end();
};
