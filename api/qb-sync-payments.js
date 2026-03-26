module.exports = async function handler(req, res) {
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing SUPABASE env vars", hasUrl: !!supabaseUrl, hasKey: !!supabaseKey });
  }

  var result = { step: "start", supabaseUrl: supabaseUrl.substring(0, 30) + "..." };

  try {
    var fetchUrl = supabaseUrl + "/rest/v1/portal_data?key=eq.opc-wms-shared&select=key,value";
    result.step = "fetching";
    result.fetchUrl = fetchUrl;
    
    var dataRes = await fetch(fetchUrl, {
      headers: {
        "apikey": supabaseKey,
        "Authorization": "Bearer " + supabaseKey,
        "Content-Type": "application/json"
      }
    });

    result.step = "fetched";
    result.httpStatus = dataRes.status;

    if (!dataRes.ok) {
      result.error = await dataRes.text();
      return res.status(200).json(result);
    }

    var rows = await dataRes.json();
    result.step = "parsed";
    result.rowCount = rows ? rows.length : 0;

    if (!rows || rows.length === 0) {
      result.error = "No rows found";
      return res.status(200).json(result);
    }

    var data = JSON.parse(rows[0].value);
    result.step = "dataParsed";
    result.keys = Object.keys(data).filter(function(k) { return k.indexOf("qb") === 0; });
    result.qbConnected = data.qbConnected || false;
    result.hasAccessToken = !!(data.qbAccessToken);
    result.tokenLength = (data.qbAccessToken || "").length;
    result.realmId = data.qbRealmId || "NOT SET";
    result.billCount = (data.bills || []).length;

    var qbAccessToken = data.qbAccessToken || "";
    var qbRealmId = data.qbRealmId || "";

    if (!qbAccessToken || !qbRealmId) {
      result.status = "QB not connected";
      return res.status(200).json(result);
    }

    var bills = data.bills || [];
    var pendingInPortal = bills.filter(function(b) {
      return (b.st === "Synced" || b.st === "Pending") && b.qbInvoiceId;
    });

    result.status = "QB connected";
    result.pendingToCheck = pendingInPortal.length;

    if (pendingInPortal.length === 0) {
      result.message = "No invoices with qbInvoiceId to check";
      return res.status(200).json(result);
    }

    var updated = 0;
    for (var i = 0; i < pendingInPortal.length; i++) {
      var bill = pendingInPortal[i];
      try {
        var qbRes = await fetch(
          "https://quickbooks.api.intuit.com/v3/company/" + qbRealmId + "/invoice/" + bill.qbInvoiceId + "?minorversion=65",
          { headers: { "Authorization": "Bearer " + qbAccessToken, "Accept": "application/json" } }
        );
        if (qbRes.ok) {
          var qbData = await qbRes.json();
          if (qbData.Invoice && qbData.Invoice.Balance === 0 && qbData.Invoice.TotalAmt > 0) {
            bill.st = "Paid";
            bill.paidDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
            bill.paidVia = "QuickBooks Auto-Sync";
            updated++;
          }
        }
      } catch (e) {}
    }

    if (updated > 0) {
      data.bills = bills;
      data._rev = Date.now();
      await fetch(supabaseUrl + "/rest/v1/portal_data?key=eq.opc-wms-shared", {
        method: "PATCH",
        headers: { "apikey": supabaseKey, "Authorization": "Bearer " + supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(data) })
      });
    }

    result.checked = pendingInPortal.length;
    result.updated = updated;
    return res.status(200).json(result);
  } catch (error) {
    result.error = error.message;
    return res.status(200).json(result);
  }
};
