import crypto from 'crypto';

function sign(payload) {
  return crypto.createHmac('sha256', process.env.TOKEN_SECRET).update(payload).digest('hex');
}

// role='user' または 'admin' のトークンを発行（既定7日有効）
export function makeToken(role, days = 7) {
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = `${exp}.${role}`;
  return `${payload}.${sign(payload)}`;
}

// トークンが正しく、期限内で、必要な権限を満たすか検証
export function verifyToken(token, requiredRole) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, role, sig] = parts;
  const expected = sign(`${exp}.${role}`);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  if (Date.now() > Number(exp)) return false;
  // admin は user の権限も兼ねる
  if (requiredRole && role !== requiredRole && role !== 'admin') return false;
  return true;
}
