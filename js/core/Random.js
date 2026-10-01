// 시드 기반 난수 — 같은 시드면 항상 같은 맵이 생성된다
export function hashString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed = 1) {
    this.state = (typeof seed === 'number' ? seed >>> 0 : hashString(seed)) || 0x9e3779b9;
  }

  // mulberry32
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  // { key: weight } 객체에서 가중치 랜덤 선택
  weighted(map) {
    let total = 0;
    for (const k in map) total += Math.max(0, map[k]);
    if (total <= 0) return Object.keys(map)[0];
    let r = this.next() * total;
    for (const k in map) {
      r -= Math.max(0, map[k]);
      if (r <= 0) return k;
    }
    return Object.keys(map)[0];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 정규분포 근사
  gauss() { return (this.next() + this.next() + this.next() - 1.5) / 1.5; }

  // 하위 생성기 분기 (분기 이름이 같으면 결과도 같음)
  fork(label) { return new RNG(hashString(label + ':' + this.state)); }
}

// 게임플레이(비결정) 난수 — 맵과 무관한 진행용
export const gameRand = new RNG((Math.random() * 4294967296) >>> 0);
