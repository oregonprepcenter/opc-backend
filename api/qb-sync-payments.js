module.exports = async function handler(req, res) {
  res.status(200).json({ test: "NEW CODE IS LIVE", timestamp: Date.now() });
};
