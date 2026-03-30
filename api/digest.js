module.exports = async function handler(req, res) {
  var sgKey = process.env.SENDGRID_API_KEY;
  var fromEmail = process.env.OPC_FROM_EMAIL || "contact@oregonprepcenter.com";
  var supabaseUrl = process.env.SUPABASE_URL;
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY;
 
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing SUPABASE env vars" });
  }
  if (!sgKey) {
    return res.status(500).json({ error: "Missing SENDGRID_API_KEY" });
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
    var orders = data.orders || [];
    var inventory = data.inventory || [];
    var bills = data.bills || [];
    var batches = data.batches || [];
    var clients = data.clients || [];
 
    var now = new Date();
    var today = now.toISOString().slice(0, 10);
    var receivedToday = inventory.filter(function(i) { return i.dr === today; }).length;
    var pendingOrders = orders.filter(function(o) { return o.st !== "Shipped" && o.st !== "Completed"; }).length;
    var overdueInvoices = bills.filter(function(b) { return b.st === "Overdue"; }).length;
    var totalRevenue = bills.filter(function(b) { return b.st !== "Void"; }).reduce(function(a, b) { return a + (b.am || 0); }, 0);
    var queuedBatches = batches.filter(function(b) { return b.st === "Queued"; }).length;
 
    var html = "<h2>OPC Daily Digest - " + today + "</h2>" +
      "<p><strong>Received Today:</strong> " + receivedToday + " items</p>" +
      "<p><strong>Pending Orders:</strong> " + pendingOrders + "</p>" +
      "<p><strong>Queued Batches:</strong> " + queuedBatches + "</p>" +
      "<p><strong>Overdue Invoices:</strong> " + overdueInvoices + "</p>" +
      "<p><strong>Total Revenue:</strong> $" + totalRevenue.toFixed(2) + "</p>" +
      "<p><strong>Active Clients:</strong> " + clients.length + "</p>" +
      "<hr><p style='color:#666;font-size:12px'>Oregon Prep Center | oregonprepcenter.com</p>";
 
    var sgRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + sgKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: fromEmail }] }],
        from: { email: fromEmail, name: "Oregon Prep Center" },
        subject: "OPC Daily Digest - " + today,
        content: [{ type: "text/html", value: html }]
      })
    });
 
    return res.status(200).json({
      success: sgRes.ok,
      digest: { receivedToday: receivedToday, pendingOrders: pendingOrders, queuedBatches: queuedBatches, overdueInvoices: overdueInvoices, revenue: totalRevenue.toFixed(2), clients: clients.length }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
 
