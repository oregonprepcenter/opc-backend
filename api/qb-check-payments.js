module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  var body = req.body || {};
  var accessToken = body.access_token;
  var realmId = body.realm_id;
  var invoiceIds = body.invoice_ids || [];

  if (!accessToken || !realmId) {
    return res.status(400).json({ error: true, detail: "Missing access_token or realm_id" });
  }

  var baseUrl = "https://quickbooks.api.intuit.com/v3/company/" + realmId;
  var headers = {
    "Authorization": "Bearer " + accessToken,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };

  try {
    var results = [];
    for (var i = 0; i < invoiceIds.length; i++) {
      var invRes = await fetch(baseUrl + "/invoice/" + invoiceIds[i], { headers: headers });
      var invData = await invRes.json();
      if (invData.Invoice) {
        var balance = invData.Invoice.Balance;
        var total = invData.Invoice.TotalAmt;
        var dueDate = invData.Invoice.DueDate;
        var status = balance === 0 ? "Paid" : (dueDate && new Date(dueDate) < new Date() ? "Overdue" : "Open");
        results.push({ qb_invoice_id: invoiceIds[i], status: status, balance: balance, total: total });
      }
    }
    return res.status(200).json({ success: true, invoices: results });
  } catch (e) {
    return res.status(500).json({ error: true, detail: e.message || "Unknown error" });
  }
};
