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
    var dataRes = await fetch(supabaseUrl + "/rest/v1/portal_data?key=eq.opc-wms-shared&select=key,value", {
      headers: headers
    });
 
    if (!dataRes.ok) {
      return res.status(500).json({ error: "Could not read portal data", status: dataRes.status });
    }
 
    var rows = await dataRes.json();
    if (!rows || rows.length === 0) {
      return res.status(200).json({ error: "No portal data found" });
    }
 
    var data = JSON.parse(rows[0].value);
    var timestamp = new Date().toISOString();
    var backupKey = "backup-" + timestamp.slice(0, 10);
 
    // Save backup as a separate row in portal_data
    var existing = await fetch(supabaseUrl + "/rest/v1/portal_data?key=eq." + encodeURIComponent(backupKey) + "&select=key", {
      headers: headers
    });
    var existingRows = await existing.json();
 
    if (existingRows && existingRows.length > 0) {
      await fetch(supabaseUrl + "/rest/v1/portal_data?key=eq." + encodeURIComponent(backupKey), {
        method: "PATCH",
        headers: headers,
        body: JSON.stringify({ value: rows[0].value, updated_at: timestamp })
      });
    } else {
      await fetch(supabaseUrl + "/rest/v1/portal_data", {
        method: "POST",
        headers: Object.assign({}, headers, { "Prefer": "return=minimal" }),
        body: JSON.stringify({ key: backupKey, value: rows[0].value, updated_at: timestamp })
      });
    }
 
    return res.status(200).json({
      success: true,
      backupKey: backupKey,
      dataSize: rows[0].value.length,
      timestamp: timestamp
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
 
