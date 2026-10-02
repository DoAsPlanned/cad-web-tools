import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';

const canvas = document.getElementById('viewport');
const fileInput = document.getElementById('file-input');
const filePickerButton = document.getElementById('file-picker-btn');
const fileNameNode = document.getElementById('file-name');
const fitViewButton = document.getElementById('fit-view-btn');
const statusNode = document.getElementById('status');
const modeButtons = [...document.querySelectorAll('[data-mode]')];

const scene = new THREE.Scene();
const defaultSceneBackground = new THREE.Color(0xaaaaaa);
scene.background = defaultSceneBackground.clone();

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
camera.position.set(220, 180, 260);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

scene.add(new THREE.AmbientLight(0xffffff, 1.35));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(240, 180, 220);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 1.1);
fillLight.position.set(-180, -90, -140);
scene.add(fillLight);

let currentModelRoot = null;
let currentTextureDisplayMode = 'base';
let occtImporterPromise = null;
let effectComposer = null;
let renderPass = null;
let outlinePass = null;

function setStatus(message) {
  statusNode.textContent = message;
}

function setSelectedFileName(name = '') {
  fileNameNode.textContent = name || 'Файл не выбран';
}

function initPostprocessing() {
  if (effectComposer) {
    return;
  }

  effectComposer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  outlinePass = new OutlinePass(
    new THREE.Vector2(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight),
    scene,
    camera,
    []
  );

  outlinePass.enabled = false;
  outlinePass.visibleEdgeColor.set(0x000000);
  outlinePass.hiddenEdgeColor.set(0x000000);
  outlinePass.edgeGlow = 0;
  outlinePass.edgeStrength = 14;
  outlinePass.edgeThickness = 3.2;
  outlinePass.downSampleRatio = 1;
  outlinePass.pulsePeriod = 0;

  effectComposer.addPass(renderPass);
  effectComposer.addPass(outlinePass);
}

function getOcctImporter() {
  if (!window.occtimportjs) {
    throw new Error('Не удалось загрузить occt-import-js');
  }

  if (!occtImporterPromise) {
    occtImporterPromise = window.occtimportjs({
      locateFile: (fileName) => {
        if (fileName.endsWith('.wasm')) {
          return './vendor/occt-import-js/occt-import-js.wasm';
        }
        return fileName;
      }
    });
  }

  return occtImporterPromise;
}

function toUint8Array(inputData) {
  if (inputData instanceof Uint8Array) {
    return inputData;
  }
  if (ArrayBuffer.isView(inputData)) {
    return new Uint8Array(inputData.buffer, inputData.byteOffset, inputData.byteLength);
  }
  if (inputData instanceof ArrayBuffer) {
    return new Uint8Array(inputData);
  }
  throw new Error('Неподдерживаемый тип данных модели');
}

function normalizeColorComponent(component) {
  const numeric = Number(component);
  if (!Number.isFinite(numeric)) {
    return 0.75;
  }
  if (numeric > 1) {
    return THREE.MathUtils.clamp(numeric / 255, 0, 1);
  }
  return THREE.MathUtils.clamp(numeric, 0, 1);
}

function createStepMaterial(meshData) {
  const rawColor = Array.isArray(meshData?.color) ? meshData.color : [190, 190, 190];

  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      normalizeColorComponent(rawColor[0]),
      normalizeColorComponent(rawColor[1]),
      normalizeColorComponent(rawColor[2])
    ),
    roughness: 0.55,
    metalness: 0.1,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide
  });
}

function buildThreeStepMesh(meshData, meshIndex) {
  const positionArray = meshData?.attributes?.position?.array;
  const indexArray = meshData?.index?.array;
  if (!Array.isArray(positionArray) || !Array.isArray(indexArray) || positionArray.length === 0 || indexArray.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3));

  if (Array.isArray(meshData?.attributes?.normal?.array) && meshData.attributes.normal.array.length === positionArray.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.attributes.normal.array, 3));
  } else {
    geometry.computeVertexNormals();
  }

  geometry.setIndex(indexArray);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, createStepMaterial(meshData));
  mesh.name = meshData?.name || `STEP_Mesh_${meshIndex}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildStepHierarchyNode(nodeData, meshTemplates) {
  const nodeGroup = new THREE.Group();
  nodeGroup.name = nodeData?.name || 'STEP_Node';

  const meshIndices = Array.isArray(nodeData?.meshes) ? nodeData.meshes : [];
  meshIndices.forEach((meshIndex) => {
    const template = meshTemplates[meshIndex];
    if (!template) {
      return;
    }

    const meshClone = template.clone();
    meshClone.geometry = template.geometry;
    meshClone.material = Array.isArray(template.material)
      ? template.material.map((material) => material.clone())
      : template.material.clone();
    nodeGroup.add(meshClone);
  });

  const children = Array.isArray(nodeData?.children) ? nodeData.children : [];
  children.forEach((childNode) => {
    nodeGroup.add(buildStepHierarchyNode(childNode, meshTemplates));
  });

  return nodeGroup;
}

async function createStepObject3D(stepBuffer) {
  const occt = await getOcctImporter();
  const stepData = toUint8Array(stepBuffer);
  const result = occt.ReadStepFile(stepData, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.0015, // Было 0.0015
    angularDeflection: 0.3 // Было 0.3
  });

  if (!result?.success) {
    throw new Error(result?.error || 'Не удалось импортировать STEP/STP файл');
  }

  const meshTemplates = (result.meshes || [])
    .map((meshData, meshIndex) => buildThreeStepMesh(meshData, meshIndex))
    .filter(Boolean);

  if (meshTemplates.length === 0) {
    throw new Error('STEP/STP файл импортирован, но не содержит мешей');
  }

  if (result.root) {
    return buildStepHierarchyNode(result.root, meshTemplates);
  }

  const fallbackGroup = new THREE.Group();
  fallbackGroup.name = 'STEP_Model';
  meshTemplates.forEach((template) => fallbackGroup.add(template.clone()));
  return fallbackGroup;
}

function getTextureDisplayMeshes(root = currentModelRoot) {
  const meshes = [];
  if (!root) {
    return meshes;
  }

  root.traverse((object) => {
    if (!object.isMesh || object.userData?.isTextureDisplayHelper) {
      return;
    }
    meshes.push(object);
  });

  return meshes;
}

function getAllMaterials(root = currentModelRoot) {
  const materials = [];
  root?.traverse((object) => {
    if (!object.isMesh) {
      return;
    }
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => {
      if (material && !materials.includes(material)) {
        materials.push(material);
      }
    });
  });
  return materials;
}

function rememberTextureDisplayMaterialState(material) {
  if (!material) {
    return;
  }

  material.userData = material.userData || {};

  if (material.userData.textureDisplayOriginalColor === undefined && material.color) {
    material.userData.textureDisplayOriginalColor = material.color.clone();
  }
  if (material.userData.textureDisplayOriginalEmissive === undefined && material.emissive) {
    material.userData.textureDisplayOriginalEmissive = material.emissive.clone();
  }
  if (material.userData.textureDisplayOriginalMap === undefined) {
    material.userData.textureDisplayOriginalMap = material.map ?? null;
  }
  if (material.userData.textureDisplayOriginalEmissiveMap === undefined) {
    material.userData.textureDisplayOriginalEmissiveMap = material.emissiveMap ?? null;
  }
  if (material.userData.textureDisplayOriginalAlphaMap === undefined) {
    material.userData.textureDisplayOriginalAlphaMap = material.alphaMap ?? null;
  }
  if (material.userData.textureDisplayOriginalTransparent === undefined) {
    material.userData.textureDisplayOriginalTransparent = material.transparent ?? false;
  }
  if (material.userData.textureDisplayOriginalOpacity === undefined) {
    material.userData.textureDisplayOriginalOpacity = material.opacity ?? 1;
  }
  if (material.userData.textureDisplayOriginalDepthWrite === undefined) {
    material.userData.textureDisplayOriginalDepthWrite = material.depthWrite ?? true;
  }
  if (material.userData.textureDisplayOriginalDepthTest === undefined) {
    material.userData.textureDisplayOriginalDepthTest = material.depthTest ?? true;
  }
  if (material.userData.textureDisplayOriginalPolygonOffset === undefined) {
    material.userData.textureDisplayOriginalPolygonOffset = material.polygonOffset ?? false;
  }
  if (material.userData.textureDisplayOriginalPolygonOffsetFactor === undefined) {
    material.userData.textureDisplayOriginalPolygonOffsetFactor = material.polygonOffsetFactor ?? 0;
  }
  if (material.userData.textureDisplayOriginalPolygonOffsetUnits === undefined) {
    material.userData.textureDisplayOriginalPolygonOffsetUnits = material.polygonOffsetUnits ?? 0;
  }
  if (material.userData.textureDisplayOriginalRoughness === undefined) {
    material.userData.textureDisplayOriginalRoughness = material.roughness;
  }
  if (material.userData.textureDisplayOriginalMetalness === undefined) {
    material.userData.textureDisplayOriginalMetalness = material.metalness;
  }
  if (material.userData.textureDisplayOriginalVertexColors === undefined) {
    material.userData.textureDisplayOriginalVertexColors = material.vertexColors;
  }
  if (material.userData.textureDisplayOriginalSide === undefined && 'side' in material) {
    material.userData.textureDisplayOriginalSide = material.side;
  }
  if (material.userData.textureDisplayOriginalFlatShading === undefined) {
    material.userData.textureDisplayOriginalFlatShading = material.flatShading;
  }
  if (material.userData.textureDisplayOriginalEnvMap === undefined && 'envMap' in material) {
    material.userData.textureDisplayOriginalEnvMap = material.envMap ?? null;
  }
  if (material.userData.textureDisplayOriginalEnvMapIntensity === undefined && 'envMapIntensity' in material) {
    material.userData.textureDisplayOriginalEnvMapIntensity = material.envMapIntensity ?? 1;
  }
}

function restoreTextureDisplayMaterialState(material) {
  if (!material?.userData) {
    return;
  }

  if (material.color && material.userData.textureDisplayOriginalColor) {
    material.color.copy(material.userData.textureDisplayOriginalColor);
  }
  if (material.emissive && material.userData.textureDisplayOriginalEmissive) {
    material.emissive.copy(material.userData.textureDisplayOriginalEmissive);
  }
  if ('map' in material) {
    material.map = material.userData.textureDisplayOriginalMap ?? null;
  }
  if ('emissiveMap' in material) {
    material.emissiveMap = material.userData.textureDisplayOriginalEmissiveMap ?? null;
  }
  if ('alphaMap' in material) {
    material.alphaMap = material.userData.textureDisplayOriginalAlphaMap ?? null;
  }
  material.transparent = material.userData.textureDisplayOriginalTransparent ?? false;
  material.opacity = material.userData.textureDisplayOriginalOpacity ?? 1;
  material.depthWrite = material.userData.textureDisplayOriginalDepthWrite ?? true;
  material.depthTest = material.userData.textureDisplayOriginalDepthTest ?? true;
  material.polygonOffset = material.userData.textureDisplayOriginalPolygonOffset ?? false;
  material.polygonOffsetFactor = material.userData.textureDisplayOriginalPolygonOffsetFactor ?? 0;
  material.polygonOffsetUnits = material.userData.textureDisplayOriginalPolygonOffsetUnits ?? 0;
  if ('roughness' in material && material.userData.textureDisplayOriginalRoughness !== undefined) {
    material.roughness = material.userData.textureDisplayOriginalRoughness;
  }
  if ('metalness' in material && material.userData.textureDisplayOriginalMetalness !== undefined) {
    material.metalness = material.userData.textureDisplayOriginalMetalness;
  }
  if ('vertexColors' in material && material.userData.textureDisplayOriginalVertexColors !== undefined) {
    material.vertexColors = material.userData.textureDisplayOriginalVertexColors;
  }
  if ('side' in material && material.userData.textureDisplayOriginalSide !== undefined) {
    material.side = material.userData.textureDisplayOriginalSide;
  }
  if ('flatShading' in material && material.userData.textureDisplayOriginalFlatShading !== undefined) {
    material.flatShading = material.userData.textureDisplayOriginalFlatShading;
  }
  if ('envMap' in material) {
    material.envMap = material.userData.textureDisplayOriginalEnvMap ?? null;
  }
  if ('envMapIntensity' in material && material.userData.textureDisplayOriginalEnvMapIntensity !== undefined) {
    material.envMapIntensity = material.userData.textureDisplayOriginalEnvMapIntensity;
  }
}

function applySilhouetteShader(material) {
  material.userData.textureDisplaySilhouetteUniforms = null;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.textureDisplayOutlineThickness = { value: 2.4 };
    shader.uniforms.textureDisplayOutlineBias = { value: 0.08 };
    shader.uniforms.textureDisplayOutlinePower = { value: 1.35 };
    shader.uniforms.textureDisplayOutlineResolution = {
      value: new THREE.Vector2(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight)
    };
    material.userData.textureDisplaySilhouetteUniforms = shader.uniforms;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float textureDisplayOutlineThickness;
uniform float textureDisplayOutlineBias;
uniform float textureDisplayOutlinePower;
uniform vec2 textureDisplayOutlineResolution;`
      )
      .replace(
        '#include <project_vertex>',
        `
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normal);
        vec3 viewDir = normalize(-mvPosition.xyz);

        float ndotv = abs(dot(viewNormal, viewDir));
        float edgeFactor = pow(
          clamp(1.0 - ndotv - textureDisplayOutlineBias, 0.0, 1.0),
          textureDisplayOutlinePower
        );

        vec4 clipPosition = projectionMatrix * mvPosition;
        vec2 projectedNormal = (projectionMatrix * vec4(viewNormal.xy, 0.0, 0.0)).xy;
        float projectedNormalLength = max(length(projectedNormal), 1e-5);
        vec2 outlineDir = projectedNormal / projectedNormalLength;
        vec2 outlineOffset = outlineDir
          * edgeFactor
          * textureDisplayOutlineThickness
          * 2.0
          * clipPosition.w
          / textureDisplayOutlineResolution;

        clipPosition.xy += outlineOffset;
        gl_Position = clipPosition;
        `
      );
  };

  material.customProgramCacheKey = () => 'texture-display-silhouette-v3';
}
function ensureTextureDisplayHelpers(root = currentModelRoot) {
  const meshes = getTextureDisplayMeshes(root);

  meshes.forEach((mesh) => {
    if (!mesh.userData.textureDisplayOriginalMaterial) {
      mesh.userData.textureDisplayOriginalMaterial = mesh.material;
    }

    const originalMaterials = Array.isArray(mesh.userData.textureDisplayOriginalMaterial)
      ? mesh.userData.textureDisplayOriginalMaterial
      : [mesh.userData.textureDisplayOriginalMaterial];

    originalMaterials.forEach((material) => {
      rememberTextureDisplayMaterialState(material);
    });

    if (mesh.userData.textureDisplayOriginalCastShadow === undefined) {
      mesh.userData.textureDisplayOriginalCastShadow = mesh.castShadow;
    }
    if (mesh.userData.textureDisplayOriginalReceiveShadow === undefined) {
      mesh.userData.textureDisplayOriginalReceiveShadow = mesh.receiveShadow;
    }
    if (mesh.userData.textureDisplaySilhouetteThickness === undefined) {
      mesh.geometry.computeBoundingSphere();
      const radius = mesh.geometry.boundingSphere?.radius ?? 1;
      mesh.userData.textureDisplaySilhouetteThickness = Math.max(1.5, radius * 0.06);
    }

    if (!mesh.userData.textureDisplayEdges && mesh.geometry) {
      const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 20);
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x000000,
        transparent: false,
        depthTest: false,
        toneMapped: false
      });
      const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      edges.name = `${mesh.name || 'mesh'}-texture-edges`;
      edges.userData.isTextureDisplayHelper = true;
      edges.raycast = () => null;
      edges.visible = false;
      edges.renderOrder = 250;
      mesh.add(edges);
      mesh.userData.textureDisplayEdges = edges;

      const fatEdgePositions = edgeGeometry.getAttribute('position');
      const fatEdgeGeometry = new LineSegmentsGeometry();
      fatEdgeGeometry.setPositions(fatEdgePositions.array);

      const fatEdgeMaterial = new LineMaterial({
        color: 0x000000,
        linewidth: 3.6,
        worldUnits: false,
        transparent: false,
        depthTest: true,
        toneMapped: false
      });
      fatEdgeMaterial.resolution.set(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);

      const fatEdges = new LineSegments2(fatEdgeGeometry, fatEdgeMaterial);
      fatEdges.name = `${mesh.name || 'mesh'}-texture-edges-fat`;
      fatEdges.userData.isTextureDisplayHelper = true;
      fatEdges.raycast = () => null;
      fatEdges.visible = false;
      fatEdges.renderOrder = 251;
      mesh.add(fatEdges);
      mesh.userData.textureDisplayFatEdges = fatEdges;

      const silhouette = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          side: THREE.BackSide,
          depthTest: true,
          depthWrite: false,
          toneMapped: false
        })
      );
      silhouette.name = `${mesh.name || 'mesh'}-texture-silhouette`;
      silhouette.userData.isTextureDisplayHelper = true;
      silhouette.raycast = () => null;
      silhouette.visible = false;
      silhouette.renderOrder = 240;
      applySilhouetteShader(silhouette.material);
      mesh.add(silhouette);
      mesh.userData.textureDisplaySilhouette = silhouette;
    }
  });
}

function updateModeButtons() {
  const hasModel = Boolean(currentModelRoot);
  modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === currentTextureDisplayMode;
    button.classList.toggle('active', isActive);
    button.disabled = !hasModel;
  });
  fitViewButton.disabled = !hasModel;
}

function updateClayOutlinePass() {
  if (!outlinePass) {
    return;
  }

  const clayActive = currentTextureDisplayMode === 'clay' && Boolean(currentModelRoot);
  outlinePass.enabled = false;
  outlinePass.selectedObjects = [];
}

function applyTextureDisplayMode(mode = currentTextureDisplayMode) {
  currentTextureDisplayMode = mode;

  if (!currentModelRoot) {
    updateModeButtons();
    setStatus('Сначала загрузите STEP/STP файл.');
    return;
  }

  ensureTextureDisplayHelpers(currentModelRoot);

  const materials = getAllMaterials(currentModelRoot);
  const meshes = getTextureDisplayMeshes(currentModelRoot);

  materials.forEach((material) => {
    rememberTextureDisplayMaterialState(material);
    restoreTextureDisplayMaterialState(material);

    if (mode === 'gray') {
      if (material.color) material.color.set(0x9ca3af);
      if (material.emissive) material.emissive.set(0x000000);
      if ('map' in material) material.map = null;
      if ('emissiveMap' in material) material.emissiveMap = null;
      if ('alphaMap' in material) material.alphaMap = null;
      if ('vertexColors' in material) material.vertexColors = false;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.depthTest = true;
      if ('roughness' in material) material.roughness = 0.84;
      if ('metalness' in material) material.metalness = 0.04;
    } else if (mode === 'transparent') {
      if (material.color) material.color.set(0xffffff);
      if (material.emissive) material.emissive.set(0x000000);
      if ('map' in material) material.map = null;
      if ('emissiveMap' in material) material.emissiveMap = null;
      if ('alphaMap' in material) material.alphaMap = null;
      if ('vertexColors' in material) material.vertexColors = false;
      material.transparent = true;
      material.opacity = 0.03;
      material.depthWrite = false;
      material.depthTest = true;
      if ('roughness' in material) material.roughness = 1;
      if ('metalness' in material) material.metalness = 0;
    } else if (mode === 'tint30') {
      if (material.emissive) material.emissive.set(0x000000);
      material.transparent = true;
      material.opacity = 0.3;
      material.depthWrite = false;
      material.depthTest = true;
    } else if (mode === 'clay') {
      if (material.color) material.color.set(0xffffff);
      if (material.emissive) material.emissive.set(0xffffff);
      if ('map' in material) material.map = null;
      if ('emissiveMap' in material) material.emissiveMap = null;
      if ('alphaMap' in material) material.alphaMap = null;
      if ('envMap' in material) material.envMap = null;
      if ('envMapIntensity' in material) material.envMapIntensity = 0;
      if ('vertexColors' in material) material.vertexColors = false;
      if ('side' in material) material.side = THREE.FrontSide;
      if ('flatShading' in material) material.flatShading = false;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.depthTest = true;
      material.polygonOffset = true;
      material.polygonOffsetFactor = 2;
      material.polygonOffsetUnits = 2;
      if ('roughness' in material) material.roughness = 1;
      if ('metalness' in material) material.metalness = 0;
    }

    material.needsUpdate = true;
  });

  meshes.forEach((mesh) => {
    if (mesh.userData.textureDisplayEdges) {
      mesh.userData.textureDisplayEdges.visible = mode !== 'base' && mode !== 'tint30';
      if (mesh.userData.textureDisplayEdges.material) {
        mesh.userData.textureDisplayEdges.material.depthTest = mode === 'clay';
        mesh.userData.textureDisplayEdges.material.needsUpdate = true;
      }
    }
    if (mesh.userData.textureDisplayFatEdges) {
      mesh.userData.textureDisplayFatEdges.visible = mode === 'clay';
      if (mesh.userData.textureDisplayFatEdges.material) {
        mesh.userData.textureDisplayFatEdges.material.color.set(0x000000);
        mesh.userData.textureDisplayFatEdges.material.depthTest = true;
        mesh.userData.textureDisplayFatEdges.material.linewidth = mode === 'clay' ? 2.4 : 3.6;
        mesh.userData.textureDisplayFatEdges.material.resolution.set(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
        mesh.userData.textureDisplayFatEdges.material.needsUpdate = true;
      }
      mesh.userData.textureDisplayFatEdges.renderOrder = mode === 'clay' ? 255 : 251;
    }
    if (mesh.userData.textureDisplaySilhouette) {
      mesh.userData.textureDisplaySilhouette.visible = mode === 'clay';
      if (mesh.userData.textureDisplaySilhouette.material) {
        mesh.userData.textureDisplaySilhouette.material.color.set(0x000000);
        mesh.userData.textureDisplaySilhouette.material.side = THREE.BackSide;
        mesh.userData.textureDisplaySilhouette.material.depthTest = true;
        mesh.userData.textureDisplaySilhouette.material.depthWrite = false;
        mesh.userData.textureDisplaySilhouette.material.transparent = false;
        mesh.userData.textureDisplaySilhouette.material.toneMapped = false;
        const silhouetteUniforms = mesh.userData.textureDisplaySilhouette.material.userData?.textureDisplaySilhouetteUniforms;
        if (silhouetteUniforms?.textureDisplayOutlineThickness) {
          silhouetteUniforms.textureDisplayOutlineThickness.value = Math.max(
            2.0,
            (mesh.userData.textureDisplaySilhouetteThickness ?? 1.2) * 0.75
          );
        }
        if (silhouetteUniforms?.textureDisplayOutlineResolution) {
          silhouetteUniforms.textureDisplayOutlineResolution.value.set(
            canvas.clientWidth || window.innerWidth,
            canvas.clientHeight || window.innerHeight
          );
        }
        if (silhouetteUniforms?.textureDisplayOutlineBias) {
          silhouetteUniforms.textureDisplayOutlineBias.value = 0.05;
        }
        if (silhouetteUniforms?.textureDisplayOutlinePower) {
          silhouetteUniforms.textureDisplayOutlinePower.value = 1.15;
        }
        mesh.userData.textureDisplaySilhouette.renderOrder = 260;
        mesh.userData.textureDisplaySilhouette.material.needsUpdate = true;
      }
    }
    mesh.castShadow = mode === 'clay'
      ? false
      : (mesh.userData.textureDisplayOriginalCastShadow ?? mesh.castShadow);
    mesh.receiveShadow = mode === 'clay'
      ? false
      : (mesh.userData.textureDisplayOriginalReceiveShadow ?? mesh.receiveShadow);
    mesh.visible = true;
    mesh.userData.textureDisplayMode = mode;
  });

  scene.background = mode === 'clay'
    ? new THREE.Color(0xffffff)
    : defaultSceneBackground.clone();

  updateClayOutlinePass();
  updateModeButtons();

  const modeLabelMap = {
    base: 'Базовый',
    gray: 'Серая с контурами',
    transparent: 'Прозрачная с контурами',
    tint30: 'Цветная 30%',
    clay: 'Светлая техническая'
  };

  setStatus(`Модель загружена.\nТекущий режим: ${modeLabelMap[mode]}.`);
}

function centerAndFitModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 1);

  root.position.sub(center);

  const fittedBox = new THREE.Box3().setFromObject(root);
  const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
  const fittedSize = fittedBox.getSize(new THREE.Vector3());
  const fittedMaxSize = Math.max(fittedSize.x, fittedSize.y, fittedSize.z, maxSize, 1);

  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = fittedMaxSize / (2 * Math.tan(fov / 2)) * 1.6;

  camera.near = Math.max(fittedMaxSize / 1000, 0.1);
  camera.far = Math.max(distance * 8, 1000);
  camera.updateProjectionMatrix();

  camera.position.set(distance, distance * 0.75, distance);
  controls.target.copy(fittedCenter);
  controls.update();

}

function clearCurrentModel() {
  if (!currentModelRoot) {
    return;
  }

  scene.remove(currentModelRoot);
  currentModelRoot.traverse((object) => {
    if (object.userData?.textureDisplayEdges) {
      object.userData.textureDisplayEdges.geometry.dispose();
      object.userData.textureDisplayEdges.material.dispose();
    }
    if (object.userData?.textureDisplayFatEdges) {
      object.userData.textureDisplayFatEdges.geometry.dispose();
      object.userData.textureDisplayFatEdges.material.dispose();
    }
    if (object.userData?.textureDisplaySilhouette) {
      object.userData.textureDisplaySilhouette.material.dispose();
    }
    if (object.isMesh) {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material?.dispose?.());
    }
  });
  currentModelRoot = null;
}

async function handleFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    setSelectedFileName(file.name);
    setStatus(`Загрузка ${file.name}...`);
    const buffer = await file.arrayBuffer();
    const stepObject = await createStepObject3D(buffer);

    clearCurrentModel();
    currentModelRoot = new THREE.Group();
    currentModelRoot.name = file.name;
    currentModelRoot.add(stepObject);
    scene.add(currentModelRoot);

    centerAndFitModel(currentModelRoot);
    applyTextureDisplayMode(currentTextureDisplayMode);
  } catch (error) {
    clearCurrentModel();
    updateModeButtons();
    setStatus(`Ошибка загрузки:\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function resizeRenderer() {
  const width = canvas.clientWidth || canvas.parentElement.clientWidth;
  const height = canvas.clientHeight || canvas.parentElement.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  effectComposer?.setSize(width, height);
  effectComposer?.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  outlinePass?.setSize(width, height);

  getTextureDisplayMeshes(currentModelRoot).forEach((mesh) => {
    const fatEdgeMaterial = mesh.userData.textureDisplayFatEdges?.material;
    if (fatEdgeMaterial?.resolution) {
      fatEdgeMaterial.resolution.set(width, height);
    }
    const silhouetteUniforms = mesh.userData.textureDisplaySilhouette?.material?.userData?.textureDisplaySilhouetteUniforms;
    if (silhouetteUniforms?.textureDisplayOutlineResolution) {
      silhouetteUniforms.textureDisplayOutlineResolution.value.set(width, height);
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (outlinePass?.enabled && effectComposer) {
    effectComposer.render();
  } else {
    renderer.render(scene, camera);
  }
}

fileInput.addEventListener('change', handleFileSelection);
filePickerButton.addEventListener('click', () => {
  fileInput.click();
});
fitViewButton.addEventListener('click', () => {
  if (currentModelRoot) {
    centerAndFitModel(currentModelRoot);
  }
});

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    applyTextureDisplayMode(button.dataset.mode || 'base');
  });
});

window.addEventListener('resize', resizeRenderer);

updateModeButtons();
setSelectedFileName('');
initPostprocessing();
resizeRenderer();
animate();
