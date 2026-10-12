import { useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PanelNode } from "../geometry/types";
import { rect } from "../geometry/shapes";
import type { PanelTextures } from "../artwork/usePanelTextures";

interface HingeInfo {
  pivot: [number, number, number];
  axis: "x" | "y";
  baseAngle: number;
}

function computeHinge(node: PanelNode, parentW: number, parentH: number): HingeInfo {
  const offset = node.parentOffset ?? 0;
  switch (node.parentEdge) {
    case "right":
      return { pivot: [parentW, offset, 0], axis: "y", baseAngle: 0 };
    case "left":
      return { pivot: [0, offset, 0], axis: "y", baseAngle: 0 };
    case "top":
      return { pivot: [offset, parentH, 0], axis: "x", baseAngle: 0 };
    case "bottom":
      return { pivot: [offset, 0, 0], axis: "x", baseAngle: Math.PI };
    default:
      return { pivot: [0, 0, 0], axis: "x", baseAngle: 0 };
  }
}

function PanelMesh({ node, textures }: { node: PanelNode; textures?: PanelTextures }) {
  const geometry = useMemo(() => {
    const pts = node.outline ?? rect(node.w, node.h);
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geom = new THREE.ShapeGeometry(shape);

    // THREE.ShapeGeometry's built-in UVs are raw local coordinates in mm (its own
    // comment even calls them "world uvs"), NOT normalized to the 0..1 range every
    // texture mapping expects. With the default clamp-to-edge wrapping, a UV of
    // e.g. 70 just clamps to the texture's very last edge pixel — so instead of
    // showing the artwork, almost the entire panel rendered as one smeared solid
    // color (whatever sat at that edge pixel). That's what made uploaded artwork,
    // and the "printed" measurement labels, invisible in the 3D view. Remap to
    // real 0..1 UVs using this panel's own width/height.
    const uv = geom.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) / node.w, uv.getY(i) / node.h);
    }
    uv.needsUpdate = true;

    return geom;
  }, [node]);

  // Panel textures are rasterized asynchronously, so the very first render always
  // has map=undefined and the material gets COMPILED WITHOUT the USE_MAP shader
  // define. Assigning material.map afterwards does not recompile that program, so
  // the texture is silently never sampled and the panel keeps rendering as flat
  // colour — which is why uploaded artwork (and the printed measurement labels)
  // stayed invisible in 3D even after the UV mapping was corrected. Keying the
  // material on the texture's identity makes R3F build a fresh material once the
  // texture exists, so it compiles with the map in place.
  const outsideKey = textures?.outside.uuid ?? "no-outside";
  const insideKey = textures?.inside.uuid ?? "no-inside";

  return (
    <>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          key={outsideKey}
          map={textures?.outside}
          color={textures ? "#ffffff" : "#d8cdb8"}
          side={THREE.FrontSide}
          roughness={0.85}
        />
      </mesh>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          key={insideKey}
          map={textures?.inside}
          color={textures ? "#ffffff" : "#efe6d3"}
          side={THREE.BackSide}
          roughness={0.9}
        />
      </mesh>
    </>
  );
}

function PanelGroup({
  node,
  parentW,
  parentH,
  foldAmount,
  texturesById,
}: {
  node: PanelNode;
  parentW: number;
  parentH: number;
  foldAmount: number;
  texturesById: Map<string, PanelTextures>;
}) {
  const { pivot, axis, baseAngle } = computeHinge(node, parentW, parentH);
  // Remap the global slider into this hinge's own phase window (tube walls close
  // first, then inner/glued flaps, then outer flaps) so the box assembles in a
  // realistic order instead of every hinge moving in lockstep.
  const start = node.foldStart ?? 0;
  const end = node.foldEnd ?? 1;
  const localT = end > start ? Math.min(1, Math.max(0, (foldAmount - start) / (end - start))) : foldAmount;
  const angle = baseAngle + localT * node.foldAngle;
  const rotation: [number, number, number] = axis === "x" ? [angle, 0, 0] : [0, angle, 0];

  return (
    <group position={pivot} rotation={rotation}>
      <PanelMesh node={node} textures={texturesById.get(node.id)} />
      {node.children.map((child) => (
        <PanelGroup key={child.id} node={child} parentW={node.w} parentH={node.h} foldAmount={foldAmount} texturesById={texturesById} />
      ))}
    </group>
  );
}

interface Fold3DProps {
  root: PanelNode;
  foldAmount: number;
  texturesById: Map<string, PanelTextures>;
  onSceneReady?: (group: THREE.Group) => void;
}

export default function Fold3D({ root, foldAmount, texturesById, onSceneReady }: Fold3DProps) {
  const groupRef = useRef<THREE.Group>(null);

  return (
    <Canvas camera={{ position: [260, 220, 320], fov: 40, near: 1, far: 5000 }}>
      <color attach="background" args={["#1c1f26"]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[300, 400, 200]} intensity={0.9} />
      <directionalLight position={[-200, 150, -300]} intensity={0.4} />
      <directionalLight position={[0, -250, 100]} intensity={0.25} />
      <group
        ref={(g) => {
          groupRef.current = g;
          if (g && onSceneReady) onSceneReady(g);
        }}
      >
        <PanelGroup node={root} parentW={root.w} parentH={root.h} foldAmount={foldAmount} texturesById={texturesById} />
      </group>
      {/* No floor/grid mesh — the box is centered in free space so orbiting all the way
          around (including from below) never clips through a ground plane.
          No polar/azimuth angle limits either — full free-spin in every direction.
          minDistance/maxDistance are just a numeric guard rail (so you can't dolly
          the camera INTO the mesh or scroll it out to where it's a single pixel),
          set very wide so they shouldn't be reachable in normal use. */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={5}
        maxDistance={20000}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
        minAzimuthAngle={-Infinity}
        maxAzimuthAngle={Infinity}
      />
    </Canvas>
  );
}
