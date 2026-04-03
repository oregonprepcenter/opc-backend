module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  var body = req.body || {};
  var accessToken = body.access_token;
  var realmId = body.realm_id;
  var invoiceId = body.invoice_id;

  if (!accessToken || !realmId || !invoiceId) {
    return res.status(400).json({ error: true, detail: "Missing access_token, realm_id, or invoice_id" });
  }

  var baseUrl = "https://quickbooks.api.intuit.com/v3/company/" + realmId;
  var headers = {
    "Authorization": "Bearer " + accessToken,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };

  try {
    // Get current invoice to get SyncToken
    var getRes = await fetch(baseUrl + "/invoice/" + invoiceId, { headers: headers });
    var getData = await getRes.json();
    if (!getData.Invoice) {
      return res.status(400).json({ error: true, detail: "Invoice not found in QB" });
    }

    // Void it
    var voidRes = await fetch(baseUrl + "/invoice?operation=void", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ Id: invoiceId, SyncToken: getData.Invoice.SyncToken, sparse: true })
    });
    var voidData = await voidRes.json();

    if (voidData.Invoice) {
      return res.status(200).json({ success: true, invoice_id: invoiceId });
    } else {
      return res.status(400).json({ error: true, detail: JSON.stringify(voidData) });
    }
  } catch (e) {
    return res.status(500).json({ error: true, detail: e.message || "Unknown error" });
  }
};
