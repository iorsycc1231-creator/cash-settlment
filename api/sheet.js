import { verifyToken } from './_auth.js';

// 写真(base64)を受けられるようボディ上限を引き上げる
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// 管理者だけに許す操作（全データの読み取り・編集・削除・月次締め）
// load/loadDeposits は他人の経費が含まれるため申請者には渡さない
const ADMIN_ACTIONS = ['load', 'loadDeposits', 'monthClose', 'edit', 'delete', 'restore'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const action = (req.body && req.body.action) || '';
  const needAdmin = ADMIN_ACTIONS.includes(action);

  if (!verifyToken(req.headers['x-access-token'], needAdmin ? 'admin' : 'user')) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  try {
    const r = await fetch(process.env.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // GAS側で照合する合言葉を付与
      body: JSON.stringify({ ...req.body, gas_token: process.env.GAS_TOKEN })
    });
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
