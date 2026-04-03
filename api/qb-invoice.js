module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  var body = req.body || {};
  var accessToken = body.access_token;
  var realmId = body.realm_id;

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
    // 1. Find or create the customer
    var customerName = body.customer_name || "Unknown Client";
    var customerQuery = encodeURIComponent("SELECT * FROM Customer WHERE DisplayName = '" + customerName.replace(/'/g, "\\'") + "'");
    var custRes = await fetch(baseUrl + "/query?query=" + customerQuery, { headers: headers });
    var custData = await custRes.json();
    
    var customerId;
    if (custData.QueryResponse && custData.QueryResponse.Customer && custData.QueryResponse.Customer.length > 0) {
      customerId = custData.QueryResponse.Customer[0].Id;
    } else {
      // Create customer
      var newCust = await fetch(baseUrl + "/customer", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ DisplayName: customerName })
      });
      var newCustData = await newCust.json();
      if (newCustData.Customer) {
        customerId = newCustData.Customer.Id;
      } else {
        return res.status(400).json({ error: true, detail: "Failed to create customer: " + JSON.stringify(newCustData) });
      }
    }

    // 2. Build invoice line items
    var lineItems = (body.line_items || []).map(function(item, idx) {
      return {
        DetailType: "SalesItemLineDetail",
        Amount: item.amount || (item.qty * item.price) || 0,
        Description: item.description || item.name || "",
        SalesItemLineDetail: {
          Quantity: item.qty || 1,
          UnitPrice: item.price || item.amount || 0
        }
      };
    });

    if (lineItems.length === 0) {
      lineItems = [{ DetailType: "SalesItemLineDetail", Amount: 0, Description: "Service", SalesItemLineDetail: { Quantity: 1, UnitPrice: 0 } }];
    }

    // 3. Create the invoice
    var invoiceBody = {
      CustomerRef: { value: customerId },
      Line: lineItems,
      DocNumber: body.invoice_number || undefined,
      DueDate: body.due_date || undefined,
      CustomerMemo: body.memo ? { value: body.memo } : undefined,
      SalesTermRef: body.terms === "Due on Receipt" ? { value: "1" } : undefined
    };

    // Remove undefined fields
    Object.keys(invoiceBody).forEach(function(k) { if (invoiceBody[k] === undefined) delete invoiceBody[k]; });

    var invRes = await fetch(baseUrl + "/invoice", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(invoiceBody)
    });

    var invData = await invRes.json();

    if (invData.Invoice) {
      return res.status(200).json({
        success: true,
        invoice_id: invData.Invoice.Id,
        doc_number: invData.Invoice.DocNumber,
        total: invData.Invoice.TotalAmt
      });
    } else {
      return res.status(400).json({
        error: true,
        detail: invData.Fault ? invData.Fault.Error.map(function(e) { return e.Message }).join("; ") : JSON.stringify(invData)
      });
    }
  } catch (e) {
    return res.status(500).json({ error: true, detail: e.message || "Unknown error" });
  }
};
