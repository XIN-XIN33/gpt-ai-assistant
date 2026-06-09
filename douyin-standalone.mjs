#!/usr/bin/env node
/**
 * 抖音內容擷取 — 單檔、零依賴版本（只用 Node 18+ 內建 fetch）。
 *
 * 用法：
 *   node douyin-standalone.mjs "https://www.douyin.com/video/7649045105239690506"
 *   node douyin-standalone.mjs --json "https://v.douyin.com/xxxxxx/"
 *
 * 被反爬蟲擋下時帶上瀏覽器 cookie：
 *   DOUYIN_COOKIE="ttwid=...; msToken=..." node douyin-standalone.mjs "<url>"
 */

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)'
  + ' AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';

const baseHeaders = {
  'User-Agent': MOBILE_UA,
  Referer: 'https://www.douyin.com/',
};

// 從首頁要一組 guest cookie（不需登入），降低 403 機率。
async function fetchGuestCookie() {
  try {
    const res = await fetch('https://www.douyin.com/', { headers: baseHeaders });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  } catch {
    return '';
  }
}

// 從各種連結形式解析 aweme_id（短連結會自動追蹤轉址）。
async function resolveAwemeId(url) {
  const direct = url.match(/(?:video|note)\/(\d+)/) || url.match(/modal_id=(\d+)/);
  if (direct) return direct[1];

  const short = url.match(/https?:\/\/v\.douyin\.com\/[\w-]+/);
  if (short) {
    const res = await fetch(short[0], { headers: baseHeaders, redirect: 'follow' });
    const matched = res.url.match(/(?:video|note)\/(\d+)/) || res.url.match(/modal_id=(\d+)/);
    if (matched) return matched[1];
  }
  throw new Error(`無法從 URL 解析 aweme_id：${url}`);
}

// 取出 window._ROUTER_DATA 並挖出影片物件。
function parseRouterData(html) {
  const matched = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!matched) throw new Error('分享頁中找不到 _ROUTER_DATA（被反爬蟲擋下或需要 cookie）');

  const data = JSON.parse(matched[1]);
  const loaderData = data.loaderData || {};
  const key = Object.keys(loaderData).find((k) => loaderData[k] && loaderData[k].videoInfoRes);
  const item = key && loaderData[key].videoInfoRes
    && loaderData[key].videoInfoRes.item_list
    && loaderData[key].videoInfoRes.item_list[0];
  if (!item) throw new Error('解析到 _ROUTER_DATA 但其中沒有影片資料');
  return item;
}

function normalize(item) {
  const stats = item.statistics || {};
  const video = item.video || {};
  const author = item.author || {};
  const playAddr = (video.play_addr && video.play_addr.url_list) || [];
  return {
    awemeId: item.aweme_id,
    title: item.desc || '',
    author: { nickname: author.nickname || '', signature: author.signature || '' },
    createTime: item.create_time ? new Date(item.create_time * 1000).toISOString() : null,
    duration: video.duration ? Math.round(video.duration / 1000) : null,
    cover: (video.cover && video.cover.url_list && video.cover.url_list[0]) || null,
    videoUrls: playAddr.map((u) => u.replace('playwm', 'play')),
    images: (item.images || []).map((img) => img.url_list && img.url_list[0]).filter(Boolean),
    statistics: {
      likes: stats.digg_count,
      comments: stats.comment_count,
      shares: stats.share_count,
      collects: stats.collect_count,
      plays: stats.play_count,
    },
  };
}

async function extract(url) {
  const awemeId = await resolveAwemeId(url);
  const cookie = process.env.DOUYIN_COOKIE || await fetchGuestCookie();
  const res = await fetch(`https://www.iesdouyin.com/share/video/${awemeId}/`, {
    headers: { ...baseHeaders, ...(cookie ? { Cookie: cookie } : {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}（可能需要帶 DOUYIN_COOKIE）`);
  return normalize(parseRouterData(await res.text()));
}

// ---- CLI ----
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const url = args.find((a) => a.startsWith('http'));

if (!url) {
  console.error('用法：node douyin-standalone.mjs "https://www.douyin.com/video/7649045105239690506"');
  process.exit(1);
}

try {
  const data = await extract(url);
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log('─'.repeat(48));
    console.log(`標題  ：${data.title || '(無)'}`);
    console.log(`作者  ：${data.author.nickname}`);
    console.log(`時長  ：${data.duration != null ? `${data.duration} 秒` : '(圖文貼文)'}`);
    console.log(`發布  ：${data.createTime || '(未知)'}`);
    console.log(`讚    ：${data.statistics.likes ?? '?'}　留言：${data.statistics.comments ?? '?'}　分享：${data.statistics.shares ?? '?'}`);
    if (data.videoUrls.length) console.log(`影片  ：${data.videoUrls[0]}`);
    if (data.images.length) {
      console.log(`圖片  ：共 ${data.images.length} 張`);
      data.images.forEach((u, i) => console.log(`  [${i + 1}] ${u}`));
    }
    console.log('─'.repeat(48));
  }
} catch (err) {
  console.error('擷取失敗：', err.message);
  console.error('若是 403 / 找不到 _ROUTER_DATA，帶上瀏覽器 cookie 再試：');
  console.error('  DOUYIN_COOKIE="ttwid=...; msToken=..." node douyin-standalone.mjs "<url>"');
  process.exit(1);
}
