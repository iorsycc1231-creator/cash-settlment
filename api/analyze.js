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

【店舗辞書（電話番号で店名を確定する）】
- スタンプ・印鑑の屋号は崩し字・かすれで誤読しやすいため、レシート内の電話番号（TEL）を読み取り、以下の辞書に一致したら店名はスタンプの見た目に関わらず辞書の店名で確定する：
  ・TEL 0470-22-3733 → store_name「千処」（館山市北条の飲食店。但し書きが「飲食代金」「御飲食代」等の場合、品目は「飲食代金」、accountは「飲食代」とする）
  ・TEL 03(3675)4649 または 03-3675-4649 → store_name「向寿し」（但し書きが飲食関連の場合、品目は「飲食代金」、accountは「飲食代」とする）
  ・TEL 0470-46-2245 → store_name「安東食堂」（但し書きが飲食関連の場合、品目は「飲食代金」、accountは「飲食代」とする）
- 特に手書き領収証のスタンプ屋号が潰れて判読できない場合は、無理に推測せず、まず電話番号を読み取って上記辞書と照合すること。辞書にも無く屋号も判読不能な場合のみ、読める範囲の文字で店名を返す。
- 辞書に無い電話番号の場合は通常どおり印字・スタンプから店名を読む。

【手書き領収証（コクヨ・汎用の領収証用紙）の読み方】
- 「領収証」と印字された汎用用紙に手書きされたものは、次のように読む：
  ・金額欄（¥マークの後の手書き数字）→ total。「¥6,500-」のような末尾のハイフンや「−」「※」は金額に含めない
  ・「但」の欄（但し書き）→ 品目名（items[0].name）。例：「飲食代金」「お食事代」
  ・但し書きが飲食関連（飲食・食事・御食事・宴会）→ account「飲食代」
  ・日付は「R8年4月25日」のような和暦表記も多い（令和8年=2026年）
  ・内訳欄（税率・消費税額等）が空欄の場合、tax_8/tax_10/taxable_8/taxable_10はすべてnull、tax_categoryは「10%標準」、tax_typeは「内税」とする
  ・登録番号欄が空欄ならinvoice_numberはnull

重要ルール：
- nameはレシートに印字された文字を一字一句そのままコピー。要約・翻訳・省略・変換禁止
- カタカナは特に正確に：ン/ツ/ソ/リ/ー/ポ/ボ/パ/バなど濁点・半濁点・長音符を正確に読む
- amountはレシートに印字された品目金額の数値のみ（カンマなし、符号あり）。内税レシートなら税込印字額、外税レシートなら税抜印字額をそのまま使う。自分で税を加減算しない
- 【最重要】「割引」「値引」「クーポン」「Code128」「ポイント」などのマイナス行は、レシートに「-」がついていれば必ずamountを負の整数で返す。例：レシートに「-49」とあれば amount: -49

【内税/外税の判定（tax_type）：最重要項目】
- レシート全体が「内税（税込表示）」か「外税（税抜表示）」かを必ず判定して tax_type に "内税" または "外税" で返す。
- 判定手順（上から優先）：
  1. 「外税」「税抜」「(税抜)」「本体価格」「税別」の表記が品目や小計にある → 「外税」
  2. 「小計」→「消費税」→「合計」の順で税が加算される構造（小計＋消費税＝合計）→ 「外税」
  3. 「内消費税」「内税」「税込」「(内 消費税等 ¥X)」の表記がある → 「内税」
  4. 検算で確定する：品目金額の合計＝支払合計なら「内税」、品目金額の合計＋消費税額＝支払合計なら「外税」
  5. どうしても判定できない場合のみ「内税」（日本の小売レシートは総額表示が原則）
- 判定したtax_typeと矛盾しないようにamountを読むこと。外税レシートで品目の税込換算をしてはいけない。

【税率別対象額（taxable_10 / taxable_8）：会計取込の確定値】
- レシート下部に印字される「10%対象 ¥X」「8%対象 ¥Y」「10%対象計」「軽減税率対象」などの税率ごとの対象額を、印字された数値のまま読み取る。
  ・これはレシート自体が計算した確定値であり、品目の判定より信頼できる。必ず探して読み取る。
  ・内税レシートでは税込対象額、外税レシートでは税抜対象額が印字されるが、どちらの場合も印字どおりの数値を返す。
  ・「対象」「対象計」「対象額」「税率」などの語の近くを重点的に探す。
  ・片方の税率しかないレシートでは、もう片方はnull。
  ・対象額の印字が無いレシート（手書き領収書・簡易レシート等）はnull。自分で計算しない。
- 検算：内税レシートなら taxable_10 + taxable_8 ≒ total、外税なら taxable_10 + taxable_8 + 消費税 ≒ total になるはず。合わない場合は読み直す。
- tax_category（品目の税区分）は次の4区分のいずれかで判定する：「10%標準」「8%軽減」「非課税」「不課税」
  ・まず内容で判定する（マークより内容を優先）：
    - 自賠責保険料・各種保険料 → 「非課税」
    - 収入印紙・行政手数料（戸籍・住民票・印鑑証明・納税証明など官公署の証明発行手数料）→ 「非課税」
    - 重量税・自動車税・軽自動車税・印紙税などの税金 → 「不課税」
    - 新聞の定期購読料 → 「8%軽減」
  ・上記に当てはまらない場合はマークで判定：「※」「★」「軽」「#」マークがあれば「8%軽減」、なければ「10%標準」
  ・品目ごとの税区分の合計が taxable_10 / taxable_8 と一致するように読むこと。一致しない場合はマークを見直す。
- invoice_numberは「T」で始まり数字13桁が続く番号（例：T2010001098023）。レシートの隅・左下・欄外・薄い小さな文字でも必ず探して読み取る。
  ・スーパー・量販店（イトーヨーカドー、西友など）の領収証は、登録番号が「登録番号 T〜」の形で、レシート下部や側面に【縦書き】【90度回転した向き】で薄く印字されていることが非常に多い。画像を回転させてでも、縦書き・横倒しのテキスト領域を必ず確認すること。
  ・「登録番号」「適格」「インボイス」などの語の近くを重点的に探す。
  ・数字が13桁あるか必ず数えて確認する。読めた番号が「T＋13桁」でない場合は、桁を読み直す。
  ・鉄道・交通機関・タクシーのレシートも左下や下部に薄く小さく印字されることが多い。
  ・どうしても読み取れない場合のみnull。
- invoice_statusは、invoice_numberがあれば「適格」、なければ「要確認」
- dateはYYYY-MM-DD形式（令和8年=2026年、令和7年=2025年）
- totalは税込の実際の支払合計金額（「合計」「お会計」欄の金額）
- tax_8 / tax_10：レシートに記載された8%・10%の消費税額。「外税額」「消費税」「内消費税等」どの形式でも印字された金額をそのまま読む。なければnull。自分で計算し直さない。※税額は参考値であり、会計処理は税率別対象額（taxable）と税区分で行うため、対象額の読み取りを優先する
- 端数処理の結果レシート上で「¥0」と印字されている場合は 0 とする（例：税率10%対象額¥3で内消費税等10%が¥0なら tax_10 は 0）
- car_number：自賠責保険・自動車保険の領収証の場合、「自動車登録番号」「車両番号」（例：市川400 さ 62）を読み取る。それ以外のレシートや読み取れない場合は null
- accountは以下のルールで判定する：
  ・店名や品目に「駐車場」「パーキング」「タイムズ」「Times」「TIMES」→「駐車代」
  ・「交通」「タクシー」「Uber」「uber」「メーター運賃」「運賃」「ハイヤー」「TAXI」、または店名が「〇〇交通」「〇〇タクシー」「〇〇ハイヤー」→「タクシー代」
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

【横の領収書＋縦の明細が1枚になっているパターン】
- 1枚の画像の中に「領収書（横長・合計や宛名が書かれた部分）」と「明細（縦長・品目が並んだレシート部分）」が両方写っていることがある。
- この場合は別々のレシートとして分けず、1つのレシートとして統合して読み取る。明細部分から品目（items）を取得し、領収書部分から日付・店名・合計・インボイス番号を補完する。
- 向きが横と縦で混在していても、それぞれの向きを判定して読み取ること。
- 領収書部分と明細部分で合計金額が一致するはずなので、明細の品目合計が領収書の合計と合うように読み取る。

【タクシー・交通費の判定】
- 「メーター運賃」「運賃」「乗車」「ご乗車」「TAXI」「タクシー」「ハイヤー」「交通」などの語、またはタクシー会社・交通事業者名（〇〇交通、〇〇タクシー、〇〇ハイヤー等）が店名・品目にあれば account を「タクシー代」にする。

次のJSON形式のみで返す（説明不要）。必ずreceipts配列の形にする：
{"receipts":[{"store_name":"店名","invoice_number":"T+13桁またはnull","invoice_status":"適格または要確認","date":"YYYY-MM-DD","car_number":"自動車登録番号またはnull","tax_type":"内税または外税","items":[{"name":"印字文字そのまま","amount":数値(値引きは必ず負の数),"tax_category":"10%標準または8%軽減または非課税または不課税","account":"駐車代/タクシー代/飲料代/飲食代/消耗品/自賠責保険代/雑費のいずれか"}],"taxable_8":数値またはnull,"taxable_10":数値またはnull,"tax_8":数値またはnull,"tax_10":数値またはnull,"total":数値}]}` }
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

      // ── 内税/外税のサーバー側検算 ─────────────────────────────
      // OCRのtax_type判定を、品目合計と支払合計の関係で確認・補正する。
      // 品目合計＝total → 内税 / 品目合計＋税＝total → 外税。
      // どちらにも一致しない場合はOCRの判定をそのまま尊重する。
      const itemSum = (rcpt.items || []).reduce((s2, it) => s2 + (Number(it.amount) || 0), 0);
      const totalNum = Number(rcpt.total) || 0;
      const taxSum = (Number(rcpt.tax_8) || 0) + (Number(rcpt.tax_10) || 0);
      if (totalNum > 0 && itemSum > 0) {
        if (itemSum === totalNum) {
          rcpt.tax_type = '内税';
        } else if (taxSum > 0 && itemSum + taxSum === totalNum) {
          rcpt.tax_type = '外税';
        }
      }
      if (rcpt.tax_type !== '内税' && rcpt.tax_type !== '外税') rcpt.tax_type = '内税';

      // 税率別対象額の数値化（不正値はnullに落とす）
      rcpt.taxable_8 = (rcpt.taxable_8 == null || isNaN(Number(rcpt.taxable_8))) ? null : Number(rcpt.taxable_8);
      rcpt.taxable_10 = (rcpt.taxable_10 == null || isNaN(Number(rcpt.taxable_10))) ? null : Number(rcpt.taxable_10);

      return rcpt;
    });

    const first = receipts[0] || {};
    return res.status(200).json({ ...first, receipts });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
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
