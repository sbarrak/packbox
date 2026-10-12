import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

/** Exports the current (folded) 3D scene, textures included, as a binary GLB blob. */
export function exportGLB(scene: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: "model/gltf-binary" }));
        } else {
          resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
        }
      },
      (err) => reject(err),
      { binary: true },
    );
  });
}
