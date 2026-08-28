/**
 * 💝心星⭐️機場接送｜簡易預約後端
 * 客戶填單確認摘要 → 存檔 → 推播 LINE 給官方人工報價
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));



// ===== Google 試算表寫入（不會因重新部署而消失）=====
let sheetsClient = null;
let sheetsClientError = null;

function parseServiceAccountJson() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  raw = String(raw).trim();
  try {
    if (raw.charAt(0) !== '{') {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    }
    return JSON.parse(raw);
  } catch (e) {
    sheetsClientError = 'JSON 解析失敗: ' + e.message;
    console.error(sheetsClientError);
    return null;
  }
}

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  try {
    const { google } = require('googleapis');
    const creds = parseServiceAccountJson();
    if (!creds) return null;
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    sheetsClientError = null;
    return sheetsClient;
  } catch (e) {
    sheetsClientError = e.message;
    console.error('Google 客戶端失敗', e.message);
    return null;
  }
}

async function appendBookingToSheet(booking) {
  const sheetId = (process.env.GOOGLE_SHEET_ID || '').trim();
  const sheets = getSheetsClient();
  if (!sheetId || !sheets) {
    console.log('略過試算表:', !sheetId ? '無 GOOGLE_SHEET_ID' : (sheetsClientError || '無憑證'));
    return { ok: false, error: sheetsClientError || 'missing config' };
  }
  const row = [
    booking.createdAt || '',
    booking.orderId || '',
    booking.name || '',
    booking.phone || '',
    booking.lineId || '',
    booking.serviceType || '',
    booking.date || '',
    booking.pickupTime || '',
    booking.fromAddress || '',
    booking.toAddress || '',
    String(booking.passengers != null ? booking.passengers : ''),
    booking.notes || '',
    String(booking.visitCount != null ? booking.visitCount : '')
  ];
  const ranges = ['工作表1!A:M', 'Sheet1!A:M', 'A:M'];
  let lastErr = null;
  for (let i = 0; i < ranges.length; i++) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: ranges[i],
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] }
      });
      console.log('已寫入 Google 試算表', ranges[i], booking.orderId);
      return { ok: true };
    } catch (e) {
      lastErr = e.message;
    }
  }
  console.error('寫入試算表失敗', lastErr);
  return { ok: false, error: lastErr };
}

const CUSTOMERS_PATH = path.join(__dirname, 'customers.json');





function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function loadCustomers() {
  try {
    if (fs.existsSync(CUSTOMERS_PATH)) {
      return JSON.parse(fs.readFileSync(CUSTOMERS_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveCustomers(data) {
  fs.writeFileSync(CUSTOMERS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/** 以電話為主鍵；若無電話則用 LINE ID；再不行用姓名 */
function upsertCustomer(booking) {
  const customers = loadCustomers();
  const phone = normalizePhone(booking.phone);
  const lineId = String(booking.lineId || '').trim();
  const name = String(booking.name || '').trim();

  let key = '';
  if (phone.length >= 8) key = 'p:' + phone;
  else if (lineId) key = 'l:' + lineId.toLowerCase();
  else if (name) key = 'n:' + name;
  else key = 'u:' + booking.orderId;

  // 嘗試合併：同電話或同 LINE 已存在
  if (!customers[key]) {
    const found = Object.keys(customers).find(function(k) {
      const c = customers[k];
      if (phone && c.phone && c.phone === phone) return true;
      if (lineId && c.lineId && c.lineId.toLowerCase() === lineId.toLowerCase()) return true;
      return false;
    });
    if (found) key = found;
  }

  const now = booking.createdAt || new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  if (!customers[key]) {
    customers[key] = {
      key: key,
      name: name,
      phone: phone,
      lineId: lineId,
      bookingCount: 1,
      firstBookingAt: now,
      lastBookingAt: now,
      lastOrderId: booking.orderId,
      names: name ? [name] : [],
      lineIds: lineId ? [lineId] : []
    };
  } else {
    const c = customers[key];
    c.bookingCount = (c.bookingCount || 0) + 1;
    c.lastBookingAt = now;
    c.lastOrderId = booking.orderId;
    if (name) c.name = name;
    if (phone) c.phone = phone;
    if (lineId) c.lineId = lineId;
    if (name && c.names && c.names.indexOf(name) < 0) c.names.push(name);
    if (lineId && c.lineIds && c.lineIds.indexOf(lineId) < 0) c.lineIds.push(lineId);
  }

  saveCustomers(customers);
  return customers[key];
}


function saveToCSV(booking) {
  const header = '訂單編號,建立時間,姓名,電話,LINE ID,服務類型,出發點,出發補充,停靠點1,停靠1補充,停靠點2,停靠2補充,目的地,目的補充,航廈,航班編號,日期,航班起飛時間,出發時間,人數,行李件數,行李尺寸,車型,安全座椅,舉牌接機,過年期間,備註,狀態\n';
  const row = [
    booking.orderId,
    '"' + booking.createdAt + '"',
    '"' + booking.name + '"',
    booking.phone,
    '"' + (booking.lineId || '') + '"',
    booking.serviceType,
    '"' + booking.fromAddress + '"',
    '"' + (booking.fromAddressNote || '') + '"',
    '"' + (booking.stop1 || '') + '"',
    '"' + (booking.stop1Note || '') + '"',
    '"' + (booking.stop2 || '') + '"',
    '"' + (booking.stop2Note || '') + '"',
    '"' + booking.toAddress + '"',
    '"' + (booking.toAddressNote || '') + '"',
    '"' + (booking.terminal || '') + '"',
    '"' + (booking.flightNo || '') + '"',
    booking.date,
    '"' + (booking.flightTime || '') + '"',
    '"' + (booking.pickupTime || '') + '"',
    booking.passengers,
    booking.luggage,
    '"' + (booking.luggageSizes || '') + '"',
    '"' + (booking.vehicle || '') + '"',
    '"' + (booking.seats || '') + '"',
    booking.signboard ? '是' : '否',
    booking.cny ? '是' : '否',
    '"' + (booking.notes || '').replace(/"/g, '""') + '"',
    '待報價'
  ].join(',') + '\n';

  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, '\uFEFF' + header + row, 'utf8');
  } else {
    fs.appendFileSync(CSV_PATH, row, 'utf8');
  }
}

function notifyLine(booking) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const adminId = process.env.LINE_ADMIN_USER_ID;
  if (!token || !adminId) {
    console.log('LINE 未設定，略過推播（訂單已存入 bookings.csv）');
    return;
  }

  let text = '🚗 新預約需求（待人工報價）\n';
  text += '訂單：' + booking.orderId + '\n';
  text += '時間：' + booking.createdAt + '\n';
  text += '────────\n';
  text += '姓名：' + booking.name + '\n';
  text += '電話：' + booking.phone + '\n';
  if (booking.visitCount) text += '預約次數：第 ' + booking.visitCount + ' 次' + (booking.visitCount > 1 ? '（回流客）' : '') + '\n';
  text += 'LINE：' + (booking.lineId || '無') + '\n';
  text += '服務：' + booking.serviceType + '\n';
  text += '日期：' + booking.date + (booking.cny ? '（過年期間）' : '') + '\n';
  text += '出發時間：' + (booking.pickupTime || '') + '\n';
  text += '起飛時間：' + (booking.flightTime || '無') + '\n';
  text += '出發：' + booking.fromAddress;
  if (booking.fromAddressNote) text += '（' + booking.fromAddressNote + '）';
  text += '\n';
  if (booking.stop1) text += '停靠1：' + booking.stop1 + (booking.stop1Note ? '（' + booking.stop1Note + '）' : '') + '\n';
  if (booking.stop2) text += '停靠2：' + booking.stop2 + (booking.stop2Note ? '（' + booking.stop2Note + '）' : '') + '\n';
  text += '目的地：' + booking.toAddress;
  if (booking.toAddressNote) text += '（' + booking.toAddressNote + '）';
  text += '\n';
  text += '航廈：' + (booking.terminal || '無') + '\n';
  text += '航班：' + (booking.flightNo || '無') + '\n';
  text += '人數：' + booking.passengers + '\n';
  text += '行李：' + booking.luggage + ' 件（' + (booking.luggageSizes || '') + '）\n';
  text += '車型：' + (booking.vehicle || '') + '\n';
  text += '座椅：' + (booking.seats || '無') + '\n';
  text += '舉牌：' + (booking.signboard ? '需要' : '不需要') + '\n';
  text += '備註：' + (booking.notes || '無') + '\n';
  text += '────────\n請盡快回報價給客人！';

  // LINE 文字上限約 5000，必要時可截斷
  if (text.length > 4800) text = text.slice(0, 4800) + '…';

  const body = JSON.stringify({
    to: adminId,
    messages: [{ type: 'text', text: text }]
  });

  const req = https.request({
    hostname: 'api.line.me',
    path: '/v2/bot/message/push',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'Content-Length': Buffer.byteLength(body)
    }
  }, function(res) {
    let data = '';
    res.on('data', function(c) { data += c; });
    res.on('end', function() {
      if (res.statusCode >= 400) console.error('LINE push failed', res.statusCode, data);
      else console.log('LINE 通知已送出');
    });
  });
  req.on('error', function(e) { console.error('LINE error', e.message); });
  req.write(body);
  req.end();
}

app.post('/api/booking', async function(req, res) {
  try {
    const data = req.body;
    if (!data.name || !data.phone || !data.fromAddress || !data.toAddress || !data.date || !data.pickupTime) {
      return res.status(400).json({ error: '請填寫必要欄位' });
    }

    const orderId = 'AT' + Date.now().toString().slice(-8);
    const booking = {
      orderId: orderId,
      createdAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      name: data.name,
      phone: data.phone,
      lineId: data.lineId || '',
      serviceType: data.serviceType,
      fromAddress: data.fromAddress,
      fromAddressNote: data.fromAddressNote || '',
      stop1: data.stop1 || '',
      stop1Note: data.stop1Note || '',
      stop2: data.stop2 || '',
      stop2Note: data.stop2Note || '',
      toAddress: data.toAddress,
      toAddressNote: data.toAddressNote || '',
      terminal: data.terminal || '',
      flightNo: data.flightNo || '',
      date: data.date,
      flightTime: data.flightTime || '',
      pickupTime: data.pickupTime,
      passengers: data.passengers,
      luggage: data.luggage,
      luggageSizes: data.luggageSizes || '',
      vehicle: data.vehicle || '',
      seats: data.seats || '',
      signboard: !!data.signboard,
      cny: !!data.cny,
      notes: data.notes || ''
    };

    saveToCSV(booking);
    const customer = upsertCustomer(booking);
    booking.visitCount = customer.bookingCount;
    notifyLine(booking);
    let sheetResult = { ok: false };
    try {
      sheetResult = await appendBookingToSheet(booking);
    } catch (e) {
      sheetResult = { ok: false, error: e.message };
      console.error('sheet append', e.message);
    }

    res.json({
      success: true,
      orderId: orderId,
      visitCount: customer.bookingCount,
      isReturning: customer.bookingCount > 1,
      sheetOk: !!(sheetResult && sheetResult.ok),
      sheetError: sheetResult && sheetResult.error ? String(sheetResult.error).slice(0, 200) : undefined,
      message: '已送出，專人將盡快報價'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '系統錯誤，請稍後再試' });
  }
});


// 今日星座運勢（轉址科技紫微網 daily_N.php）
const SIGN_NAMES = ['牡羊座','金牛座','雙子座','巨蟹座','獅子座','處女座','天秤座','天蠍座','射手座','魔羯座','水瓶座','雙魚座'];

app.get('/api/horoscope', function(req, res) {
  let i = parseInt(req.query.i, 10);
  if (isNaN(i) || i < 0 || i > 11) {
    return res.status(400).json({ ok: false, error: 'invalid sign' });
  }
  const url = 'https://astro.click108.com.tw/daily_' + i + '.php?iAstro=' + i;
  const lib = url.startsWith('https') ? https : require('http');
  const request = lib.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; XingXingTransfer/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-TW,zh;q=0.9'
    },
    timeout: 8000
  }, function(r) {
    let raw = '';
    r.setEncoding('utf8');
    r.on('data', function(c) { raw += c; if (raw.length > 500000) r.destroy(); });
    r.on('end', function() {
      try {
        let text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ');

        let summary = '';
        // 抓「整體運勢」一段
        const m1 = text.match(/整體運勢[★☆\*]{0,10}[：:]\s*([^。]{10,120}。)/);
        if (m1) summary = m1[0].trim();
        if (!summary) {
          const m2 = text.match(/今日[^。]{0,8}解析[^。]{0,20}整體運勢[★☆]{0,10}[：:]?\s*([^。]{15,150}。)/);
          if (m2) summary = m2[0].replace(/\s+/g, ' ').trim().slice(0, 200);
        }
        if (!summary) {
          const m3 = text.match(/整體運勢[\s\S]{0,30}?([★☆]{1,5})[：:]?\s*([^★]{20,160})/);
          if (m3) summary = ('整體運勢' + m3[1] + '：' + m3[2]).replace(/\s+/g, ' ').trim().slice(0, 200);
        }
        if (!summary) {
          summary = '';
        }
        res.json({
          ok: !!summary,
          sign: SIGN_NAMES[i],
          i: i,
          summary: summary || null,
          source: url
        });
      } catch (e) {
        res.json({ ok: false, error: 'parse', source: url });
      }
    });
  });
  request.on('error', function() {
    res.json({ ok: false, error: 'fetch' });
  });
  request.on('timeout', function() {
    request.destroy();
    res.json({ ok: false, error: 'timeout' });
  });
});



// 後台：客戶預約次數（發放優惠依據）








const VIEWS_PATH = path.join(__dirname, 'views.json');

function loadViews() {
  try {
    if (fs.existsSync(VIEWS_PATH)) {
      return JSON.parse(fs.readFileSync(VIEWS_PATH, 'utf8'));
    }
  } catch (e) {}
  return { total: 0 };
}

function bumpView() {
  const data = loadViews();
  data.total = (data.total || 0) + 1;
  data.updatedAt = new Date().toISOString();
  try {
    fs.writeFileSync(VIEWS_PATH, JSON.stringify(data), 'utf8');
  } catch (e) {}
  return data.total;
}

app.get('/api/views', function(req, res) {
  // 僅計數，不記 IP 細節（簡易到站次數）
  const total = bumpView();
  res.json({ ok: true, total: total });
});

app.get('/api/views/count', function(req, res) {
  const data = loadViews();
  res.json({ ok: true, total: data.total || 0 });
});

app.get('/api/sheet-status', function(req, res) {
  const hasId = !!(process.env.GOOGLE_SHEET_ID || '').trim();
  const hasJson = !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  let clientOk = false;
  let err = sheetsClientError || null;
  try {
    clientOk = !!getSheetsClient();
  } catch (e) {
    err = e.message;
  }
  res.json({
    ok: hasId && hasJson && clientOk,
    hasSheetId: hasId,
    hasServiceJson: hasJson,
    clientOk: clientOk,
    error: err
  });
});

const REVIEWS_FILE = path.join(__dirname, 'data-reviews.json');

function loadReviews() {
  try {
    if (!fs.existsSync(REVIEWS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function saveReviews(list) {
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

app.get('/api/reviews', function(req, res) {
  const list = loadReviews()
    .filter(function(r) { return r && r.published !== false; })
    .slice(-80)
    .reverse();
  res.json({ ok: true, reviews: list });
});

app.post('/api/reviews', function(req, res) {
  const body = req.body || {};
  if (body.website) return res.status(200).json({ ok: true }); // honeypot
  const name = String(body.name || '').trim().slice(0, 20);
  const area = String(body.area || '').trim().slice(0, 20);
  const trip = String(body.trip || '').trim().slice(0, 30);
  const comment = String(body.comment || '').trim().slice(0, 300);
  const stars = Math.max(1, Math.min(5, parseInt(body.stars, 10) || 5));
  if (!comment || comment.length < 8) {
    return res.status(400).json({ ok: false, error: '請至少寫 8 個字' });
  }
  const item = {
    id: Date.now().toString(36),
    name: name || '匿名客人',
    area: area || '未填地區',
    trip: trip || '機場接送',
    stars: stars,
    comment: comment,
    createdAt: new Date().toISOString(),
    published: true
  };
  const list = loadReviews();
  list.push(item);
  try {
    saveReviews(list);
    res.json({ ok: true, review: item });
  } catch (e) {
    res.status(500).json({ ok: false, error: '暫時無法儲存，請改用 LINE 留言' });
  }
});

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, function() {
  console.log('Server running at http://localhost:' + PORT);
});
