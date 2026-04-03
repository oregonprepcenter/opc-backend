module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  var body = req.body || {};
  var accessToken = body.access_token;
  var realmId = body.realm_id;
  var action = body.action || "create"; // "create", "check_payments", "void"

  // === ACTION: REFRESH TOKEN (doesn't need access_token/realmId) ===
  if (action === "refresh") {
    var refreshToken = body.refresh_token;
    if (!refreshToken) return res.status(400).json({ error: true, detail: "Missing refresh_token" });
    var clientId = process.env.QBO_CLIENT_ID;
    var clientSecret = process.env.QBO_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).json({ error: true, detail: "Missing QB credentials on server" });
    try {
      var tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refreshToken)
      });
      var tokenData = await tokenRes.json();
      if (tokenData.access_token) {
        return res.status(200).json({ success: true, access_token: tokenData.access_token, refresh_token: tokenData.refresh_token || refreshToken });
      }
      return res.status(400).json({ error: true, detail: "Token refresh failed: " + JSON.stringify(tokenData) });
    } catch (e) {
      return res.status(500).json({ error: true, detail: e.message });
    }
  }

  if (!accessToken || !realmId) {
    return res.status(400).json({ error: true, detail: "Missing access_token or realm_id" });
  }

  var baseUrl = "https://quickbooks.api.intuit.com/v3/company/" + realmId;
  var headers = {
    "Authorization": "Bearer " + accessToken,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };

  try {
    // === ACTION: CHECK PAYMENTS ===
    if (action === "check_payments") {
      var invoiceIds = body.invoice_ids || [];
      var results = [];
      for (var i = 0; i < invoiceIds.length; i++) {
        var invRes = await fetch(baseUrl + "/invoice/" + invoiceIds[i], { headers: headers });
        var invData = await invRes.json();
        if (invData.Invoice) {
          var balance = invData.Invoice.Balance;
          var dueDate = invData.Invoice.DueDate;
          var status = balance === 0 ? "Paid" : (dueDate && new Date(dueDate) < new Date() ? "Overdue" : "Open");
          results.push({ qb_invoice_id: invoiceIds[i], status: status, balance: balance, total: invData.Invoice.TotalAmt });
        }
      }
      return res.status(200).json({ success: true, invoices: results });
    }

    // === ACTION: VOID INVOICE ===
    if (action === "void") {
      var invoiceId = body.invoice_id;
      if (!invoiceId) return res.status(400).json({ error: true, detail: "Missing invoice_id" });
      var getRes = await fetch(baseUrl + "/invoice/" + invoiceId, { headers: headers });
      var getData = await getRes.json();
      if (!getData.Invoice) return res.status(400).json({ error: true, detail: "Invoice not found in QB" });
      var voidRes = await fetch(baseUrl + "/invoice?operation=void", {
        method: "POST", headers: headers,
        body: JSON.stringify({ Id: invoiceId, SyncToken: getData.Invoice.SyncToken, sparse: true })
      });
      var voidData = await voidRes.json();
      if (voidData.Invoice) return res.status(200).json({ success: true, invoice_id: invoiceId });
      return res.status(400).json({ error: true, detail: JSON.stringify(voidData) });
    }

    // === ACTION: CREATE INVOICE (default) ===
    // 1. Find or create customer
    var customerName = body.customer_name || "Unknown Client";
    var customerQuery = encodeURIComponent("SELECT * FROM Customer WHERE DisplayName = '" + customerName.replace(/'/g, "\\'") + "'");
    var custRes = await fetch(baseUrl + "/query?query=" + customerQuery, { headers: headers });
    var custData = await custRes.json();

    var customerId;
    if (custData.QueryResponse && custData.QueryResponse.Customer && custData.QueryResponse.Customer.length > 0) {
      customerId = custData.QueryResponse.Customer[0].Id;
    } else {
      var newCust = await fetch(baseUrl + "/customer", {
        method: "POST", headers: headers,
        body: JSON.stringify({ DisplayName: customerName })
      });
      var newCustData = await newCust.json();
      if (newCustData.Customer) {
        customerId = newCustData.Customer.Id;
      } else {
        return res.status(400).json({ error: true, detail: "Failed to create customer: " + JSON.stringify(newCustData) });
      }
    }

    // 2. Build line items
    var lineItems = (body.line_items || []).map(function(item) {
      return {
        DetailType: "SalesItemLineDetail",
        Amount: item.amount || (item.qty * item.price) || 0,
        Description: item.description || item.name || "",
        SalesItemLineDetail: { Quantity: item.qty || 1, UnitPrice: item.price || item.amount || 0 }
      };
    });
    if (lineItems.length === 0) {
      lineItems = [{ DetailType: "SalesItemLineDetail", Amount: 0, Description: "Service", SalesItemLineDetail: { Quantity: 1, UnitPrice: 0 } }];
    }

    // 3. Create invoice
    var invoiceBody = {
      CustomerRef: { value: customerId },
      Line: lineItems,
      DocNumber: body.invoice_number || undefined,
      DueDate: body.due_date || undefined,
      CustomerMemo: body.memo ? { value: body.memo } : undefined
    };
    Object.keys(invoiceBody).forEach(function(k) { if (invoiceBody[k] === undefined) delete invoiceBody[k]; });

    var createRes = await fetch(baseUrl + "/invoice", {
      method: "POST", headers: headers,
      body: JSON.stringify(invoiceBody)
    });
    var createData = await createRes.json();

    if (createData.Invoice) {
      return res.status(200).json({
        success: true,
        invoice_id: createData.Invoice.Id,
        doc_number: createData.Invoice.DocNumber,
        total: createData.Invoice.TotalAmt
      });
    }
    return res.status(400).json({
      error: true,
      detail: createData.Fault ? createData.Fault.Error.map(function(e) { return e.Message }).join("; ") : JSON.stringify(createData)
    });
  } catch (e) {
    return res.status(500).json({ error: true, detail: e.message || "Unknown error" });
  }
};
