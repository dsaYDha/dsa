// 입력 — 키보드(event.code), 마우스, 포인터 락
import { CONFIG } from '../config.js';

export class Input {
  constructor(element) {
    this.element = element;
    this.down = new Set();
    this.pressed = new Set(); // 이번 프레임에 새로 눌린 키
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.captureKeys = false; // 게임 진행 중일 때만 기본 동작 차단
    this.onLockChange = null; // (locked) => void
    this.onKey = null; // (code) => void — 메뉴 등에서 사용
    this.forceUnlocked = false; // 테스트/디버그: 포인터 락 없이 입력 받기
    this._lastUnlockTime = 0;

    // 액션 → 키 코드 역참조
    this.actionOf = new Map();
    this.rebuildBindings();
    this.captureNext = null; // 5단계 키 설정: 다음 키 입력을 이 콜백으로 넘김 (게임 입력으로 쓰지 않음)

    this._bind();
  }

  /** 키 설정이 바뀌면 다시 만든다 (기본 동작 차단 대상) */
  rebuildBindings() {
    this.actionOf.clear();
    for (const [action, codes] of Object.entries(CONFIG.keys)) {
      for (const c of codes) this.actionOf.set(c, action);
    }
  }

  _isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (this.captureNext) {
        e.preventDefault();
        const fn = this.captureNext;
        this.captureNext = null;
        fn(e.code);
        return;
      }
      if (this._isTyping(e)) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (this.captureKeys && (this.actionOf.has(e.code) || e.code === 'Tab')) e.preventDefault();
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.clear());

    this.element.addEventListener('mousedown', (e) => {
      if (e.button <= 2) {
        if (!this.mouseDown[e.button]) this.mousePressed[e.button] = true;
        this.mouseDown[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.mouseDown[e.button] = false;
    });
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.forceUnlocked) return;
      let mx = e.movementX || 0;
      let my = e.movementY || 0;
      // 일부 브라우저의 비정상적인 순간 값 튐 방지
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      this.dx += mx;
      this.dy += my;
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this._lastUnlockTime = performance.now();
        this.clear();
      }
      if (was !== this.locked && this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // 락 실패 — 일시정지 화면에서 다시 클릭하도록 둠
      if (this.onLockChange) this.onLockChange(false, true);
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.element.requestPointerLock();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (this.onLockChange) this.onLockChange(false, true);
        });
      }
    } catch {
      if (this.onLockChange) this.onLockChange(false, true);
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // 포인터 락 해제 직후엔 브라우저가 재요청을 거부하므로 대기 시간 확인
  canRelock() {
    return performance.now() - this._lastUnlockTime > 1100;
  }

  isAction(action) {
    const codes = CONFIG.keys[action];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  wasAction(action) {
    const codes = CONFIG.keys[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  isFire() { return this.mouseDown[CONFIG.mouse.fire]; }
  wasFire() { return this.mousePressed[CONFIG.mouse.fire]; }
  isAim() { return this.mouseDown[CONFIG.mouse.aim]; }

  consumeMouse() {
    const r = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed[0] = this.mousePressed[1] = this.mousePressed[2] = false;
  }

  clear() {
    this.down.clear();
    this.pressed.clear();
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.dx = this.dy = 0;
  }
}
