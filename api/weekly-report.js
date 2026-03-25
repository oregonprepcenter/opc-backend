// /api/weekly-report.js — Vercel Serverless Function (Cron)
// Sends weekly summary email to each client every Monday at 8am Pacific
//
// SETUP:
// 1. Add to vercel.json crons: { "path": "/api/weekly-report", "schedule": "0 15 * * 1" }
//    (15:00 UTC Monday = 8:00 AM Pacific Monday)
// 2. Add env vars: SENDGRID_API_KEY, OPC_FROM_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_KEY

var sgMail = require("@sendgrid/mail");

module.exports = async function handler(req, res) {
  var apiKey = process.env.SENDGRID_API_KEY;
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  sgMail.setApiKey(apiKey);

  try {
    // Read data from Supabase
    var dataRes = await fetch(supabaseUrl + "/storage/v1/object/public/opc-wms-shared", {
      headers: { "Authorization": "Bearer " + supabaseKey, "apikey": supabaseKey }
    });
    var data = await dataRes.json();

    var inventory = data.inventory || [];
    var batches = data.batches || [];
    var bills = data.bills || [];
    var clients = data.clients || [];
    var shipments = data.shipments || [];

    var now = new Date();
    var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    var sent = 0;

    for (var ci = 0; ci < clients.length; ci++) {
      var client = clients[ci];
      if (!client.email) continue;

      var clName = client.n;
      var clInv = inventory.filter(function(i) { return i.cl === clName; });
      var clBatches = batches.filter(function(b) { return b.cl === clName; });
      var clBills = bills.filter(function(b) { return b.cl === clName; });
      var clShipments = shipments.filter(function(s) {
        return (s.items || []).some(function(it) { return it.cl === clName; });
      });

      // This week's activity
      var receivedThisWeek = clInv.filter(function(i) {
        return i.dr && new Date(i.dr) >= weekAgo;
      }).length;
      var shippedThisWeek = clShipments.filter(function(s) {
        return s.date && new Date(s.date) >= weekAgo;
      }).length;
      var unitsReceived = clInv.filter(function(i) {
        return i.dr && new Date(i.dr) >= weekAgo;
      }).reduce(function(a, i) { return a + (i.qr || 0); }, 0);

      var currentInventory = clInv.filter(function(i) { return !i.shipped && !i.nrFlag; }).length;
      var pendingInvoices = clBills.filter(function(b) {
        return b.st !== "Paid" && b.st !== "Void";
      });
      var pendingTotal = pendingInvoices.reduce(function(a, b) { return a + b.am; }, 0);

      var html = '<!DOCTYPE html><html><head></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
        '<div style="background:#1B4332;color:#fff;padding:20px;border-radius:10px 10px 0 0;text-align:center">' +
        '<h2 style="margin:0;font-size:18px">Weekly Summary</h2>' +
        '<p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,.6)">' + now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + '</p>' +
        '</div>' +
        '<div style="background:#fff;padding:24px;border:1px solid #ddd;border-top:none;border-radius:0 0 10px 10px">' +
        '<p style="font-size:13px">Hi <strong>' + (client.contact || clName) + '</strong>,</p>' +
        '<p style="font-size:13px;color:#444">Here\'s your weekly fulfillment summary from Oregon Prep Center:</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:16px 0">' +
        '<div style="flex:1;min-width:100px;background:#f5f5f0;padding:14px;border-radius:8px;text-align:center">' +
        '<div style="font-size:24px;font-weight:800;color:#1B4332">' + receivedThisWeek + '</div>' +
        '<div style="font-size:10px;color:#666">Items Received</div></div>' +
        '<div style="flex:1;min-width:100px;background:#f5f5f0;padding:14px;border-radius:8px;text-align:center">' +
        '<div style="font-size:24px;font-weight:800;color:#1B4332">' + unitsReceived + '</div>' +
        '<div style="font-size:10px;color:#666">Units Received</div></div>' +
        '<div style="flex:1;min-width:100px;background:#f5f5f0;padding:14px;border-radius:8px;text-align:center">' +
        '<div style="font-size:24px;font-weight:800;color:#553C9A">' + shippedThisWeek + '</div>' +
        '<div style="font-size:10px;color:#666">Shipments</div></div>' +
        '</div>' +
        '<div style="margin:16px 0;padding:14px;background:#f5f5f0;border-radius:8px">' +
        '<div style="font-size:12px;font-weight:700;margin-bottom:8px">Current Status</div>' +
        '<div style="font-size:12px;color:#444;line-height:1.8">' +
        'Inventory on hand: <strong>' + currentInventory + ' items</strong><br>' +
        'Pending invoices: <strong>' + pendingInvoices.length + ' ($' + pendingTotal.toFixed(2) + ')</strong>' +
        '</div></div>' +
        '<div style="text-align:center;margin-top:20px">' +
        '<a href="https://oregonprepcenter.com/portal" style="display:inline-block;padding:12px 28px;background:#1B4332;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View Full Dashboard</a>' +
        '</div></div>' +
        '<div style="text-align:center;margin-top:12px;font-size:10px;color:#999">Oregon Prep Center LLC | oregonprepcenter.com</div>' +
        '</body></html>';

      await sgMail.send({
        to: client.email,
        from: { email: process.env.OPC_FROM_EMAIL || "contact@oregonprepcenter.com", name: "Oregon Prep Center" },
        subject: "Weekly Summary: " + receivedThisWeek + " received, " + shippedThisWeek + " shipped",
        html: html
      });
      sent++;
    }

    return res.status(200).json({ success: true, sent: sent, clients: clients.length });
  } catch (error) {
    console.error("[Weekly Report] Error:", error.message || error);
    return res.status(500).json({ error: error.message || "Report failed" });
  }
};
