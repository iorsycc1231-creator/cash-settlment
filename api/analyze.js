export default async function handler(req, res) {
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
            { type: 'text', text: `このレシートを解析してJSONのみ返してください。説明不要。

重要ルール：
- nameはレシートに印字された文字を一字一句そのままコピー。要約・翻訳・省略・変換禁止
- カタカナは特に正確に：ン/ツ/ソ/リ/ー/ポ/ボ/パ/バなど濁点・半濁点・長音符を正確に読む
- amountは税込金額の数値のみ（カンマなし）
- tax_categoryは「※」「★」「軽」マークがあれば「8%軽減」、なければ「10%標準」
- invoice_numberは「T」で始まる13桁の番号、なければnull
- dateはYYYY-MM-DD形式（令和8年=2026年、令和7年=2025年）
- totalは合計税込金額

{"store_name":"店名","invoice_number":"T+13桁またはnull","date":"YYYY-MM-DD","items":[{"name":"印字文字そのまま","amount":数値,"tax_category":"10%標準または8%軽減または非課税"}],"tax_8":数値またはnull,"tax_10":数値またはnull,"total":数値}` }
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
    if (s === -1 || e === -1) return res.status(500).json({ error: 'JSONが見つかりません' });
    const parsed = JSON.parse(text.slice(s, e + 1));
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
