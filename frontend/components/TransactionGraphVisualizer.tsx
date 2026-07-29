/**
 * components/TransactionGraphVisualizer.tsx
 *
 * WebGL visualizer for the Stellar on-chain transaction graph. Nodes are
 * wallet addresses, edges are donations/escrow releases between them.
 *
 * Rendering strategy for scale (up to tens of thousands of nodes):
 *  - Nodes: a single THREE.InstancedMesh (one draw call for all nodes).
 *  - Edges: a single THREE.LineSegments backed by one BufferGeometry (one
 *    draw call for all edges) — cheaper than per-edge instancing for thin
 *    lines and avoids the overhead of tens of thousands of separate draws.
 *  - Frustum culling: nodes outside the camera frustum are excluded from the
 *    hover/click raycasting candidate list every frame, so interaction cost
 *    scales with what's on screen, not with total graph size. GPU-side
 *    clipping handles the actual render culling for both meshes.
 *  - Layout: node positions are derived deterministically from a hash of the
 *    wallet address (no full force-directed simulation client-side, which
 *    would not be feasible synchronously at 50k-node scale on the main
 *    thread) — node size still reflects degree so hubs stand out visually.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { NetworkNode, NetworkEdge } from "@/lib/api";
import { shortenAddress, formatXLM } from "@/utils/format";
import { useI18n } from "@/lib/i18n";

interface TransactionGraphVisualizerProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

interface HoveredNode {
  node: NetworkNode;
  screenX: number;
  screenY: number;
}

const DONATION_COLOR = new THREE.Color("#22c55e");
const ESCROW_COLOR = new THREE.Color("#a855f7");
const NODE_COLOR = new THREE.Color("#15803d");
const HOVER_COLOR = new THREE.Color("#fbbf24");

function hashToUnit(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h / 0xffffffff;
}

/** Deterministic spherical layout, radius grows with hash so the graph isn't a flat shell. */
function layoutNode(id: string): THREE.Vector3 {
  const a = hashToUnit(id);
  const b = hashToUnit(id + ":b");
  const c = hashToUnit(id + ":c");

  const theta = a * Math.PI * 2;
  const phi = Math.acos(2 * b - 1);
  const radius = 20 + c * 180;

  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
  );
}

export default function TransactionGraphVisualizer({ nodes, edges }: TransactionGraphVisualizerProps) {
  const { localeTag } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredNode | null>(null);
  const [selected, setSelected] = useState<NetworkNode | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0a0f0a");

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 5000);
    camera.position.set(0, 0, 400);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 2000;

    // ── Build node lookup + positions ──────────────────────────────────────
    const positions = new Float32Array(nodes.length * 3);
    const nodeIndexById = new Map<string, number>();

    nodes.forEach((node, i) => {
      const p = layoutNode(node.id);
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      nodeIndexById.set(node.id, i);
    });

    // ── Nodes: one InstancedMesh, one draw call ────────────────────────────
    const nodeGeometry = new THREE.SphereGeometry(1, 10, 10);
    const nodeMaterial = new THREE.MeshBasicMaterial();
    const nodeMesh = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, nodes.length);
    nodeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nodes.length * 3), 3);

    const dummy = new THREE.Object3D();
    nodes.forEach((node, i) => {
      const scale = 1 + Math.log2(1 + node.degree) * 0.6;
      dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      dummy.scale.setScalar(Math.min(scale, 6));
      dummy.updateMatrix();
      nodeMesh.setMatrixAt(i, dummy.matrix);
      nodeMesh.setColorAt(i, NODE_COLOR);
    });
    nodeMesh.instanceMatrix.needsUpdate = true;
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
    scene.add(nodeMesh);

    // ── Edges: one LineSegments, one draw call ─────────────────────────────
    const edgePositions = new Float32Array(edges.length * 6);
    const edgeColors = new Float32Array(edges.length * 6);
    let edgeVertCount = 0;
    edges.forEach((edge) => {
      const sIdx = nodeIndexById.get(edge.source);
      const tIdx = nodeIndexById.get(edge.target);
      if (sIdx === undefined || tIdx === undefined) return;

      const base = edgeVertCount * 6;
      edgePositions[base] = positions[sIdx * 3];
      edgePositions[base + 1] = positions[sIdx * 3 + 1];
      edgePositions[base + 2] = positions[sIdx * 3 + 2];
      edgePositions[base + 3] = positions[tIdx * 3];
      edgePositions[base + 4] = positions[tIdx * 3 + 1];
      edgePositions[base + 5] = positions[tIdx * 3 + 2];

      const color = edge.type === "escrow" ? ESCROW_COLOR : DONATION_COLOR;
      edgeColors[base] = color.r; edgeColors[base + 1] = color.g; edgeColors[base + 2] = color.b;
      edgeColors[base + 3] = color.r; edgeColors[base + 4] = color.g; edgeColors[base + 5] = color.b;
      edgeVertCount += 1;
    });

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions.subarray(0, edgeVertCount * 6), 3));
    edgeGeometry.setAttribute("color", new THREE.BufferAttribute(edgeColors.subarray(0, edgeVertCount * 6), 3));
    const edgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 });
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    scene.add(edgeLines);

    // ── Interaction: frustum-culled candidate list + manual ray/sphere test ─
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    let visibleIndices: number[] = [];
    let hoveredIndex = -1;

    function recomputeFrustumVisibility() {
      projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreenMatrix);
      visibleIndices = [];
      const sphere = new THREE.Sphere();
      for (let i = 0; i < nodes.length; i++) {
        sphere.center.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        sphere.radius = 4;
        if (frustum.intersectsSphere(sphere)) visibleIndices.push(i);
      }
    }

    function setNodeColor(index: number, color: THREE.Color) {
      nodeMesh.setColorAt(index, color);
      if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
    }

    function pickNode(clientX: number, clientY: number): number {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      let closestIndex = -1;
      let closestDist = Infinity;
      const sphere = new THREE.Sphere();
      for (const i of visibleIndices) {
        sphere.center.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        sphere.radius = 3;
        const hit = raycaster.ray.intersectSphere(sphere, new THREE.Vector3());
        if (hit) {
          const dist = hit.distanceTo(camera.position);
          if (dist < closestDist) {
            closestDist = dist;
            closestIndex = i;
          }
        }
      }
      return closestIndex;
    }

    function onPointerMove(e: PointerEvent) {
      const index = pickNode(e.clientX, e.clientY);
      if (index === hoveredIndex) return;

      if (hoveredIndex !== -1) {
        setNodeColor(hoveredIndex, NODE_COLOR);
      }
      hoveredIndex = index;

      if (index === -1) {
        setHovered(null);
        return;
      }
      setNodeColor(index, HOVER_COLOR);
      const rect = renderer.domElement.getBoundingClientRect();
      setHovered({ node: nodes[index], screenX: e.clientX - rect.left, screenY: e.clientY - rect.top });
    }

    function onClick(e: PointerEvent) {
      const index = pickNode(e.clientX, e.clientY);
      setSelected(index === -1 ? null : nodes[index]);
    }

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("click", onClick);

    function handleResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener("resize", handleResize);

    let frameId: number;
    let frustumCounter = 0;
    function animate() {
      frameId = requestAnimationFrame(animate);
      controls.update();
      // Recompute frustum-visible candidates a few times a second, not every frame —
      // it only needs to track camera movement, not render-loop cadence.
      if (frustumCounter++ % 6 === 0) recomputeFrustumVisibility();
      renderer.render(scene, camera);
    }
    recomputeFrustumVisibility();
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      nodeGeometry.dispose();
      nodeMaterial.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [nodes, edges]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[600px]">
      {hovered && (
        <div
          className="absolute z-10 pointer-events-none px-3 py-2 rounded-lg bg-black/80 text-white text-xs font-mono"
          style={{ left: hovered.screenX + 12, top: hovered.screenY + 12 }}
        >
          <div>{shortenAddress(hovered.node.id, 6)}</div>
          <div>In: {formatXLM(hovered.node.totalIn, 2, localeTag)} · Out: {formatXLM(hovered.node.totalOut, 2, localeTag)}</div>
          <div>Connections: {hovered.node.degree}</div>
        </div>
      )}
      {selected && (
        <div className="absolute z-10 top-4 end-4 px-4 py-3 rounded-xl bg-white/95 shadow-lg text-sm">
          <p className="font-mono font-semibold text-forest-900">{shortenAddress(selected.id, 8)}</p>
          <p className="text-forest-600 mt-1">Total in: {formatXLM(selected.totalIn, 2, localeTag)}</p>
          <p className="text-forest-600">Total out: {formatXLM(selected.totalOut, 2, localeTag)}</p>
          <p className="text-forest-600">Connections: {selected.degree}</p>
        </div>
      )}
    </div>
  );
}
