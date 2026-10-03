// 엔트리 — 게임 생성 및 초기화
import { Game } from './core/Game.js';

const app = document.getElementById('app');

// 5단계: 터치 전용 기기(휴대폰·태블릿)면 안내 — 키보드·마우스(포인터 고정)가 필요한 게임
const mm = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
const touchOnly = (window.navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && mm('(pointer: coarse)') && !mm('(any-pointer: fine)');
if (touchOnly) {
  const box = document.getElementById('touch-notice');
  box.classList.remove('hidden');
  document.getElementById('btn-touch-continue').addEventListener('click', () => box.classList.add('hidden'));
}

const game = new Game(app);
game.init().catch((err) => {
  console.error(err);
  const box = document.getElementById('error-box');
  box.textContent = '초기화 실패: ' + (err && err.message ? err.message : err);
  box.classList.remove('hidden');
});
