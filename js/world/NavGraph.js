// 웨이포인트 그래프 + A* 경로 탐색 + 2D 점유 격자
// 노드: 도로·골목·출입구·계단·방·창가·옥상·엄폐 지점 — 맵 생성 때 함께 만들어진다.

// ---------------------------------------------------------------------
// 2D 점유 격자 (실외 이동 가능 여부 판정용)
// ---------------------------------------------------------------------
export class OccupancyGrid {
  constructor(half, cell = 0.5) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((half * 2) / cell);
    this.data = new Uint8Array(this.n * this.n);
  }

  _idx(x, z) {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return i + j * this.n;
  }

  // 회전된 직사각형을 막힘으로 표시 (pad: 에이전트 반경만큼 확장)
  markRect(cx, cz, sx, sz, rotY = 0, pad = 0) {
    const hx = sx / 2 + pad;
    const hz = sz / 2 + pad;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const r = Math.sqrt(hx * hx + hz * hz);
    const c = this.cell;
    for (let x = cx - r; x <= cx + r; x += c) {
      for (let z = cz - r; z <= cz + r; z += c) {
        const px = x + c / 2 - cx;
        const pz = z + c / 2 - cz;
        // 월드 → 로컬 (rotY 역회전)
        const lx = px * cos - pz * sin;
        const lz = px * sin + pz * cos;
        if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) {
          const k = this._idx(x + c / 2, z + c / 2);
          if (k >= 0) this.data[k] = 1;
        }
      }
    }
  }

  markAABB(minX, minZ, maxX, maxZ, pad = 0) {
    this.markRect((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ, 0, pad);
  }

  markCircle(cx, cz, radius) {
    const c = this.cell;
    for (let x = cx - radius; x <= cx + radius; x += c) {
      for (let z = cz - radius; z <= cz + radius; z += c) {
        const dx = x + c / 2 - cx;
        const dz = z + c / 2 - cz;
        if (dx * dx + dz * dz <= radius * radius) {
          const k = this._idx(x + c / 2, z + c / 2);
          if (k >= 0) this.data[k] = 1;
        }
      }
    }
  }

  isFree(x, z) {
    const k = this._idx(x, z);
    return k >= 0 && this.data[k] === 0;
  }

  // 사각 영역이 비어 있는지 (소품 배치용)
  rectFree(cx, cz, sx, sz, rotY = 0, pad = 0) {
    const hx = sx / 2 + pad;
    const hz = sz / 2 + pad;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const step = this.cell;
    for (let lx = -hx; lx <= hx; lx += step) {
      for (let lz = -hz; lz <= hz; lz += step) {
        const x = cx + lx * cos + lz * sin;
        const z = cz - lx * sin + lz * cos;
        if (!this.isFree(x, z)) return false;
      }
    }
    return true;
  }

  segmentFree(x0, z0, x1, z1) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.isFree(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }

  // 가까운 빈 칸 찾기
  nearestFree(x, z, maxR = 2) {
    if (this.isFree(x, z)) return [x, z];
    for (let r = this.cell; r <= maxR; r += this.cell) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const px = x + Math.cos(ang) * r;
        const pz = z + Math.sin(ang) * r;
        if (this.isFree(px, pz)) return [px, pz];
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------
// 이진 힙 (A* 우선순위 큐)
// ---------------------------------------------------------------------
class MinHeap {
  constructor() {
    this.ids = [];
    this.keys = [];
  }
  get size() { return this.ids.length; }
  push(id, key) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop() {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop();
    const lastKey = keys.pop();
    if (ids.length > 0) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        let mk = lastKey;
        if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

// ---------------------------------------------------------------------
// 내비 그래프
// ---------------------------------------------------------------------
export class NavGraph {
  constructor(cellSize = 6) {
    this.nodes = [];
    this.cell = cellSize;
    this.hash = new Map();
    this._stamp = 0;
  }

  /**
   * @param {object} p { x,y,z, type, indoor, buildingId, floor, room, coverDir:{x,z}, out:{x,z} }
   * type: street | alley | door | doorOut | room | hall | window | stair | landing | roof | cover
   */
  addNode(p) {
    const node = {
      id: this.nodes.length,
      x: p.x, y: p.y || 0, z: p.z,
      type: p.type || 'street',
      indoor: !!p.indoor,
      buildingId: p.buildingId ?? -1,
      floor: p.floor ?? 0,
      room: p.room ?? null,
      coverDir: p.coverDir || null, // 엄폐물이 있는 방향 (단위벡터)
      out: p.out || null, // 창가·옥상: 바깥 방향
      tags: p.tags || null,
      edges: [],
      reservedBy: null,
      removed: false,
      // A* 작업용
      g: 0, f: 0, parent: -1, stamp: 0, closed: 0,
    };
    this.nodes.push(node);
    this._hashInsert(node);
    return node.id;
  }

  _key(x, z) {
    return Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell);
  }

  _hashInsert(node) {
    const k = this._key(node.x, node.z);
    let arr = this.hash.get(k);
    if (!arr) this.hash.set(k, (arr = []));
    arr.push(node.id);
  }

  addEdge(a, b, costMul = 1) {
    if (a === b) return;
    const na = this.nodes[a];
    const nb = this.nodes[b];
    if (na.edges.some((e) => e.to === b)) return;
    const dx = na.x - nb.x;
    const dy = na.y - nb.y;
    const dz = na.z - nb.z;
    const cost = Math.sqrt(dx * dx + dy * dy * 2 + dz * dz) * costMul;
    na.edges.push({ to: b, cost });
    nb.edges.push({ to: a, cost });
  }

  get(id) { return this.nodes[id]; }

  // 반경 내 노드 (필터 가능)
  inRadius(x, y, z, r, filter = null, yWeight = 2) {
    const out = [];
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c);
    const z1 = Math.floor((z + r) / c);
    const r2 = r * r;
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const arr = this.hash.get(i + ',' + j);
        if (!arr) continue;
        for (const id of arr) {
          const n = this.nodes[id];
          if (n.removed) continue;
          const dx = n.x - x;
          const dy = (n.y - y) * yWeight;
          const dz = n.z - z;
          if (dx * dx + dy * dy + dz * dz <= r2 && (!filter || filter(n))) out.push(n);
        }
      }
    }
    return out;
  }

  nearest(x, y, z, filter = null, maxR = 30) {
    let best = null;
    let bestD = Infinity;
    for (let r = 4; r <= maxR; r *= 2) {
      const cand = this.inRadius(x, y, z, r, filter, 3);
      for (const n of cand) {
        const dx = n.x - x;
        const dy = (n.y - y) * 3;
        const dz = n.z - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (best) return best;
    }
    return best;
  }

  // 가장 큰 연결 요소만 남기고 고립 노드 제거
  pruneToLargestComponent() {
    const comp = new Int32Array(this.nodes.length).fill(-1);
    let best = -1;
    let bestSize = 0;
    let c = 0;
    for (const n of this.nodes) {
      if (n.removed || comp[n.id] !== -1) continue;
      let size = 0;
      const stack = [n.id];
      comp[n.id] = c;
      while (stack.length) {
        const id = stack.pop();
        size++;
        for (const e of this.nodes[id].edges) {
          if (comp[e.to] === -1 && !this.nodes[e.to].removed) {
            comp[e.to] = c;
            stack.push(e.to);
          }
        }
      }
      if (size > bestSize) {
        bestSize = size;
        best = c;
      }
      c++;
    }
    let removed = 0;
    for (const n of this.nodes) {
      if (!n.removed && comp[n.id] !== best) {
        n.removed = true;
        removed++;
      }
    }
    // 제거된 노드로 향하는 간선 정리
    for (const n of this.nodes) {
      if (n.removed) n.edges = [];
      else n.edges = n.edges.filter((e) => !this.nodes[e.to].removed);
    }
    this.activeCount = this.nodes.length - removed;
    return removed;
  }

  /**
   * A* 경로 탐색
   * @returns {number[]|null} 노드 id 배열 (시작 포함)
   */
  findPath(startId, goalId, opts = {}) {
    if (startId == null || goalId == null) return null;
    if (startId === goalId) return [startId];
    const nodes = this.nodes;
    const goal = nodes[goalId];
    if (!goal || goal.removed || nodes[startId].removed) return null;
    const stamp = ++this._stamp;
    const heap = new MinHeap();
    const s = nodes[startId];
    s.g = 0;
    s.parent = -1;
    s.stamp = stamp;
    s.closed = 0;
    heap.push(startId, this._h(s, goal));
    const avoid = opts.avoid || null; // (node) => 추가 비용
    let iter = 0;
    const maxIter = opts.maxIter || 6000;
    while (heap.size && iter++ < maxIter) {
      const id = heap.pop();
      const n = nodes[id];
      if (n.closed === stamp) continue;
      n.closed = stamp;
      if (id === goalId) {
        const path = [];
        let cur = id;
        while (cur !== -1) {
          path.push(cur);
          cur = nodes[cur].parent;
        }
        return path.reverse();
      }
      for (const e of n.edges) {
        const m = nodes[e.to];
        if (m.closed === stamp) continue;
        let g = n.g + e.cost;
        if (avoid) g += avoid(m);
        if (m.stamp !== stamp || g < m.g) {
          m.stamp = stamp;
          m.g = g;
          m.parent = id;
          heap.push(e.to, g + this._h(m, goal));
        }
      }
    }
    return null;
  }

  _h(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  pathLength(path) {
    let len = 0;
    for (let i = 1; i < path.length; i++) len += this._h(this.nodes[path[i - 1]], this.nodes[path[i]]);
    return len;
  }
}
