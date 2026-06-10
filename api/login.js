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

  // 役員リスト（環境変数 YAKUIN：カンマ区切り）。役員は全用途が使える
  let yakuin = [];
  if (process.env.YAKUIN) {
    yakuin = process.env.YAKUIN.split(',').map(s => s.trim()).filter(Boolean);
  }

  // 従業員共通のデフォルト用途（環境変数 STAFF_ACCOUNTS：カンマ区切り）
  let staffAccounts = [];
  if (process.env.STAFF_ACCOUNTS) {
    staffAccounts = process.env.STAFF_ACCOUNTS.split(',').map(s => s.trim()).filter(Boolean);
  }

  // 人別の個別用途（環境変数 PERSON_ACCOUNTS：JSON）。指定があれば最優先
  let personAccounts = {};
  if (process.env.PERSON_ACCOUNTS) {
    try { personAccounts = JSON.parse(process.env.PERSON_ACCOUNTS); } catch (e) { personAccounts = {}; }
  }

  return res.status(200).json({
    token: makeToken('user'),
    persons,
    yakuin,
    staffAccounts,
    personAccounts
  });
}
