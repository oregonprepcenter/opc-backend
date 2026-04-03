module.exports = async function handler(req, res) {
  var token = req.query.token;
  if (token) {
    try {
      await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token })
      });
    } catch (e) {}
  }
  res.status(200).json({ success: true, message: "Disconnected" });
};
