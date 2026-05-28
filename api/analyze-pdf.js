export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pdf, person } = req.body;
    if (!pdf) return res.status(400).json({ error: 'PDFデータがありません' });

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
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdf
              }
            },
            {
              type: 'text',
              text: `このクレジットカード明細PDFを解析してJSONのみ返してください。説明不要。

ルール：
- 明細の各行を1件ずつitemsに含める
- nameは明細に記載された店名・内容をそのままコピー
- amountは金額（数値のみ、カンマなし）。返金・キャンセルはマイナス
- dateはYYYY-MM-DD形式。年が省略されていれば直近の年を推定
- accountは以下で判定：
  ・「駐車場」「パーキング」→「駐車代」
  ・「タクシー」「Uber」「交通」→「タクシー代」
  ・「飲料」「ドリンク」「コーヒー」→「飲料代」
  ・飲食店・レストラン・カフェ→「飲食代」
  ・「ティッシュ」「洗剤」「作業着」→「消耗品」
  ・「自賠責」→「自賠責保険代」
  ・それ以外→「雑費」
- card_nameはカード名（例：三井住友カード）。不明なら空文字

返すJSONの形式：
{"card_name":"カード名","items":[{"name":"店名・内容","amount":金額,"date":"YYYY-MM-DD","account":"勘定科目"}]}`
            }
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

    // 勘定科目バリデーション
    const validAccounts = ['駐車代','タクシー代','飲料代','飲食代','打ち合わせ','残業食事代','草刈り食事代','消耗品','自賠責保険代','不明','雑費','会費'];
    if (Array.isArray(parsed.items)) {
      parsed.items = parsed.items.map(item => ({
        ...item,
        amount: Number(item.amount) || 0,
        account: validAccounts.includes(item.account) ? item.account : '雑費'
      }));
    }

    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
