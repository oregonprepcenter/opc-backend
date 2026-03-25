// /api/onboard-client.js — Vercel Serverless Function
// Sends welcome email to new clients when added in the portal
//
// SETUP: Add SENDGRID_API_KEY, OPC_FROM_EMAIL to Vercel env vars
// CALL: POST /api/onboard-client { name, email, tempPassword }

var sgMail = require("@sendgrid/mail");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "SENDGRID_API_KEY not configured" });

  sgMail.setApiKey(apiKey);

  var { name, email, tempPassword } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: "name and email required" });

  var fromEmail = process.env.OPC_FROM_EMAIL || "contact@oregonprepcenter.com";

  try {
    await sgMail.send({
      to: email,
      from: { email: fromEmail, name: "Oregon Prep Center" },
      subject: "Welcome to Oregon Prep Center — Your Portal Access",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <div style="background:#1B4332;color:#fff;padding:20px;border-radius:10px 10px 0 0;text-align:center">
            <h1 style="margin:0;font-size:22px">Oregon Prep Center</h1>
            <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.7)">Welcome to the Client Portal</p>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #ddd;border-top:none;border-radius:0 0 10px 10px">
            <p style="font-size:14px">Hi <strong>${name}</strong>,</p>
            <p style="font-size:13px;color:#444;line-height:1.6">
              Your Oregon Prep Center account is set up and ready to go. Here are your portal login credentials:
            </p>
            <div style="background:#f5f5f0;padding:16px;border-radius:8px;margin:16px 0;font-family:monospace">
              <div style="font-size:12px;color:#666;margin-bottom:4px">Portal URL:</div>
              <div style="font-size:14px;font-weight:700"><a href="https://oregonprepcenter.com/portal" style="color:#1B4332">oregonprepcenter.com/portal</a></div>
              ${tempPassword ? `
              <div style="font-size:12px;color:#666;margin:12px 0 4px">Temporary Password:</div>
              <div style="font-size:16px;font-weight:700;color:#1B4332;letter-spacing:1px">${tempPassword}</div>
              <div style="font-size:10px;color:#999;margin-top:4px">Please change this after your first login in Account settings.</div>
              ` : ''}
            </div>
            <p style="font-size:13px;color:#444;line-height:1.6">
              Through the portal you can:<br>
              • Track inbound packages across all carriers<br>
              • View inventory status and order progress<br>
              • Download invoices and payment history<br>
              • Submit tracking numbers for new orders
            </p>
            <p style="font-size:13px;color:#444">
              Questions? Reply to this email or call us at <strong>971-515-3004</strong>.
            </p>
            <div style="margin-top:20px;text-align:center">
              <a href="https://oregonprepcenter.com/portal" style="display:inline-block;padding:12px 28px;background:#1B4332;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Log In to Portal</a>
            </div>
          </div>
          <div style="text-align:center;margin-top:16px;font-size:10px;color:#999">
            Oregon Prep Center LLC | oregonprepcenter.com
          </div>
        </div>
      `
    });

    return res.status(200).json({ success: true, message: "Welcome email sent to " + email });
  } catch (error) {
    console.error("[Onboard] SendGrid error:", error.message || error);
    return res.status(500).json({ error: "Failed to send email: " + (error.message || "Unknown error") });
  }
};
