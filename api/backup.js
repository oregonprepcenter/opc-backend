// /api/backup.js — Vercel Serverless Function (Cron)
// Nightly backup of all portal data to a separate Supabase table
//
// SETUP:
// 1. Add to vercel.json crons: { "path": "/api/backup", "schedule": "0 8 * * *" }
//    (8:00 UTC = 1:00 AM Pacific)
// 2. Create a 'backups' table in Supabase:
//    CREATE TABLE backups (
//      id serial PRIMARY KEY,
//      created_at timestamptz DEFAULT now(),
//      data jsonb,
//      size_bytes int
//    );
// 3. Add env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

module.exports = async function handler(req, res) {
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing SUPABASE env vars" });
  }

  try {
    // Read current data blob
    var dataRes = await fetch(supabaseUrl + "/rest/v1/rpc/get_shared_storage", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + supabaseKey,
        "apikey": supabaseKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ key_name: "opc-wms-shared" })
    });

    var data = null;
    if (dataRes.ok) {
      data = await dataRes.json();
    } else {
      // Fallback: try direct storage read
      var altRes = await fetch(supabaseUrl + "/storage/v1/object/public/opc-wms-shared", {
        headers: { "Authorization": "Bearer " + supabaseKey, "apikey": supabaseKey }
      });
      if (altRes.ok) data = await altRes.json();
    }

    if (!data) {
      return res.status(500).json({ error: "Could not read portal data" });
    }

    var dataStr = JSON.stringify(data);
    var sizeBytes = Buffer.byteLength(dataStr, 'utf8');

    // Write backup to backups table
    var insertRes = await fetch(supabaseUrl + "/rest/v1/backups", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + supabaseKey,
        "apikey": supabaseKey,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        data: data,
        size_bytes: sizeBytes
      })
    });

    if (!insertRes.ok) {
      var errText = await insertRes.text();
      return res.status(500).json({ error: "Backup insert failed: " + errText });
    }

    // Clean up old backups — keep last 30
    await fetch(supabaseUrl + "/rest/v1/rpc/cleanup_old_backups", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + supabaseKey,
        "apikey": supabaseKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ keep_count: 30 })
    }).catch(function() {});

    return res.status(200).json({
      success: true,
      size: (sizeBytes / 1024).toFixed(1) + " KB",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[Backup] Error:", error.message || error);
    return res.status(500).json({ error: error.message || "Backup failed" });
  }
};
