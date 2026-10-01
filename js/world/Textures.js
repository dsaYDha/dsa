// CanvasTexture 절차 생성 — 외부 이미지 파일 없이 모든 표면 질감을 만든다
import * as THREE from 'three';
import { RNG } from '../core/Random.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function rgb(r, g, b, a = 1) {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

// 픽셀 단위 노이즈를 기존 그림 위에 곱/더하기
function grain(ctx, w, h, rng, amount = 18, mono = true) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    if (mono) {
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    } else {
      d[i] += (rng.next() - 0.5) * amount;
      d[i + 1] += (rng.next() - 0.5) * amount;
      d[i + 2] += (rng.next() - 0.5) * amount;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// 부드러운 얼룩 (때·그을음·습기)
function blotches(ctx, w, h, rng, count, color, rMin, rMax, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    const r = rng.range(rMin, rMax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', alpha * rng.range(0.4, 1)));
    g.addColorStop(1, color.replace('A', 0));
    ctx.fillStyle = g;
    // 타일 반복 시 이음새가 덜 보이게 경계 넘어 래핑
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.restore();
      }
    }
  }
}

function cracks(ctx, w, h, rng, count, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let i = 0; i < count; i++) {
    let x = rng.next() * w;
    let y = rng.next() * h;
    let a = rng.next() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = rng.int(4, 10);
    for (let s = 0; s < segs; s++) {
      a += rng.range(-0.8, 0.8);
      const len = rng.range(4, 18);
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function tex(c, { repeat = true, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------
// 개별 텍스처
// ---------------------------------------------------------------------
function asphalt(rng) {
  const S = 512;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(74, 71, 68);
  x.fillRect(0, 0, S, S);
  grain(x, S, S, rng, 26);
  blotches(x, S, S, rng, 30, 'rgba(20,18,17,A)', 20, 70, 0.45);
  blotches(x, S, S, rng, 14, 'rgba(95,88,80,A)', 10, 40, 0.25);
  // 보수 자국
  for (let i = 0; i < 4; i++) {
    x.fillStyle = rgb(44, 43, 42, 0.7);
    x.fillRect(rng.next() * S, rng.next() * S, rng.range(30, 120), rng.range(20, 60));
  }
  cracks(x, S, S, rng, 26, 'rgba(15,14,13,0.8)', 1.4);
  grain(x, S, S, rng, 10);
  return tex(c);
}

function sidewalk(rng) {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(120, 114, 106);
  x.fillRect(0, 0, S, S);
  const n = 4;
  const step = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = rng.range(-14, 10);
      x.fillStyle = rgb(118 + v, 112 + v, 104 + v);
      x.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
    }
  }
  grain(x, S, S, rng, 22);
  blotches(x, S, S, rng, 10, 'rgba(40,34,30,A)', 10, 40, 0.4);
  cracks(x, S, S, rng, 8, 'rgba(30,28,26,0.7)', 1);
  return tex(c);
}

function dirt(rng) {
  const S = 512;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(82, 72, 62);
  x.fillRect(0, 0, S, S);
  grain(x, S, S, rng, 34, false);
  blotches(x, S, S, rng, 40, 'rgba(50,42,36,A)', 20, 80, 0.5);
  blotches(x, S, S, rng, 25, 'rgba(120,108,95,A)', 10, 40, 0.35);
  // 자갈·파편
  for (let i = 0; i < 900; i++) {
    const v = rng.range(60, 150);
    x.fillStyle = rgb(v, v * 0.95, v * 0.88, rng.range(0.4, 0.9));
    const s = rng.range(1, 4);
    x.fillRect(rng.next() * S, rng.next() * S, s, s);
  }
  return tex(c);
}

function concrete(rng, base = [128, 124, 118]) {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(...base);
  x.fillRect(0, 0, S, S);
  grain(x, S, S, rng, 24);
  blotches(x, S, S, rng, 18, 'rgba(60,55,50,A)', 10, 60, 0.35);
  blotches(x, S, S, rng, 10, 'rgba(170,165,155,A)', 8, 30, 0.2);
  cracks(x, S, S, rng, 5, 'rgba(40,38,35,0.6)', 1);
  return tex(c);
}

function plaster(rng, base) {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(...base);
  x.fillRect(0, 0, S, S);
  grain(x, S, S, rng, 16);
  blotches(x, S, S, rng, 22, 'rgba(70,58,48,A)', 15, 70, 0.3);
  // 흘러내린 때
  for (let i = 0; i < 14; i++) {
    const gx = rng.next() * S;
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(50,42,36,0.28)');
    g.addColorStop(1, 'rgba(50,42,36,0)');
    x.fillStyle = g;
    x.fillRect(gx, 0, rng.range(3, 12), rng.range(40, S));
  }
  cracks(x, S, S, rng, 7, 'rgba(60,50,44,0.55)', 1);
  return tex(c);
}

function brick(rng, base = [112, 72, 58]) {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(92, 86, 78);
  x.fillRect(0, 0, S, S);
  const rows = 16;
  const bh = S / rows;
  const bw = S / 4;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let k = -1; k < 5; k++) {
      const v = rng.range(-22, 18);
      x.fillStyle = rgb(base[0] + v, base[1] + v * 0.6, base[2] + v * 0.5);
      x.fillRect(k * bw + off + 1.5, r * bh + 1.5, bw - 3, bh - 3);
    }
  }
  grain(x, S, S, rng, 20);
  blotches(x, S, S, rng, 16, 'rgba(30,25,22,A)', 15, 60, 0.35);
  return tex(c);
}

function interiorWall(rng) {
  const S = 256;
  const [c, x] = canvas(S, S);
  // 위: 바랜 페인트, 아래: 걸레받이 띠
  x.fillStyle = rgb(150, 142, 120);
  x.fillRect(0, 0, S, S);
  x.fillStyle = rgb(96, 102, 90);
  x.fillRect(0, S * 0.7, S, S * 0.3);
  x.fillStyle = rgb(70, 64, 56);
  x.fillRect(0, S * 0.69, S, 4);
  grain(x, S, S, rng, 18);
  blotches(x, S, S, rng, 26, 'rgba(60,50,40,A)', 12, 60, 0.35);
  // 벗겨진 페인트
  for (let i = 0; i < 18; i++) {
    x.fillStyle = rgb(118, 110, 96, 0.8);
    x.beginPath();
    const cx = rng.next() * S;
    const cy = rng.next() * S * 0.7;
    x.ellipse(cx, cy, rng.range(3, 14), rng.range(2, 9), rng.next() * 3, 0, Math.PI * 2);
    x.fill();
  }
  cracks(x, S, S, rng, 8, 'rgba(50,44,38,0.6)', 1);
  return tex(c);
}

function floorTile(rng) {
  const S = 256;
  const [c, x] = canvas(S, S);
  const n = 8;
  const st = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dark = (i + j) % 2 === 0;
      const v = rng.range(-10, 10);
      x.fillStyle = dark ? rgb(78 + v, 70 + v, 60 + v) : rgb(138 + v, 128 + v, 110 + v);
      x.fillRect(i * st, j * st, st, st);
    }
  }
  grain(x, S, S, rng, 16);
  blotches(x, S, S, rng, 22, 'rgba(40,32,26,A)', 10, 50, 0.45);
  // 먼지·파편
  for (let i = 0; i < 300; i++) {
    const v = rng.range(80, 140);
    x.fillStyle = rgb(v, v, v * 0.95, 0.6);
    x.fillRect(rng.next() * S, rng.next() * S, 2, 2);
  }
  return tex(c);
}

function wood(rng) {
  const S = 256;
  const [c, x] = canvas(S, S);
  const planks = 6;
  const ph = S / planks;
  for (let p = 0; p < planks; p++) {
    const v = rng.range(-18, 14);
    x.fillStyle = rgb(104 + v, 76 + v, 50 + v);
    x.fillRect(0, p * ph, S, ph);
    x.strokeStyle = 'rgba(50,34,22,0.35)';
    for (let l = 0; l < 6; l++) {
      x.beginPath();
      const yy = p * ph + rng.next() * ph;
      x.moveTo(0, yy);
      x.bezierCurveTo(S * 0.3, yy + rng.range(-4, 4), S * 0.6, yy + rng.range(-4, 4), S, yy);
      x.stroke();
    }
    x.fillStyle = 'rgba(30,20,12,0.8)';
    x.fillRect(0, p * ph, S, 2);
  }
  grain(x, S, S, rng, 14);
  return tex(c);
}

function burntMetal(rng) {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(40, 34, 30);
  x.fillRect(0, 0, S, S);
  blotches(x, S, S, rng, 40, 'rgba(120,62,30,A)', 10, 50, 0.55); // 녹
  blotches(x, S, S, rng, 30, 'rgba(10,9,8,A)', 15, 60, 0.7); // 그을음
  blotches(x, S, S, rng, 10, 'rgba(150,140,128,A)', 5, 25, 0.25); // 남은 페인트
  grain(x, S, S, rng, 26, false);
  return tex(c);
}

function sandbag(rng) {
  const S = 128;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(140, 124, 92);
  x.fillRect(0, 0, S, S);
  // 마대 직조
  for (let i = 0; i < S; i += 3) {
    x.fillStyle = 'rgba(80,68,48,0.25)';
    x.fillRect(i, 0, 1, S);
    x.fillRect(0, i, S, 1);
  }
  grain(x, S, S, rng, 22);
  blotches(x, S, S, rng, 10, 'rgba(60,50,36,A)', 8, 30, 0.4);
  return tex(c);
}

function roof(rng) {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(70, 66, 62);
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) {
    const v = rng.range(40, 120);
    x.fillStyle = rgb(v, v * 0.97, v * 0.93, 0.7);
    x.fillRect(rng.next() * S, rng.next() * S, 2, 2);
  }
  blotches(x, S, S, rng, 16, 'rgba(25,22,20,A)', 15, 60, 0.45);
  return tex(c);
}

function rubble(rng) {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = rgb(100, 94, 88);
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const v = rng.range(50, 160);
    x.fillStyle = rgb(v, v * 0.95, v * 0.9);
    x.beginPath();
    const cx = rng.next() * S;
    const cy = rng.next() * S;
    const r = rng.range(2, 10);
    x.moveTo(cx + r, cy);
    for (let k = 1; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const rr = r * rng.range(0.6, 1.2);
      x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.fill();
  }
  // 붉은 벽돌 파편
  for (let i = 0; i < 70; i++) {
    x.fillStyle = rgb(rng.range(110, 150), rng.range(55, 70), 45, 0.85);
    x.fillRect(rng.next() * S, rng.next() * S, rng.range(3, 8), rng.range(2, 5));
  }
  grain(x, S, S, rng, 20);
  return tex(c);
}

// 진입 불가 건물 외벽: 4베이 × 4층 아틀라스 (창문 포함) + 발광 맵(불타는 창)
function facadeAtlas(rng, kind) {
  const S = 512;
  const [c, x] = canvas(S, S);
  const [e, ex] = canvas(S, S);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, S, S);
  const cell = S / 4;

  // 바탕 벽
  if (kind === 'brick') {
    const b = brick(rng, [rng.range(100, 122), rng.range(64, 76), rng.range(52, 60)]).image;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.drawImage(b, i * 256, j * 256);
  } else {
    const base = kind === 'concrete' ? [118, 116, 110] : [150, 132, 104];
    const p = (kind === 'concrete' ? concrete(rng, base) : plaster(rng, base)).image;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.drawImage(p, i * 256, j * 256);
    // 층 구분 띠
    for (let r = 0; r < 4; r++) {
      x.fillStyle = 'rgba(60,54,48,0.35)';
      x.fillRect(0, r * cell + cell - 6, S, 5);
    }
  }

  for (let bx = 0; bx < 4; bx++) {
    for (let by = 0; by < 4; by++) {
      const ox = bx * cell;
      const oy = by * cell;
      const wx = ox + cell * 0.3;
      const ww = cell * 0.4;
      const wy = oy + cell * 0.27;
      const wh = cell * 0.44;
      const kindRoll = rng.next();
      // 창틀·인방
      x.fillStyle = 'rgba(55,50,46,0.9)';
      x.fillRect(wx - 4, wy - 6, ww + 8, 6);
      x.fillStyle = 'rgba(150,145,135,0.9)';
      x.fillRect(wx - 5, wy + wh, ww + 10, 5);
      if (kindRoll < 0.3) {
        // 깨진 창 — 어두운 내부 + 날카로운 유리 조각
        x.fillStyle = rgb(14, 12, 12);
        x.fillRect(wx, wy, ww, wh);
        x.fillStyle = 'rgba(150,160,165,0.55)';
        for (let k = 0; k < 4; k++) {
          x.beginPath();
          const corner = rng.int(0, 3);
          const cx0 = corner % 2 ? wx + ww : wx;
          const cy0 = corner > 1 ? wy + wh : wy;
          x.moveTo(cx0, cy0);
          x.lineTo(cx0 + (corner % 2 ? -1 : 1) * rng.range(5, ww * 0.5), cy0);
          x.lineTo(cx0, cy0 + (corner > 1 ? -1 : 1) * rng.range(5, wh * 0.5));
          x.fill();
        }
      } else if (kindRoll < 0.45) {
        // 판자로 막은 창
        x.fillStyle = rgb(20, 18, 16);
        x.fillRect(wx, wy, ww, wh);
        for (let k = 0; k < 4; k++) {
          const v = rng.range(-15, 15);
          x.fillStyle = rgb(100 + v, 74 + v, 50 + v);
          x.save();
          x.translate(wx + ww / 2, wy + 8 + k * (wh / 4));
          x.rotate(rng.range(-0.12, 0.12));
          x.fillRect(-ww / 2 - 3, -5, ww + 6, 10);
          x.restore();
        }
      } else if (kindRoll < 0.55) {
        // 불타는 창 — 발광 맵에도 기록
        const g = x.createLinearGradient(0, wy, 0, wy + wh);
        g.addColorStop(0, rgb(90, 30, 10));
        g.addColorStop(1, rgb(200, 90, 20));
        x.fillStyle = g;
        x.fillRect(wx, wy, ww, wh);
        const ge = ex.createLinearGradient(0, wy, 0, wy + wh);
        ge.addColorStop(0, rgb(120, 40, 8));
        ge.addColorStop(1, rgb(255, 130, 30));
        ex.fillStyle = ge;
        ex.fillRect(wx, wy, ww, wh);
        // 위쪽 그을음
        const s = x.createLinearGradient(0, oy, 0, wy);
        s.addColorStop(0, 'rgba(10,8,8,0)');
        s.addColorStop(1, 'rgba(10,8,8,0.85)');
        x.fillStyle = s;
        x.fillRect(wx - 10, oy, ww + 20, wy - oy);
      } else if (kindRoll < 0.7) {
        // 그을린 빈 창
        x.fillStyle = rgb(10, 9, 9);
        x.fillRect(wx, wy, ww, wh);
        const s = x.createLinearGradient(0, oy - cell * 0.3, 0, wy);
        s.addColorStop(0, 'rgba(10,8,8,0)');
        s.addColorStop(1, 'rgba(10,8,8,0.75)');
        x.fillStyle = s;
        x.fillRect(wx - 12, oy - cell * 0.3, ww + 24, wy - oy + cell * 0.3);
      } else {
        // 남아있는 더러운 유리
        const g = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
        g.addColorStop(0, rgb(52, 58, 64));
        g.addColorStop(0.5, rgb(88, 84, 82));
        g.addColorStop(1, rgb(30, 32, 36));
        x.fillStyle = g;
        x.fillRect(wx, wy, ww, wh);
        x.fillStyle = rgb(60, 56, 50);
        x.fillRect(wx + ww / 2 - 2, wy, 4, wh);
        x.fillRect(wx, wy + wh / 2 - 2, ww, 4);
      }
      // 탄흔
      for (let k = 0; k < rng.int(0, 6); k++) {
        x.fillStyle = 'rgba(25,22,20,0.85)';
        x.beginPath();
        x.arc(ox + rng.next() * cell, oy + rng.next() * cell, rng.range(1.5, 4), 0, Math.PI * 2);
        x.fill();
      }
    }
  }
  // 큰 포격 자국 몇 개
  blotches(x, S, S, rng, 3, 'rgba(15,12,10,A)', 30, 70, 0.6);
  return { map: tex(c), emissive: tex(e) };
}

// ---------------------------------------------------------------------
// 이펙트용 (알파 텍스처)
// ---------------------------------------------------------------------
function softPuff(rng) {
  const S = 128;
  const [c, x] = canvas(S, S);
  for (let i = 0; i < 26; i++) {
    const px = S / 2 + rng.range(-24, 24);
    const py = S / 2 + rng.range(-24, 24);
    const r = rng.range(16, 40);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
  }
  // 가장자리 마스크
  const img = x.getImageData(0, 0, S, S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const dx = (i - S / 2) / (S / 2);
      const dy = (j - S / 2) / (S / 2);
      const m = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      img.data[(j * S + i) * 4 + 3] *= Math.min(1, m * 1.6);
    }
  }
  x.putImageData(img, 0, 0);
  return tex(c, { repeat: false, srgb: false });
}

function radialGlow(stops) {
  const S = 64;
  const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return tex(c, { repeat: false, srgb: false });
}

function flame(rng) {
  const S = 64;
  const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(S / 2, S * 0.62, 2, S / 2, S * 0.55, S / 2);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.25, 'rgba(255,200,90,0.9)');
  g.addColorStop(0.6, 'rgba(240,90,20,0.45)');
  g.addColorStop(1, 'rgba(120,20,0,0)');
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(S / 2, 2);
  x.bezierCurveTo(S * 0.85, S * 0.35, S * 0.95, S * 0.8, S / 2, S - 2);
  x.bezierCurveTo(S * 0.05, S * 0.8, S * 0.15, S * 0.35, S / 2, 2);
  x.fill();
  return tex(c, { repeat: false, srgb: false });
}

function muzzleStar(rng) {
  const S = 128;
  const [c, x] = canvas(S, S);
  x.translate(S / 2, S / 2);
  const spikes = 7;
  for (let layer = 0; layer < 2; layer++) {
    x.beginPath();
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? (layer ? 34 : 60) * rng.range(0.7, 1) : (layer ? 10 : 18);
      x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath();
    x.fillStyle = layer ? 'rgba(255,250,220,1)' : 'rgba(255,170,60,0.85)';
    x.fill();
  }
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,220,150,0)');
  x.fillStyle = g;
  x.fillRect(-30, -30, 60, 60);
  return tex(c, { repeat: false, srgb: false });
}

function bulletHole(rng) {
  const S = 64;
  const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(5,4,4,1)');
  g.addColorStop(0.22, 'rgba(15,12,10,0.95)');
  g.addColorStop(0.35, 'rgba(60,55,50,0.6)');
  g.addColorStop(1, 'rgba(60,55,50,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(20,18,16,0.7)';
  for (let i = 0; i < 6; i++) {
    const a = rng.next() * Math.PI * 2;
    x.beginPath();
    x.moveTo(S / 2, S / 2);
    x.lineTo(S / 2 + Math.cos(a) * rng.range(10, 22), S / 2 + Math.sin(a) * rng.range(10, 22));
    x.stroke();
  }
  return tex(c, { repeat: false, srgb: true });
}

function scorch(rng) {
  const S = 256;
  const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(12,10,9,0.95)');
  g.addColorStop(0.4, 'rgba(25,20,17,0.85)');
  g.addColorStop(0.75, 'rgba(40,32,26,0.45)');
  g.addColorStop(1, 'rgba(40,32,26,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  // 방사형 파편 줄기
  x.strokeStyle = 'rgba(20,16,14,0.5)';
  x.lineWidth = 3;
  for (let i = 0; i < 26; i++) {
    const a = rng.next() * Math.PI * 2;
    x.beginPath();
    x.moveTo(S / 2 + Math.cos(a) * 30, S / 2 + Math.sin(a) * 30);
    x.lineTo(S / 2 + Math.cos(a) * rng.range(70, 125), S / 2 + Math.sin(a) * rng.range(70, 125));
    x.stroke();
  }
  return tex(c, { repeat: false });
}

function laneDash() {
  const [c, x] = canvas(16, 64);
  x.fillStyle = 'rgba(200,180,110,0.75)';
  x.fillRect(2, 0, 12, 64);
  return tex(c, { repeat: false });
}

// 피아식별용: 적 군복 위장 무늬는 정점 색으로 처리하므로 텍스처 불필요

export function createTextures(seed = 7) {
  const rng = new RNG(seed);
  const t = {
    asphalt: asphalt(rng),
    sidewalk: sidewalk(rng),
    dirt: dirt(rng),
    concrete: concrete(rng),
    concreteDark: concrete(rng, [92, 90, 86]),
    plasterA: plaster(rng, [156, 136, 108]),
    plasterB: plaster(rng, [128, 126, 116]),
    brick: brick(rng),
    interior: interiorWall(rng),
    floorTile: floorTile(rng),
    wood: wood(rng),
    burntMetal: burntMetal(rng),
    sandbag: sandbag(rng),
    roof: roof(rng),
    rubble: rubble(rng),
    facadeBrick: facadeAtlas(rng, 'brick'),
    facadePlaster: facadeAtlas(rng, 'plaster'),
    facadeConcrete: facadeAtlas(rng, 'concrete'),
    smoke: softPuff(rng),
    glow: radialGlow([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]),
    spark: radialGlow([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,230,160,0.9)'], [1, 'rgba(255,140,40,0)']]),
    flame: flame(rng),
    muzzle: muzzleStar(rng),
    bulletHole: bulletHole(rng),
    scorch: scorch(rng),
    lane: laneDash(),
  };
  return t;
}
