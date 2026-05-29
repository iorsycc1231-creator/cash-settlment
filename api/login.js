import { makeToken } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { code } = req.body || {};
  if (!code || code !== process.env.ACCESS_CODE) {
    return res.status(401).json({ error: 'コードが違います' });
  }
  return res.status(200).json({ token: makeToken('user') });
}
