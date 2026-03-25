// /api/qb-sync-payments.js — Vercel Serverless Function (Cron)
// Checks QuickBooks for paid invoices and syncs status back to portal
//
// SETUP:
// 1. Add to vercel.json crons: { "path": "/api/qb-sync-payments", "schedule": "0 * * * *" }
//    (Runs every hour)
// 2. Env vars: QBO_CLIENT_ID, QBO_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

module.exports = async function handler(req, res) {
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  var qbClientId = process.env.QBO_CLIENT_ID;
  var qbClientSecret = process.env.QBO_CLIENT_SECRET;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing SUPABASE env vars" });
  }

  try {
    // 1. Read portal data from Supabase
    var dataRes = await fetch(supabaseUrl + "/storage/v1/object/public/opc-wms-shared", {
      headers: { "Authorization": "Bearer " + supabaseKey, "apikey": supabaseKey }
    });
    var data = await dataRes.json();
    if (!data) return res.status(500).json({ error: "Could not read portal data" });

    var bills = data.bills || [];
    var integrations = data.integrations || [];
    var qbTokens = data.qbTokens || {};

    if (!qbTokens.accessToken || !qbTokens.realmId) {
      return res.status(200).json({ skipped: true, reason: "QuickBooks not connected" });
    }

    // 2. Query QB for recent payments
    var realmId = qbTokens.realmId;
    var accessToken = qbTokens.accessToken;

    // Get invoices that are paid in QB but pending/synced in portal
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
        // Query QB for this specific invoice
        var qbRes = await fetch(
          "https://quickbooks.api.intuit.com/v3/company/" + realmId + "/invoice/" + bill.qbInvoiceId + "?minorversion=65",
          {
            headers: {
              "Authorization": "Bearer " + accessToken,
              "Accept": "application/json"
            }
          }
        );

        if (qbRes.ok) {
          var qbData = await qbRes.json();
          var qbInvoice = qbData.Invoice;

          if (qbInvoice && qbInvoice.Balance === 0 && qbInvoice.TotalAmt > 0) {
            // Invoice is fully paid in QB
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
      await fetch(supabaseUrl + "/storage/v1/object/public/opc-wms-shared", {
        method: "PUT",
        headers: {
          "Authorization": "Bearer " + supabaseKey,
          "apikey": supabaseKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
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
