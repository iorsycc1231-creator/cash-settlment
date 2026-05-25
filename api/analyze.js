export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, mimeType } = req.body;
    if (!image || !mimeType) return res.status(400).json({ error: '画像データがありません' });

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'APIキーが設定されていません' });

    const prompt = `あなたは日本のレシート・領収書を解析する専門家です。
画像からすべての情報を正確に読み取り、以下のJSON形式のみで返してください。前置きや説明は不要です。

【重要な読み取りルール】
- invoice_number: 「T」で始まる13桁の登録番号を探す（例: T1234567890123）。レシートに「登録番号」「適格請求書発行事業者」「インボイス番号」などの表記の近くにある。見つからない場合は null
- date: レシートの日付をYYYY-MM-DD形式に変換。「令和」表記は西暦に変換（令和6年=2024年、令和7年=2025年、令和8年=2026年）
- store_name: 店名・会社名（ロゴや上部に大きく書かれた名称）
- items: 商品ごとに分けて読み取る。まとめ買いや小計は分割しない
  - name: 商品名・サービス名
  - amount: 税込金額（数値のみ、カンマなし）
  - tax_category: 「※」「★」「軽」などのマークがあれば「8%軽減」、なければ「10%標準」、非課税なら「非課税」
- tax_8: 消費税8%の税額（軽減税率分）。記載がなければ null
- tax_10: 消費税10%の税額（標準税率分）。記載がなければ null
- total: 合計金額（税込）。「合計」「お会計」「総額」などの欄の金額

返すJSONの形式:
{
  "store_name": "店名",
  "invoice_number": "T1234567890123またはnull",
  "date": "YYYY-MM-DD",
  "items": [
    {"name": "商品名", "amount": 数値, "tax_category": "10%標準"}
  ],
  "tax_8": 数値またはnull,
  "tax_10": 数値またはnull,
  "total": 数値
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err?.error?.message || 'APIエラー' });
    }

    const data = await response.json();
    const raw = data?.content?.[0]?.text || '';
    let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    const parsed = JSON.parse(text.slice(s, e + 1));
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
