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
    var custText = await custRes.text();
    var custData;
    try { custData = JSON.parse(custText); } catch(e) {
      return res.status(400).json({ error: true, detail: "QB customer query failed: " + custText.slice(0, 500) });
    }
    if (custData.fault || custData.Fault) {
      var faultErr = (custData.Fault || custData.fault);
      var errMsg = faultErr.Error ? faultErr.Error.map(function(e){ return e.message || e.Message }).join("; ") : JSON.stringify(faultErr);
      return res.status(400).json({ error: true, detail: errMsg });
    }

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
        return res.status(400).json({ error: true, detail: "Failed to create customer: " + JSON.stringify(newCustData), sent_customer: customerName });
      }
    }

    // 2. Build line items
    // First, find or create a "Services" item in QB for line items
    var serviceItemId = null;
    try {
      var itemQuery = encodeURIComponent("SELECT * FROM Item WHERE Name = 'Services' AND Type = 'Service'");
      var itemRes = await fetch(baseUrl + "/query?query=" + itemQuery, { headers: headers });
      var itemData = await itemRes.json();
      if (itemData.QueryResponse && itemData.QueryResponse.Item && itemData.QueryResponse.Item.length > 0) {
        serviceItemId = itemData.QueryResponse.Item[0].Id;
      } else {
        // Try to find any service item
        var anyQuery = encodeURIComponent("SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1");
        var anyRes = await fetch(baseUrl + "/query?query=" + anyQuery, { headers: headers });
        var anyData = await anyRes.json();
        if (anyData.QueryResponse && anyData.QueryResponse.Item && anyData.QueryResponse.Item.length > 0) {
          serviceItemId = anyData.QueryResponse.Item[0].Id;
        }
      }
    } catch (e) {}

    var lineItems = (body.line_items || []).map(function(item) {
      var amt = Math.round((item.amount || (item.qty * item.price) || 0) * 100) / 100;
      var line = {
        DetailType: "SalesItemLineDetail",
        Amount: amt,
        Description: item.description || item.name || ""
      };
      var detail = {
        UnitPrice: Math.round((item.price || 0) * 100) / 100,
        Qty: item.qty || 1
      };
      if (serviceItemId) {
        detail.ItemRef = { value: String(serviceItemId) };
      }
      line.SalesItemLineDetail = detail;
      return line;
    });
    if (lineItems.length === 0) {
      lineItems = [{ DetailType: "SalesItemLineDetail", Amount: 0, Description: "Service", SalesItemLineDetail: { Qty: 1, UnitPrice: 0 } }];
    }

    // 3. Create invoice - minimal payload
    var invoiceBody = {
      CustomerRef: { value: String(customerId) },
      Line: lineItems
    };

    // Only add optional fields if valid
    if (body.invoice_number) {
      invoiceBody.DocNumber = String(body.invoice_number).slice(0, 21);
    }
    if (body.due_date) {
      var dd = new Date(body.due_date);
      if (!isNaN(dd)) invoiceBody.DueDate = dd.toISOString().slice(0, 10);
    }
    if (body.memo) {
      invoiceBody.CustomerMemo = { value: String(body.memo).slice(0, 1000) };
    }

    var createRes = await fetch(baseUrl + "/invoice", {
      method: "POST", headers: headers,
      body: JSON.stringify(invoiceBody)
    });
    var rawText = await createRes.text();
    var createData;
    try { createData = JSON.parse(rawText); } catch(e) {
      return res.status(400).json({ error: true, detail: "QB returned non-JSON: " + rawText.slice(0, 500) });
    }

    if (createData.Invoice) {
      return res.status(200).json({
        success: true,
        invoice_id: createData.Invoice.Id,
        doc_number: createData.Invoice.DocNumber,
        total: createData.Invoice.TotalAmt
      });
    }

    // Return FULL QB error for debugging
    return res.status(400).json({
      error: true,
      detail: createData.Fault ? createData.Fault.Error.map(function(e) { return e.Message + " | " + (e.Detail || "") }).join("; ") : rawText.slice(0, 1000),
      sent_payload: invoiceBody
    });
  } catch (e) {
    return res.status(500).json({ error: true, detail: e.message || "Unknown error" });
  }
};
