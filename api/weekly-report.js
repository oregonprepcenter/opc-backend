module.exports = async function handler(req, res) {
  var sgKey = process.env.SENDGRID_API_KEY;
  var fromEmail = process.env.OPC_FROM_EMAIL || "contact@oregonprepcenter.com";
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;
 
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing SUPABASE env vars" });
  }
  if (!sgKey) {
    return res.status(200).json({ skipped: true, reason: "Missing SENDGRID_API_KEY" });
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
    if (!dataRes.ok) return res.status(500).json({ error: "Could not read portal data" });
 
    var rows = await dataRes.json();
    if (!rows || rows.length === 0) return res.status(200).json({ error: "No portal data" });
 
    var data = JSON.parse(rows[0].value);
    var clients = data.clients || [];
    var inventory = data.inventory || [];
    var bills = data.bills || [];
    var batches = data.batches || [];
    var sent = 0;
 
    for (var i = 0; i < clients.length; i++) {
      var cl = clients[i];
      if (!cl.em) continue;
 
      var clInv = inventory.filter(function(it) { return it.cl === cl.n; });
      var clBills = bills.filter(function(b) { return b.cl === cl.n; });
      var clBatches = batches.filter(function(b) { return b.cl === cl.n; });
      var onHand = clInv.reduce(function(a, it) { return a + (it.oh || 0); }, 0);
      var received = clInv.filter(function(it) { return (it.qr || 0) > 0; }).length;
      var outstanding = clBills.filter(function(b) { return b.st === "Pending" || b.st === "Overdue"; }).reduce(function(a, b) { return a + (b.am || 0); }, 0);
 
      var html = "<h2>Weekly Summary for " + cl.n + "</h2>" +
        "<p><strong>Items on Hand:</strong> " + onHand + " units</p>" +
        "<p><strong>Items Received:</strong> " + received + "</p>" +
        "<p><strong>Active Batches:</strong> " + clBatches.length + "</p>" +
        "<p><strong>Outstanding Balance:</strong> $" + outstanding.toFixed(2) + "</p>" +
        "<hr><p style='color:#666;font-size:12px'>Oregon Prep Center | oregonprepcenter.com/portal</p>";
 
      try {
        await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { "Authorization": "Bearer " + sgKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: cl.em }] }],
            from: { email: fromEmail, name: "Oregon Prep Center" },
            subject: "Your Weekly OPC Summary - " + cl.n,
            content: [{ type: "text/html", value: html }]
          })
        });
        sent++;
      } catch (e) {}
    }
 
    return res.status(200).json({ success: true, clientsEmailed: sent, totalClients: clients.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
 
