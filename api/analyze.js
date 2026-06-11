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
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
            { type: 'text', text: `この画像がレシート・領収書でない場合は {"error":"レシートではありません"} のみ返してください。

レシート・領収書の場合は以下のルールでJSONのみ返してください。説明不要。

【画像の向きについて】
- 画像が横向き（90°・180°・270°回転）の場合でも、文字列の向きから上下左右を自動判定して正しく読み取ること。回転していても全てのテキストを正確に読み取ること。

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
- invoice_numberは「T」で始まり数字13桁が続く番号（例：T2010001098023）。レシートの隅・左下・欄外・薄い小さな文字でも必ず探して読み取る。
  ・スーパー・量販店（イトーヨーカドー、西友など）の領収証は、登録番号が「登録番号 T〜」の形で、レシート下部や側面に【縦書き】【90度回転した向き】で薄く印字されていることが非常に多い。画像を回転させてでも、縦書き・横倒しのテキスト領域を必ず確認すること。
  ・「登録番号」「適格」「インボイス」などの語の近くを重点的に探す。
  ・数字が13桁あるか必ず数えて確認する。読めた番号が「T＋13桁」でない場合は、桁を読み直す。
  ・鉄道・交通機関・タクシーのレシートも左下や下部に薄く小さく印字されることが多い。
  ・どうしても読み取れない場合のみnull。
- invoice_statusは、invoice_numberがあれば「適格」、なければ「要確認」
- dateはYYYY-MM-DD形式（令和8年=2026年、令和7年=2025年）
- totalは税込の実際の支払合計金額（「合計」「お会計」欄の金額）
- car_number：自賠責保険・自動車保険の領収証の場合、「自動車登録番号」「車両番号」（例：市川400 さ 62）を読み取る。それ以外のレシートや読み取れない場合は null
- accountは以下のルールで判定する：
  ・店名や品目に「駐車場」「パーキング」→「駐車代」
  ・「交通」「タクシー」「Uber」「uber」「メーター運賃」「運賃」「ハイヤー」「TAXI」、または店名が「〇〇交通」「〇〇タクシー」「〇〇ハイヤー」→「タクシー代」
  ・「飲料」「ドリンク」「ジュース」「カゴメ」「お茶」「緑茶」「麦茶」「ほうじ茶」「コーヒー」「コーラ」「サイダー」「水」→「飲料代」
  ・飲食店（レストラン・カフェ・定食・ラーメン・寿司・居酒屋等）→「飲食代」
  ・店名に「コーナン」が含まれる場合、全品目→「消耗品」
  ・「ティッシュ」「トイレ」「洗剤」「作業着」「手袋」「軍手」→「消耗品」
  ・「自賠責」→「自賠責保険代」
  ・上記以外→「雑費」

【tax_summaryの読み取りルール】
tax_summaryはレシートの集計欄から8%・10%それぞれについて以下を読み取る。
各税率について独立して判定すること（片方が内税、もう片方が外税の混在も正確に捉える）。

taxable_amount（税込対象額）：
- 「8%対象」「10%対象」「軽減税率対象」などの行があればその金額を使う
- 印字された金額が税抜表示（外税）の場合は税込に換算する（8%なら×1.08、10%なら×1.10）
- 印字がなければ items の該当tax_categoryの合計から算出する
- 小数点以下は切り捨て

tax_amount（税額）：
- 「内消費税等 8%」「外税額 8%」など印字があればその金額をそのまま使う
- 印字がなければ taxable_amount から逆算する（内税なら taxable_amount × 8/108、外税なら taxable_amount × 8/100）
- 小数点以下は切り捨て

is_inclusive（内税かどうか）：
- 「内消費税等」「うち消費税」「内税」→ true
- 「外税額」「別途消費税」「外税」→ false
- 明記なし → true（日本の小売レシートは内税が原則）

該当する税率の取引が存在しない場合はそのキー自体をnullにする。

【複数レシートの対応】
- 1枚の画像に複数のレシート・領収書が写っている場合は、それぞれを別々のレシートとして認識し、receipts配列に複数の要素として返す。
- タクシー・交通機関などの小さく簡易なレシートは、1枚の画像に最大4枚程度並んでいても、それぞれ漏れなく認識してreceipts配列に入れる。
- 1枚だけの場合はreceipts配列に1要素だけ返す。
- 各レシートは独立して上記ルールで読み取る。見落としがないよう、画像の隅々まで確認する。

【横の領収書＋縦の明細が1枚になっているパターン】
- 1枚の画像の中に「領収書（横長・合計や宛名が書かれた部分）」と「明細（縦長・品目が並んだレシート部分）」が両方写っていることがある。
- この場合は別々のレシートとして分けず、1つのレシートとして統合して読み取る。明細部分から品目（items）を取得し、領収書部分から日付・店名・合計・インボイス番号を補完する。
- 向きが横と縦で混在していても、それぞれの向きを判定して読み取ること。
- 領収書部分と明細部分で合計金額が一致するはずなので、明細の品目合計が領収書の合計と合うように読み取る。

【タクシー・交通費の判定】
- 「メーター運賃」「運賃」「乗車」「ご乗車」「TAXI」「タクシー」「ハイヤー」「交通」などの語、またはタクシー会社・交通事業者名（〇〇交通、〇〇タクシー、〇〇ハイヤー等）が店名・品目にあれば account を「タクシー代」にする。

次のJSON形式のみで返す（説明不要）。必ずreceipts配列の形にする：
{"receipts":[{"store_name":"店名","invoice_number":"T+13桁またはnull","invoice_status":"適格または要確認","date":"YYYY-MM-DD","car_number":"自動車登録番号またはnull","items":[{"name":"印字文字そのまま","amount":数値(値引きは必ず負の数),"tax_category":"10%標準または8%軽減または非課税または不課税","account":"駐車代/タクシー代/飲料代/飲食代/消耗品/自賠責保険代/雑費のいずれか"}],"tax_summary":{"8":{"taxable_amount":税込対象額または null,"tax_amount":税額または null,"is_inclusive":trueまたはfalse}または null,"10":{"taxable_amount":税込対象額または null,"tax_amount":税額または null,"is_inclusive":trueまたはfalse}または null},"total":数値}]}` }
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

    let parsedRaw;
    try {
      parsedRaw = JSON.parse(jsonStr);
    } catch (e1) {
      const repaired = repairJSON(jsonStr);
      try {
        parsedRaw = JSON.parse(repaired);
      } catch (e2) {
        const salvaged = salvageJSON(jsonStr);
        if (salvaged) {
          try { parsedRaw = JSON.parse(salvaged); } catch (e3) { parsedRaw = null; }
        }
        if (!parsedRaw) {
          return res.status(500).json({ error: 'レシートの読み取りに失敗しました（写真を撮り直すか、1枚ずつお試しください）' });
        }
      }
    }

    if (parsedRaw.error) {
      return res.status(400).json({ error: parsedRaw.error });
    }

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

    receipts = receipts.map(rcpt => {
      // items の正規化
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

      // tax_summary の正規化・フォールバック計算
      rcpt.tax_summary = normalizeTaxSummary(rcpt.tax_summary, rcpt.items);

      return rcpt;
    });

    const first = receipts[0] || {};
    return res.status(200).json({ ...first, receipts });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// tax_summary を正規化し、不足分をitemsから補完する
function normalizeTaxSummary(summary, items) {
  const rates = { '8': { multiplier: 1.08, fraction: 8 / 108 }, '10': { multiplier: 1.10, fraction: 10 / 110 } };
  const result = {};

  for (const [rateKey, { multiplier, fraction }] of Object.entries(rates)) {
    const taxCategory = rateKey === '8' ? '8%軽減' : '10%標準';
    const src = summary?.[rateKey];

    // items から該当税率の税込合計を算出（フォールバック用）
    const itemsTotal = Array.isArray(items)
      ? items
          .filter(i => i.tax_category === taxCategory && Number(i.amount) > 0)
          .reduce((sum, i) => sum + Number(i.amount), 0)
      : 0;

    // 該当税率の品目が存在しない かつ summaryにも記載なし → null
    if (!src && itemsTotal === 0) {
      result[rateKey] = null;
      continue;
    }

    const isInclusive = src?.is_inclusive !== false; // 明記なしはtrue

    let taxableAmount = src?.taxable_amount != null ? Number(src.taxable_amount) : null;
    let taxAmount = src?.tax_amount != null ? Number(src.tax_amount) : null;

    // taxable_amountが税抜で渡されてきた場合は税込に換算（外税の場合）
    // ※プロンプトで税込に換算するよう指示済みだが念のため
    // isInclusiveがfalseかつtaxAmountが既知なら taxableAmount = taxableAmount（外税印字額）+ taxAmount
    if (!isInclusive && taxableAmount != null && taxAmount != null) {
      // 外税の場合、印字されている対象額が税抜なら税込に直す
      // すでに税込として返ってきていれば二重加算を避けるため、
      // taxableAmount > taxableAmount * 0.99 のチェックは不要（プロンプト側で統一済み）
      // ここでは念のため: taxable_amount が税抜っぽい（tax抜 × rate ≒ taxAmount）なら補正
      const impliedTax = Math.floor(taxableAmount * (rateKey === '8' ? 8 / 100 : 10 / 100));
      if (Math.abs(impliedTax - taxAmount) <= 2) {
        // 税抜金額として渡ってきていると判断 → 税込に換算
        taxableAmount = taxableAmount + taxAmount;
      }
    }

    // フォールバック: taxable_amount がなければ items 合計を使う
    if (taxableAmount == null || taxableAmount === 0) {
      taxableAmount = itemsTotal || null;
    }

    // tax_amount を逆算（印字がない場合）
    if (taxAmount == null && taxableAmount != null) {
      taxAmount = isInclusive
        ? Math.floor(taxableAmount * fraction)
        : Math.floor(taxableAmount * (rateKey === '8' ? 8 / 100 : 10 / 100));
    }

    result[rateKey] = {
      taxable_amount: taxableAmount,
      tax_amount: taxAmount,
      is_inclusive: isInclusive
    };
  }

  return result;
}

function repairJSON(str) {
  let s = str;
  s = s.replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/,\s*,/g, ',');
  s = s.replace(/(\d),(\d{3})(?=[\s,}\]])/g, '$1$2');
  s = s.replace(/：/g, ':').replace(/、/g, ',');
  return s;
}

function salvageJSON(str) {
  let s = repairJSON(str);
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
  let head = s.slice(0, lastSafe);
  head = head.replace(/,\s*$/, '');
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
