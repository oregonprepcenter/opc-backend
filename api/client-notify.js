// /api/client-notify.js — Vercel Serverless Function
// Sends notification emails to clients for key events:
//   - package_arrived: When their package is scanned/received
//   - prep_complete: When their batch is marked Complete
//   - order_shipped: When their shipment is confirmed
//
// SETUP: Add SENDGRID_API_KEY, OPC_FROM_EMAIL to Vercel env vars
// CALL: POST /api/client-notify { type, clientEmail, clientName, data }

var sgMail = require("@sendgrid/mail");

var TEMPLATES = {
  package_arrived: {
    subject: function(data) { return "Package Received — " + (data.trackingNumber || "Your Order"); },
    html: function(data) {
      return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
        '<div style="background:#1B4332;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">' +
        '<h2 style="margin:0;font-size:18px">Package Received ✅</h2></div>' +
        '<div style="background:#fff;padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 10px 10px">' +
        '<p style="font-size:13px">Hi <strong>' + (data.clientName || 'there') + '</strong>,</p>' +
        '<p style="font-size:13px;color:#444">We received your package at our facility:</p>' +
        '<div style="background:#f5f5f0;padding:14px;border-radius:8px;margin:12px 0">' +
        '<div style="font-size:11px;color:#666">Tracking Number:</div>' +
        '<div style="font-size:14px;font-weight:700;font-family:monospace;color:#1B4332">' + (data.trackingNumber || '—') + '</div>' +
        (data.carrier ? '<div style="font-size:11px;color:#666;margin-top:4px">Carrier: ' + data.carrier + '</div>' : '') +
        (data.itemCount ? '<div style="font-size:11px;color:#666;margin-top:4px">Items: ' + data.itemCount + '</div>' : '') +
        '</div>' +
        '<p style="font-size:12px;color:#444">Your items are now in our receiving queue and will be prepped within 24–48 business hours.</p>' +
        '<div style="text-align:center;margin-top:16px"><a href="https://oregonprepcenter.com/portal" style="display:inline-block;padding:10px 24px;background:#1B4332;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px">View in Portal</a></div>' +
        '</div></div>';
    }
  },

  prep_complete: {
    subject: function(data) { return "Prep Complete — " + (data.batchId || "Your Order") + " Ready to Ship"; },
    html: function(data) {
      return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
        '<div style="background:#1B4332;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">' +
        '<h2 style="margin:0;font-size:18px">Prep Complete 📦</h2></div>' +
        '<div style="background:#fff;padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 10px 10px">' +
        '<p style="font-size:13px">Hi <strong>' + (data.clientName || 'there') + '</strong>,</p>' +
        '<p style="font-size:13px;color:#444">Great news — your order has been fully prepped and is ready to ship:</p>' +
        '<div style="background:#f5f5f0;padding:14px;border-radius:8px;margin:12px 0">' +
        '<div style="font-size:11px;color:#666">Batch:</div>' +
        '<div style="font-size:14px;font-weight:700;color:#1B4332">' + (data.batchId || '—') + '</div>' +
        '<div style="font-size:11px;color:#666;margin-top:6px">Items: <strong>' + (data.itemCount || 0) + '</strong> | Units: <strong>' + (data.unitCount || 0) + '</strong></div>' +
        '</div>' +
        '<p style="font-size:12px;color:#444">We will ship your order to the designated Amazon fulfillment center shortly. You will receive a shipping confirmation with tracking once shipped.</p>' +
        '<div style="text-align:center;margin-top:16px"><a href="https://oregonprepcenter.com/portal" style="display:inline-block;padding:10px 24px;background:#1B4332;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px">View in Portal</a></div>' +
        '</div></div>';
    }
  },

  order_shipped: {
    subject: function(data) { return "Order Shipped — " + (data.shipmentId || "Your Shipment"); },
    html: function(data) {
      return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
        '<div style="background:#1B4332;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">' +
        '<h2 style="margin:0;font-size:18px">Order Shipped 🚚</h2></div>' +
        '<div style="background:#fff;padding:20px;border:1px solid #ddd;border-top:none;border-radius:0 0 10px 10px">' +
        '<p style="font-size:13px">Hi <strong>' + (data.clientName || 'there') + '</strong>,</p>' +
        '<p style="font-size:13px;color:#444">Your order has been shipped!</p>' +
        '<div style="background:#f5f5f0;padding:14px;border-radius:8px;margin:12px 0">' +
        '<div style="font-size:11px;color:#666">Shipment ID:</div>' +
        '<div style="font-size:14px;font-weight:700;color:#1B4332">' + (data.shipmentId || '—') + '</div>' +
        '<div style="font-size:11px;color:#666;margin-top:6px">Items: <strong>' + (data.itemCount || 0) + '</strong></div>' +
        (data.outboundTracking ? '<div style="font-size:11px;color:#666;margin-top:6px">Outbound Tracking: <strong style="font-family:monospace">' + data.outboundTracking + '</strong></div>' : '') +
        '</div>' +
        '<p style="font-size:12px;color:#444">Track your shipment status in the portal for real-time updates.</p>' +
        '<div style="text-align:center;margin-top:16px"><a href="https://oregonprepcenter.com/portal" style="display:inline-block;padding:10px 24px;background:#1B4332;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px">Track in Portal</a></div>' +
        '</div></div>';
    }
  }
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "SENDGRID_API_KEY not configured" });

  sgMail.setApiKey(apiKey);

  var { type, clientEmail, clientName, data } = req.body || {};

  if (!type || !clientEmail) {
    return res.status(400).json({ error: "type and clientEmail required" });
  }

  var template = TEMPLATES[type];
  if (!template) {
    return res.status(400).json({ error: "Unknown notification type: " + type });
  }

  var mergedData = Object.assign({ clientName: clientName || "" }, data || {});

  try {
    await sgMail.send({
      to: clientEmail,
      from: { email: process.env.OPC_FROM_EMAIL || "contact@oregonprepcenter.com", name: "Oregon Prep Center" },
      subject: template.subject(mergedData),
      html: template.html(mergedData)
    });

    return res.status(200).json({ success: true, type: type, sent_to: clientEmail });
  } catch (error) {
    console.error("[Client Notify] Error:", error.message || error);
    return res.status(500).json({ error: "Failed to send: " + (error.message || "Unknown") });
  }
};
