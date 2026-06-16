import { assertRateLimit, searchReports } from "../lib/twse.js";

export default async function handler(req, res) {
  try {
    assertRateLimit(req);
    const result = await searchReports(req.query || {});
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "系統發生錯誤" });
  }
}
