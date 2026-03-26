// /api/qb-sync-payments.js — Vercel Serverless Function (Cron)
// Checks QuickBooks for paid invoices and syncs status back to portal
// Cron: every hour — vercel.json: { "path": "/api/qb-sync-payments", "schedule": "0 * * * *" }
 
module.exports = async function handler(req, res) {
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;
 
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing SUPABASE env vars" });
  }
 
  var headers = {
    "apikey": supabaseKey,
    "Authorization": "Bearer " + supabaseKey,
    "Content-Type": "application/json"
  };
 
  try {
    // 1. Read portal data from Supabase portal_data table
    var dataRes = await fetch(supabaseUrl + "/rest/v1/portal_data?key=eq.opc-wms-shared&select=key,value", {
      headers: headers
    });
    var rows = await dataRes.json();
 
    if (!rows || rows.length === 0) {
      return res.status(200).json({ skipped: true, reason: "No portal data found in Supabase" });
    }
 
    var data;
    try {
      data = JSON.parse(rows[0].value);
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse portal data" });
    }
 
    var bills = data.bills || [];
    var qbAccessToken = data.qbAccessToken || "";
    var qbRealmId = data.qbRealmId || "";
 
    if (!qbAccessToken || !qbRealmId) {
      return res.status(200).json({ skipped: true, reason: "QuickBooks not connected" });
    }
 
    // 2. Find invoices pushed to QB but not yet paid in portal
    var pendingInPortal = bills.filter(function(b) {
      return (b.st === "Synced" || b.st === "Pending") && b.qbInvoiceId;
    });
 
    if (pendingInPortal.length === 0) {
      return res.status(200).json({ checked: 0, updated: 0, message: "No synced invoices to check" });
    }
 
    var updated = 0;
 
    for (var i = 0; i < pendingInPortal.length; i++) {
      var bill = pendingInPortal[i];
      try {
        var qbRes = await fetch(
          "https://quickbooks.api.intuit.com/v3/company/" + qbRealmId + "/invoice/" + bill.qbInvoiceId + "?minorversion=65",
          {
            headers: {
              "Authorization": "Bearer " + qbAccessToken,
              "Accept": "application/json"
            }
          }
        );
 
        if (qbRes.ok) {
          var qbData = await qbRes.json();
          var qbInvoice = qbData.Invoice;
 
          if (qbInvoice && qbInvoice.Balance === 0 && qbInvoice.TotalAmt > 0) {
            bill.st = "Paid";
            bill.paidDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
            bill.paidVia = "QuickBooks Auto-Sync";
            updated++;
          }
        }
      } catch (e) {
        console.error("[QB Sync] Error checking invoice " + bill.inv + ":", e.message);
      }
    }
 
    // 3. Save updated bills back to Supabase if any changed
    if (updated > 0) {
      data.bills = bills;
      data._rev = Date.now();
      await fetch(supabaseUrl + "/rest/v1/portal_data?key=eq.opc-wms-shared", {
        method: "PATCH",
        headers: headers,
        body: JSON.stringify({ value: JSON.stringify(data) })
      });
    }
 
    return res.status(200).json({
      checked: pendingInPortal.length,
      updated: updated,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[QB Sync] Error:", error.message || error);
    return res.status(500).json({ error: error.message || "Sync failed" });
  }
};
