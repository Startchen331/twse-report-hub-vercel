import { getSourceRedirectHtml } from "../lib/twse.js";

export default function handler(req, res) {
  try {
    const params = new URLSearchParams(req.query || {});
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(getSourceRedirectHtml(params));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || "系統發生錯誤" });
  }
}
