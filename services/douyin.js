import axios from 'axios';

// 行動版 User-Agent：抖音分享頁對行動裝置 UA 較寬鬆，會直接吐出內嵌 JSON。
export const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)'
  + ' AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';

const instance = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': MOBILE_USER_AGENT,
    'Accept-Encoding': 'gzip, deflate, compress',
    Referer: 'https://www.douyin.com/',
  },
});

/**
 * 向抖音首頁要一組 ttwid cookie（不需登入），後續請求帶上可降低 403 機率。
 * @returns {Promise<string>} 例如 "ttwid=...; "，失敗則回傳空字串。
 */
const fetchGuestCookie = async () => {
  try {
    const res = await instance.get('https://www.douyin.com/', {
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const setCookie = res.headers['set-cookie'] || [];
    return setCookie.map((c) => c.split(';')[0]).join('; ');
  } catch {
    return '';
  }
};

/**
 * 從各種抖音連結形式解析出 aweme_id：
 *   - https://www.douyin.com/video/7649045105239690506
 *   - https://www.douyin.com/note/7649045105239690506
 *   - ...?modal_id=7649045105239690506
 *   - https://v.douyin.com/xxxxxx/（短連結，會自動追蹤轉址）
 * @param {string} url
 * @returns {Promise<string>}
 */
export const resolveAwemeId = async (url) => {
  const direct = url.match(/(?:video|note)\/(\d+)/) || url.match(/modal_id=(\d+)/);
  if (direct) return direct[1];

  const short = url.match(/https?:\/\/v\.douyin\.com\/[\w-]+/);
  if (short) {
    const res = await instance.get(short[0], {
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const location = res.headers.location || '';
    const matched = location.match(/(?:video|note)\/(\d+)/) || location.match(/modal_id=(\d+)/);
    if (matched) return matched[1];
  }

  throw new Error(`無法從 URL 解析 aweme_id：${url}`);
};

/**
 * 從分享頁 HTML 取出 window._ROUTER_DATA 的 JSON 並挖出影片物件。
 * 結構在不同時期略有差異，這裡用較寬鬆的方式逐層尋找 item_list。
 * @param {string} html
 * @returns {object} 抖音原始 aweme item
 */
const parseRouterData = (html) => {
  const matched = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!matched) throw new Error('分享頁中找不到 _ROUTER_DATA（可能被反爬蟲擋下或需要 cookie）');

  const data = JSON.parse(matched[1]);
  const loaderData = data.loaderData || {};
  const pageKey = Object.keys(loaderData).find((k) => loaderData[k] && loaderData[k].videoInfoRes);
  const item = pageKey
    && loaderData[pageKey].videoInfoRes
    && loaderData[pageKey].videoInfoRes.item_list
    && loaderData[pageKey].videoInfoRes.item_list[0];
  if (!item) throw new Error('解析到 _ROUTER_DATA 但其中沒有影片資料');
  return item;
};

/**
 * 把抖音原始 item 整理成乾淨好用的結構。
 * @param {object} item
 * @returns {object}
 */
const normalize = (item) => {
  const stats = item.statistics || {};
  const video = item.video || {};
  const author = item.author || {};
  const playAddr = (video.play_addr && video.play_addr.url_list) || [];
  // 把 playwm（有浮水印）換成 play（無浮水印）的常見技巧
  const noWatermark = playAddr.map((u) => u.replace('playwm', 'play'));

  return {
    awemeId: item.aweme_id,
    title: item.desc || '',
    author: {
      nickname: author.nickname || '',
      uid: author.uid || author.sec_uid || '',
      signature: author.signature || '',
    },
    createTime: item.create_time ? new Date(item.create_time * 1000).toISOString() : null,
    duration: video.duration ? Math.round(video.duration / 1000) : null,
    cover: (video.cover && video.cover.url_list && video.cover.url_list[0]) || null,
    videoUrls: noWatermark,
    // 圖文貼文（非影片）時的圖片清單
    images: (item.images || [])
      .map((img) => img.url_list && img.url_list[0])
      .filter(Boolean),
    statistics: {
      likes: stats.digg_count,
      comments: stats.comment_count,
      shares: stats.share_count,
      collects: stats.collect_count,
      plays: stats.play_count,
    },
  };
};

/**
 * 主要進入點：給一個抖音連結，回傳整理過的內容。
 * @param {string} url 任何形式的抖音連結
 * @returns {Promise<object>}
 */
export const extract = async (url) => {
  const awemeId = await resolveAwemeId(url);
  // 優先使用呼叫端提供的 cookie（例如環境變數 DOUYIN_COOKIE），否則自動取一組 guest cookie。
  const cookie = process.env.DOUYIN_COOKIE || await fetchGuestCookie();

  const res = await instance.get(`https://www.iesdouyin.com/share/video/${awemeId}/`, {
    headers: cookie ? { Cookie: cookie } : {},
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const item = parseRouterData(res.data);
  return normalize(item);
};

export default { extract, resolveAwemeId };
