#!/usr/bin/env node
/**
 * 本機用的抖音內容擷取 CLI（不依賴雲端、不需 yt-dlp）。
 *
 * 用法：
 *   node extract-douyin.js "https://www.douyin.com/video/7649045105239690506"
 *   node extract-douyin.js --json "https://v.douyin.com/xxxxxx/"
 *
 * 若被反爬蟲擋下（403 / 找不到 _ROUTER_DATA），可帶上你瀏覽器的 cookie：
 *   DOUYIN_COOKIE="ttwid=...; msToken=..." node extract-douyin.js "<url>"
 */
import { extract } from './services/douyin.js';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const url = args.find((a) => a.startsWith('http'));

if (!url) {
  console.error('請提供抖音連結，例如：');
  console.error('  node extract-douyin.js "https://www.douyin.com/video/7649045105239690506"');
  process.exit(1);
}

const run = async () => {
  try {
    const data = await extract(url);

    if (asJson) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log('─'.repeat(48));
    console.log(`標題  ：${data.title || '(無)'}`);
    console.log(`作者  ：${data.author.nickname}`);
    console.log(`時長  ：${data.duration != null ? `${data.duration} 秒` : '(圖文貼文)'}`);
    console.log(`發布  ：${data.createTime || '(未知)'}`);
    console.log(`讚    ：${data.statistics.likes ?? '?'}`);
    console.log(`留言  ：${data.statistics.comments ?? '?'}`);
    console.log(`分享  ：${data.statistics.shares ?? '?'}`);
    if (data.videoUrls.length) {
      console.log(`影片  ：${data.videoUrls[0]}`);
    }
    if (data.images.length) {
      console.log(`圖片  ：共 ${data.images.length} 張`);
      data.images.forEach((u, i) => console.log(`  [${i + 1}] ${u}`));
    }
    console.log('─'.repeat(48));
  } catch (err) {
    console.error('擷取失敗：', err.message);
    console.error('\n若是 403 或找不到 _ROUTER_DATA，請帶上瀏覽器 cookie 再試：');
    console.error('  DOUYIN_COOKIE="ttwid=...; msToken=..." node extract-douyin.js "<url>"');
    process.exit(1);
  }
};

run();
