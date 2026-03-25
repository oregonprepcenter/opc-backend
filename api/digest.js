// /api/digest.js — Vercel Serverless Function (Cron)
// Sends a daily digest email at 7am Pacific to the admin
//
// SETUP:
// 1. Add SENDGRID_API_KEY, OPC_NOTIFY_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_KEY to Vercel env vars
// 2. Add to vercel.json: { "crons": [{ "path": "/api/digest", "schedule": "0 14 * * *" }] }
//    (14:00 UTC = 7:00 AM Pacific)

var sgMail = require("@sendgrid/mail");

module.exports = async function handler(req, res) {
  // Allow manual trigger via GET or cron trigger
  var apiKey = process.env.SENDGRID_API_KEY;
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  var notifyEmail = process.env.OPC_NOTIFY_EMAIL || "contact@oregonprepcenter.com";

  if (!apiKey || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  sgMail.setApiKey(apiKey);

  try {
    // Fetch the shared data blob from Supabase
    var response = await fetch(supabaseUrl + "/storage/v1/object/public/opc-wms-shared", {
      headers: { "Authorization": "Bearer " + supabaseKey, "apikey": supabaseKey }
    });

    if (!response.ok) {
      // Try alternate storage method
      var storageRes = await fetch(supabaseUrl + "/rest/v1/storage?select=value&key=eq.opc-wms-shared", {
        headers: { "Authorization": "Bearer " + supabaseKey, "apikey": supabaseKey }
      });
      if (!storageRes.ok) return res.status(500).json({ error: "Could not read Supabase data" });
    }

    var data;
    try {
      var text = await (response.ok ? response : storageRes).text();
      data = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({ error: "Could not parse data" });
    }

    var orders = data.orders || [];
    var inventory = data.inventory || [];
    var batches = data.batches || [];
    var bills = data.bills || [];
    var clients = data.clients || [];

    // Calculate digest stats
    var now = new Date();
    var yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    var yesterdayStr = yesterday.toISOString().slice(0, 10);
    var todayStr = now.toISOString().slice(0, 10);

    var newItems24h = inventory.filter(function(i) {
      return i.ts && new Date(i.ts) >= yesterday;
    }).length;

    var receivedToday = inventory.filter(function(i) {
      return (i.dr || "") === todayStr || (i.dr || "") === yesterdayStr;
    }).length;

    var pendingRecv = inventory.filter(function(i) {
      return (i.qo || 0) > (i.qr || 0) && !i.nrFlag;
    }).length;

    var exceptions = inventory.filter(function(i) {
      return i.exFlag;
    }).length;

    var notReceived = inventory.filter(function(i) {
      return i.nrFlag;
    }).length;

    var aging30 = inventory.filter(function(i) {
      return i.dr && (now.getTime() - new Date(i.dr).getTime()) > 30 * 86400000 && !i.shipped;
    }).length;

    var overdueInvoices = bills.filter(function(b) {
      return b.st !== "Paid" && b.st !== "Void" && b.dueDate && new Date(b.dueDate) < now;
    });
    var overdueTotal = overdueInvoices.reduce(function(a, b) { return a + b.am; }, 0);

    var activeClients = clients.length;
    var totalBatches = batches.length;
    var completeBatches = batches.filter(function(b) { return b.st === "Complete"; }).length;

    // Build email
    var html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1B4332;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
          <h2 style="margin:0;font-size:18px">OPC Daily Digest</h2>
          <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,.6)">${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
        </div>
        <div style="background:#fff;padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 10px 10px">
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
            <div style="flex:1;min-width:100px;background:#f5f5f0;padding:12px;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:800;color:#1B4332">${newItems24h}</div>
              <div style="font-size:10px;color:#666">New Items (24h)</div>
            </div>
            <div style="flex:1;min-width:100px;background:#f5f5f0;padding:12px;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:800;color:#1B4332">${receivedToday}</div>
              <div style="font-size:10px;color:#666">Received Today</div>
            </div>
            <div style="flex:1;min-width:100px;background:#f5f5f0;padding:12px;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:800;color:${pendingRecv > 0 ? '#C2410C' : '#1B4332'}">${pendingRecv}</div>
              <div style="font-size:10px;color:#666">Awaiting Receipt</div>
            </div>
          </div>

          ${exceptions > 0 ? `<div style="background:#FEF2F2;border:1px solid #FECACA;padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:12px">⚠️ <strong>${exceptions}</strong> exception${exceptions !== 1 ? 's' : ''} flagged — review in portal</div>` : ''}
          ${notReceived > 0 ? `<div style="background:#FFF7ED;border:1px solid #FED7AA;padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:12px">📦 <strong>${notReceived}</strong> item${notReceived !== 1 ? 's' : ''} marked Not Received</div>` : ''}
          ${aging30 > 0 ? `<div style="background:#FFF7ED;border:1px solid #FED7AA;padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:12px">🕐 <strong>${aging30}</strong> item${aging30 !== 1 ? 's' : ''} aging 30+ days in warehouse</div>` : ''}

          ${overdueInvoices.length > 0 ? `
            <h3 style="font-size:13px;color:#DC2626;margin:16px 0 8px">Overdue Invoices ($${overdueTotal.toFixed(2)})</h3>
            <table style="width:100%;border-collapse:collapse;font-size:11px">
              <tr style="background:#f5f5f5"><th style="padding:6px;text-align:left">Invoice</th><th>Client</th><th>Amount</th><th>Due Date</th></tr>
              ${overdueInvoices.map(function(b) {
                return '<tr><td style="padding:6px;border-bottom:1px solid #eee">' + b.inv + '</td><td style="padding:6px;border-bottom:1px solid #eee">' + b.cl + '</td><td style="padding:6px;border-bottom:1px solid #eee">$' + b.am.toFixed(2) + '</td><td style="padding:6px;border-bottom:1px solid #eee">' + (b.dueDate || '—') + '</td></tr>';
              }).join('')}
            </table>
          ` : '<p style="font-size:12px;color:#22C55E">✅ No overdue invoices</p>'}

          <div style="margin-top:16px;font-size:11px;color:#666">
            <strong>${activeClients}</strong> active clients • <strong>${totalBatches}</strong> batches (<strong>${completeBatches}</strong> complete)
          </div>

          <div style="margin-top:16px;text-align:center">
            <a href="https://oregonprepcenter.com/portal" style="display:inline-block;padding:10px 24px;background:#1B4332;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px">Open Portal</a>
          </div>
        </div>
        <div style="text-align:center;margin-top:12px;font-size:10px;color:#999">Oregon Prep Center LLC | oregonprepcenter.com</div>
      </div>
    `;

    await sgMail.send({
      to: notifyEmail,
      from: { email: process.env.OPC_FROM_EMAIL || "contact@oregonprepcenter.com", name: "OPC Portal" },
      subject: "OPC Daily Digest — " + newItems24h + " new items, " + pendingRecv + " awaiting receipt",
      html: html
    });

    return res.status(200).json({ success: true, stats: { newItems24h, receivedToday, pendingRecv, exceptions, overdueInvoices: overdueInvoices.length } });
  } catch (error) {
    console.error("[Digest] Error:", error.message || error);
    return res.status(500).json({ error: error.message || "Digest failed" });
  }
};
