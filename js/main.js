// 엔트리 — 게임 생성 및 초기화
import { Game } from './core/Game.js';

const app = document.getElementById('app');
const game = new Game(app);
game.init().catch((err) => {
  console.error(err);
  const box = document.getElementById('error-box');
  box.textContent = '초기화 실패: ' + (err && err.message ? err.message : err);
  box.classList.remove('hidden');
});
