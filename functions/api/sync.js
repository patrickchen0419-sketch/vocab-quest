/* Cloudflare Pages Function：跨裝置同步的存放處。

     GET  /api/sync?code=xxxx-xxxx-xxxx   → 取回那組同步碼的存檔
     POST /api/sync   {code, data}        → 寫入（整包覆蓋）

   這是整個專案裡**唯一**會把學習資料送出裝置的地方，所以把取捨寫清楚：

   1) 同步碼就是密碼。沒有帳號、沒有登入 —— 誰拿到碼，誰就能讀寫那一份進度。
      所以碼是 12 位隨機字元（去掉 0O1lI 這種長得像的），由前端產生，不是使用者自己取。
      網站是公開的，碼外流等於進度外流；但裡面是單字熟練度與造句，不是任何憑證。

   2) 這裡只負責「存」和「取」，**合併邏輯放在前端**（store.js 的 mergeRemote）。
      合併規則跟遊戲規則是綁在一起的（box 怎麼比、星數怎麼取），
      放到雲端會變成改一次規則要同時改兩邊，而且舊版前端會拿到新規則的結果。

   3) KV 免費額度每天 1000 次寫入。正常使用一天不到 10 次，
      但這是公開網址，所以格式不對的碼、不像存檔的內容、過大的封包一律擋掉，
      免得被當成免費資料庫。

   需要在 Cloudflare Pages 的設定裡綁一個 KV namespace，變數名稱是 SYNC。 */

const CODE_RE = /^[2-9a-hjkm-np-z]{4}-[2-9a-hjkm-np-z]{4}-[2-9a-hjkm-np-z]{4}$/;
const MAX_BYTES = 4 * 1024 * 1024;      // 全書 6012 字都學完也才幾百 KB，這個上限很寬

/* 允許任何來源：本機版（file:// 開的 index.html、127.0.0.1:8788）也要能同步到同一份，
   否則「電腦上直接開檔案玩」的那一份會永遠是孤島。
   反正這支 API 的門禁是同步碼，不是來源網域。 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, CORS),
});

const noKv = () => json({ ok: false, error: '雲端還沒接上儲存空間（Pages 設定裡的 KV binding 要叫 SYNC）' }, 500);

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  if (!env.SYNC) return noKv();
  const code = new URL(request.url).searchParams.get('code') || '';
  if (!CODE_RE.test(code)) return json({ ok: false, error: '同步碼格式不對' }, 400);
  const row = await env.SYNC.getWithMetadata('save:' + code, { type: 'json' });
  if (!row || !row.value) return json({ ok: false, error: '這組同步碼還沒有資料' }, 404);
  return json({ ok: true, at: (row.metadata && row.metadata.at) || '', data: row.value });
}

export async function onRequestPost({ request, env }) {
  if (!env.SYNC) return noKv();
  let body = null;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: '內容不是 JSON' }, 400); }
  const code = String((body && body.code) || '');
  if (!CODE_RE.test(code)) return json({ ok: false, error: '同步碼格式不對' }, 400);
  const data = body && body.data;
  // 至少長得像存檔才收：擋掉把這裡當成任意鍵值儲存來用
  if (!data || typeof data !== 'object' || !data.profile) return json({ ok: false, error: '這看起來不是存檔' }, 400);
  const text = JSON.stringify(data);
  if (text.length > MAX_BYTES) return json({ ok: false, error: '存檔太大（上限 4MB）' }, 413);
  const at = new Date().toISOString();
  await env.SYNC.put('save:' + code, text, { metadata: { at, bytes: text.length } });
  return json({ ok: true, at });
}
