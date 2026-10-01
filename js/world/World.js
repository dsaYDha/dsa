// 월드 — 맵 생성 결과(정적 지형·충돌·내비 그래프·건물·출현 지점)와 분위기를 보관하고 질의 함수를 제공
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createTextures } from './Textures.js';
import { createWorldMaterials } from './Materials.js';
import { GeometryBatcher } from './GeometryBatcher.js';
import { CollisionWorld } from './Collision.js';
import { NavGraph, OccupancyGrid } from './NavGraph.js';
import { generateCity } from './CityGenerator.js';
import { Atmosphere } from './Atmosphere.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = null;
    this.ready = false;
  }

  async generate(seed, onProgress = () => {}) {
    const t0 = performance.now();
    this.seed = seed;
    onProgress('텍스처 생성 중…');
    await nextFrame();
    this.textures = this.textures || createTextures(7);
    this.materialSet = this.materialSet || createWorldMaterials(this.textures);

    onProgress('시가지 배치 중…');
    await nextFrame();
    this.collision = new CollisionWorld();
    this.nav = new NavGraph(6);
    this.occupancy = new OccupancyGrid(CONFIG.map.size / 2 + 6, 0.5);
    const batcher = new GeometryBatcher(this.materialSet, this.collision);
    this.city = generateCity(seed, batcher, this.collision, this.nav, this.occupancy, this.materialSet);

    onProgress('지오메트리 병합 중…');
    await nextFrame();
    this.root = new THREE.Group();
    this.root.name = 'World';
    this.root.add(batcher.build());
    this.city.props.finalize(this.root);
    this.staticTriangles = batcher.triangleCount;
    this.scene.add(this.root);

    onProgress('충돌 트리 구성 중…');
    await nextFrame();
    this.collision.build();

    onProgress('분위기 연출 준비 중…');
    await nextFrame();
    this.atmosphere = new Atmosphere(this.scene, this.textures, this.city.fires, seed);
    this.atmosphere.buildSkyline(this.materialSet.materials);

    this.buildings = this.city.buildings;
    this.enterable = this.city.enterable;
    this.spawnPoints = this.city.spawnPoints;
    this.genMs = performance.now() - t0;
    this.ready = true;
    return this;
  }

  // 같은 씬에서 다른 시드로 다시 만들 때 정리
  dispose() {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.atmosphere) {
      const a = this.atmosphere;
      this.scene.remove(a.sky, a.hemi, a.sun, a.sun.target, a.smoke.mesh, a.flames.mesh, a.embers.mesh, a.ash.mesh);
      for (const s of a.fireLights) this.scene.remove(s.light);
      this.scene.children.filter((c) => c.isInstancedMesh && c.material === this.materialSet.materials.skyline).forEach((c) => this.scene.remove(c));
    }
    this.root = null;
    this.ready = false;
  }

  update(dt, camera, playerPos) {
    if (!this.ready) return;
    const indoor = this.isIndoors(playerPos) ? 1 : 0;
    this.atmosphere.update(dt, camera, playerPos, indoor);
  }

  // ------------------------------------------------------------------
  // 질의
  // ------------------------------------------------------------------
  /**
   * 어떤 위치가 건물 안인지 판별 (4단계 실내 전용 문답용)
   * 진입 가능 건물의 내벽 안쪽이면서 옥상 높이보다 낮으면 실내
   */
  isIndoors(pos) {
    return this.getIndoorInfo(pos) !== null;
  }

  /** @returns {null | { building, floor, room }} */
  getIndoorInfo(pos) {
    if (!this.enterable) return null;
    for (const b of this.enterable) {
      const r = b.inner;
      if (pos.x < r.minX || pos.x > r.maxX || pos.z < r.minZ || pos.z > r.maxZ) continue;
      if (pos.y < -0.5 || pos.y > b.roofY - 0.3) continue;
      const floor = Math.max(0, Math.min(b.floors - 1, Math.floor((pos.y + 0.4) / b.floorHeight)));
      const room = b.rooms.find((rm) => rm.floor === floor && pos.x >= rm.minX && pos.x <= rm.maxX && pos.z >= rm.minZ && pos.z <= rm.maxZ) || null;
      return { building: b, floor, room };
    }
    return null;
  }

  getBuildingAt(x, z) {
    for (const b of this.buildings) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return b;
    }
    return null;
  }

  raycast(origin, dir, maxDist, out) {
    return this.collision.raycast(origin, dir, maxDist, out);
  }

  hasLineOfSight(a, b) {
    return !this.collision.segmentBlocked(a, b);
  }
}
