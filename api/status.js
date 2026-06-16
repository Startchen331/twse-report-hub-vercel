import { statusPayload } from "../lib/twse.js";

export default function handler(req, res) {
  res.status(200).json(statusPayload());
}
