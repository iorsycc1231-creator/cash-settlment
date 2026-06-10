import { verifyToken } from './_auth.js';

const ALLOWED_ORIGIN = process.env.APP_ORIGIN;

export default async function handler(req, res) {
  if (req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-access-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 認証チェック（トークンが無ければ拒否＝API乱用・コスト爆発を防ぐ）
  if (!verifyToken(req.headers['x-access-token'], 'user')) {
    return res.status(401).json({ error: '認証が必要です' });
  }

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
            { type: 'text', text: `この画像がレシート・領収書でない場合は {"error":"レシートではありません"} のみ返してください。

レシート・領収書の場合は以下のルールでJSONのみ返してください。説明不要。

重要ルール：
- nameはレシートに印字された文字を一字一句そのままコピー。要約・翻訳・省略・変換禁止
- カタカナは特に正確に：ン/ツ/ソ/リ/ー/ポ/ボ/パ/バなど濁点・半濁点・長音符を正確に読む
- amountは税込金額の数値のみ（カンマなし、符号あり）
- 【最重要】「割引」「値引」「クーポン」「Code128」「ポイント」などのマイナス行は、レシートに「-」がついていれば必ずamountを負の整数で返す。例：レシートに「-49」とあれば amount: -49
- tax_categoryは次の4区分のいずれかで判定する：「10%標準」「8%軽減」「非課税」「不課税」
  ・まず内容で判定する（マークより内容を優先）：
    - 自賠責保険料・各種保険料 → 「非課税」
    - 収入印紙・行政手数料（戸籍・住民票・印鑑証明・納税証明など官公署の証明発行手数料）→ 「非課税」
    - 重量税・自動車税・軽自動車税・印紙税などの税金 → 「不課税」
    - 新聞の定期購読料 → 「8%軽減」
  ・上記に当てはまらない場合はマークで判定：「※」「★」「軽」「#」マークがあれば「8%軽減」、なければ「10%標準」
- invoice_numberは「T」で始まる13桁の番号。レシートの隅・左下・欄外・薄い小さな文字でも必ず探して読み取る。鉄道（JR東日本など）・交通機関・タクシーのレシートは登録番号が左下や下部に薄く小さく印字されることが多いので特に注意して探す。どうしても読み取れない場合のみnull
- invoice_statusは、invoice_numberがあれば「適格」、なければ「要確認」
- dateはYYYY-MM-DD形式（令和8年=2026年、令和7年=2025年）
- totalは税込の実際の支払合計金額（「合計」「お会計」欄の金額）
- tax_8：レシートに記載された8%消費税額。「外税額 8%」「消費税8%」「内消費税等8%」どの形式でも必ず読み取る。なければnull
- tax_10：レシートに記載された10%消費税額。同様に必ず読み取る。なければnull
- tax_8 / tax_10 は必ずレシートに印字されている金額をそのまま使う。自分で計算し直さない。端数処理の結果レシート上で「¥0」と印字されている場合は 0 とする（例：税率10%対象額¥3で内消費税等10%が¥0なら tax_10 は 0）
- car_number：自賠責保険・自動車保険の領収証の場合、「自動車登録番号」「車両番号」（例：市川400 さ 62）を読み取る。それ以外のレシートや読み取れない場合は null
- accountは以下のルールで判定する：
  ・店名や品目に「駐車場」「パーキング」→「駐車代」
  ・「交通」「タクシー」「Uber」「uber」→「タクシー代」
  ・「飲料」「ドリンク」「ジュース」「カゴメ」「お茶」「緑茶」「麦茶」「ほうじ茶」「コーヒー」「コーラ」「サイダー」「水」→「飲料代」
  ・飲食店（レストラン・カフェ・定食・ラーメン・寿司・居酒屋等）→「飲食代」
  ・店名に「コーナン」が含まれる場合、全品目→「消耗品」
  ・「ティッシュ」「トイレ」「洗剤」「作業着」「手袋」「軍手」→「消耗品」
  ・「自賠責」→「自賠責保険代」
  ・上記以外→「雑費」

【複数レシートの対応】
- 1枚の画像に複数のレシート・領収書が写っている場合は、それぞれを別々のレシートとして認識し、receipts配列に複数の要素として返す。
- タクシー・交通機関などの小さく簡易なレシートは、1枚の画像に最大4枚程度並んでいても、それぞれ漏れなく認識してreceipts配列に入れる。
- 1枚だけの場合はreceipts配列に1要素だけ返す。
- 各レシートは独立して上記ルールで読み取る。見落としがないよう、画像の隅々まで確認する。

次のJSON形式のみで返す（説明不要）。必ずreceipts配列の形にする：
{"receipts":[{"store_name":"店名","invoice_number":"T+13桁またはnull","invoice_status":"適格または要確認","date":"YYYY-MM-DD","car_number":"自動車登録番号またはnull","items":[{"name":"印字文字そのまま","amount":数値(値引きは必ず負の数),"tax_category":"10%標準または8%軽減または非課税または不課税","account":"駐車代/タクシー代/飲料代/飲食代/消耗品/自賠責保険代/雑費のいずれか"}],"tax_8":数値またはnull,"tax_10":数値またはnull,"total":数値}]}` }
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
    let jsonStr = text.slice(s, e + 1);

    // JSONを解析（崩れていれば自動修復してから再試行）
    let parsedRaw;
    try {
      parsedRaw = JSON.parse(jsonStr);
    } catch (e1) {
      const repaired = repairJSON(jsonStr);
      try {
        parsedRaw = JSON.parse(repaired);
      } catch (e2) {
        // それでもダメなら、エラー位置の手前までで切り詰めて配列・オブジェクトを閉じてみる
        const salvaged = salvageJSON(jsonStr);
        if (salvaged) {
          try { parsedRaw = JSON.parse(salvaged); } catch (e3) { parsedRaw = null; }
        }
        if (!parsedRaw) {
          return res.status(500).json({ error: 'レシートの読み取りに失敗しました（写真を撮り直すか、1枚ずつお試しください）' });
        }
      }
    }

    // レシートでないと判定された場合
    if (parsedRaw.error) {
      return res.status(400).json({ error: parsedRaw.error });
    }

    // receipts配列に正規化（旧形式：単一レシートが返ってきた場合も配列に包む）
    let receipts = [];
    if (Array.isArray(parsedRaw.receipts)) {
      receipts = parsedRaw.receipts;
    } else if (parsedRaw.items || parsedRaw.store_name) {
      receipts = [parsedRaw];
    } else {
      return res.status(500).json({ error: 'レシートを認識できませんでした' });
    }

    const validAccounts = ['駐車代','タクシー代','飲料代','飲食代','打ち合わせ','残業食事代','草刈り食事代','消耗品','自賠責保険代','不明','雑費','会費'];
    const discountPattern = /割引|値引|クーポン|ポイント|code\d+|discount/i;

    // 各レシートごとに値引き統合・勘定科目の検証を行う
    receipts = receipts.map(rcpt => {
      if (Array.isArray(rcpt.items)) {
        let items = rcpt.items.map(item => {
          const amount = Number(item.amount) || 0;
          if (discountPattern.test(item.name) && amount > 0) return { ...item, amount: -amount };
          return { ...item, amount };
        });
        const merged = [];
        for (const item of items) {
          const amount = Number(item.amount) || 0;
          if (amount < 0 && merged.length > 0) {
            merged[merged.length - 1].amount += amount;
          } else {
            merged.push({ ...item, amount });
          }
        }
        rcpt.items = merged.map(item => ({
          ...item,
          account: validAccounts.includes(item.account) ? item.account : '雑費'
        }));
      }
      return rcpt;
    });

    // 後方互換：先頭レシートのフィールドもトップレベルに展開して返す
    const first = receipts[0] || {};
    return res.status(200).json({ ...first, receipts });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// JSONのよくある崩れを修復する
function repairJSON(str) {
  let s = str;
  // 制御文字（生の改行・タブが文字列内に紛れ込んだ場合）を除去しすぎない範囲で正規化
  // 末尾の余分なカンマ（,} や ,]）を除去
  s = s.replace(/,\s*([}\]])/g, '$1');
  // 連続するカンマを1つに
  s = s.replace(/,\s*,/g, ',');
  // 数値の桁区切りカンマ（"amount": 1,572 のような誤り）を除去：数字,数字3桁 を結合
  s = s.replace(/(\d),(\d{3})(?=[\s,}\]])/g, '$1$2');
  // 全角の引用符やコロンを半角へ
  s = s.replace(/：/g, ':').replace(/、/g, ',');
  return s;
}

// 壊れたJSONを、途中まででも有効な形に切り詰めて復元する
// 開いている { [ を数えて、足りない分を閉じる
function salvageJSON(str) {
  let s = repairJSON(str);
  // 最後の完全な要素までで切る：直近の } または ] の位置を探しつつ括弧を閉じる
  let depth = 0, inStr = false, esc = false, stack = [];
  let lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') { stack.push(c); }
    else if (c === '}' || c === ']') { stack.pop(); if (stack.length <= 1) lastSafe = i; }
    else if (c === ',' && stack.length <= 2) { lastSafe = i; }
  }
  if (lastSafe === -1) return null;
  // lastSafeまで取り、開いている括弧を閉じる
  let head = s.slice(0, lastSafe);
  // 末尾がカンマなら除去
  head = head.replace(/,\s*$/, '');
  // 開いている括弧を数えて閉じる
  let open = [], inS = false, es = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (es) { es = false; continue; }
    if (c === '\\') { es = true; continue; }
    if (c === '"') { inS = !inS; continue; }
    if (inS) continue;
    if (c === '{' || c === '[') open.push(c);
    else if (c === '}') { if (open[open.length-1] === '{') open.pop(); }
    else if (c === ']') { if (open[open.length-1] === '[') open.pop(); }
  }
  let close = '';
  for (let i = open.length - 1; i >= 0; i--) {
    close += (open[i] === '{') ? '}' : ']';
  }
  return head + close;
}
