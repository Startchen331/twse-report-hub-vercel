import { assertRateLimit, getDownloadResponse } from "../lib/twse.js";

export default async function handler(req, res) {
  try {
    assertRateLimit(req);
    const params = new URLSearchParams(req.query || {});
    const file = await getDownloadResponse(params);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.status(file.status).send(file.buffer);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "系統發生錯誤" });
  }
}
