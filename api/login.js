import { makeToken } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { code } = req.body || {};
  if (!code || code !== process.env.ACCESS_CODE) {
    return res.status(401).json({ error: 'コードが違います' });
  }

  // 精算者リスト（環境変数 PERSONS：カンマ区切り）
  let persons = [];
  if (process.env.PERSONS) {
    persons = process.env.PERSONS.split(',').map(s => s.trim()).filter(Boolean);
  }

  // 人別用途（環境変数 PERSON_ACCOUNTS：JSON）
  let personAccounts = {};
  if (process.env.PERSON_ACCOUNTS) {
    try { personAccounts = JSON.parse(process.env.PERSON_ACCOUNTS); } catch (e) { personAccounts = {}; }
  }

  return res.status(200).json({ token: makeToken('user'), persons, personAccounts });
}
