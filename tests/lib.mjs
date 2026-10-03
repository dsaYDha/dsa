// 자동 테스트 공용 — 정적 서버(저장소 루트) + 헤드리스 Chromium(Playwright)
// 필요: Node 18+, `npm i -D playwright` (또는 PLAYWRIGHT_PATH=설치된 playwright 의 index.mjs) + 브라우저 (`npx playwright install chromium`)
// 오프라인/CDN 차단 환경: THREE_DIR=/경로/three@0.170.0 (package 루트 — build/·examples/ 포함) 를 주면 CDN 요청을 그 사본으로 돌린다.
// 화면 캡처는 tests/out/ 에 저장
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// PLAYWRIGHT_PATH: 다른 곳에 설치된 playwright 모듈 경로 (없으면 일반 import)
const pw = await import(process.env.PLAYWRIGHT_PATH ? pathToFileURL(process.env.PLAYWRIGHT_PATH).href : 'playwright');
const { chromium } = pw.default && pw.default.chromium ? pw.default : pw;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'tests', 'out');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

/** 저장소 루트를 서비스하는 정적 서버 (빈 포트) */
export function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * 게임 페이지 열기
 * @param {string} query 예: '?nolock&gfx=low'
 * @param {object} o { viewport, touch, gc }
 */
export async function openGame(query = '?nolock&gfx=low', o = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve();
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'];
  if (o.gc) args.push('--js-flags=--expose-gc');
  const browser = await chromium.launch({ args });
  const context = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 720 }, hasTouch: !!o.touch, isMobile: !!o.touch });
  const page = await context.newPage();
  const THREE_DIR = process.env.THREE_DIR;
  if (THREE_DIR) {
    await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', (route) => {
      const p = route.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0', THREE_DIR);
      route.fulfill({ body: fs.readFileSync(p), contentType: 'text/javascript' });
    });
  }
  if (process.env.NO_FONTS || THREE_DIR) {
    // 글꼴 CDN 도 막힌 환경이면 빈 응답 (시스템 글꼴로 대체)
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ body: '', contentType: 'font/woff2' }));
  }
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/${query}`);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 180000 });
  const close = async () => {
    await browser.close();
    server.close();
  };
  return { browser, page, errors, close };
}

/** 페이지 안에서 시뮬레이션 진행 (렌더 없이) */
export const STEP = `(sec, dt = 1 / 30) => {
  const g = window.__game;
  for (let t = 0; t < sec; t += dt) {
    if (g.state === 'playing') g._updatePlaying(dt);
    else if (g.state === 'dead') g._updateDead(dt);
    g.input.endFrame();
  }
}`;

let failures = 0;
/** 검사 — 실패하면 표시만 하고 계속 (끝에 종료 코드) */
export function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

export function finish(errors) {
  const errs = (errors || []).filter((e) => !/fonts\.(googleapis|gstatic)\.com/.test(e));
  check('콘솔 에러·경고 0건', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
  process.exitCode = failures ? 1 : 0;
}
