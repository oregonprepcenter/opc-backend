module.exports = async function handler(req, res) {
  var clientId = process.env.QBO_CLIENT_ID;
  var clientSecret = process.env.QBO_CLIENT_SECRET;
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  var code = req.query.code;
  var realmId = req.query.realmId;
  var error = req.query.error;

  if (error) {
    return res.writeHead(302, { Location: "https://oregonprepcenter.com/portal?qb_error=" + encodeURIComponent(error) }).end();
  }

  if (!code || !realmId) {
    return res.status(400).json({ error: "Missing code or realmId from Intuit" });
  }

  var redirectUri = "https://opc-backend.vercel.app/api/qb-callback";

  try {
    // Exchange authorization code for tokens
    var tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: "grant_type=authorization_code&code=" + encodeURIComponent(code) + "&redirect_uri=" + encodeURIComponent(redirectUri)
    });

    var tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.writeHead(302, { Location: "https://oregonprepcenter.com/portal?qb_error=token_exchange_failed" }).end();
    }

    var accessToken = tokenData.access_token;
    var refreshToken = tokenData.refresh_token || "";

    // Get the portal URL from saved state
    var portalUrl = "https://oregonprepcenter.com/portal";
    if (supabaseUrl && supabaseKey) {
      try {
        var stateRes = await fetch(supabaseUrl + "/rest/v1/portal_data?key=eq.opc-qb-state&select=value", {
          headers: { "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey }
        });
        var stateRows = await stateRes.json();
        if (stateRows && stateRows.length > 0) {
          var state = JSON.parse(stateRows[0].value);
          if (state.portalUrl) portalUrl = state.portalUrl;
        }
      } catch (e) {}
    }

    // Redirect back to portal with tokens
    var returnUrl = portalUrl +
      "?qb_access_token=" + encodeURIComponent(accessToken) +
      "&qb_refresh_token=" + encodeURIComponent(refreshToken) +
      "&qb_realm_id=" + encodeURIComponent(realmId);

    res.writeHead(302, { Location: returnUrl });
    res.end();
  } catch (error) {
    res.writeHead(302, { Location: "https://oregonprepcenter.com/portal?qb_error=" + encodeURIComponent(error.message || "unknown") }).end();
  }
};
