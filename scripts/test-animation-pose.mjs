/**
 * Headless (no WebGL) check: Animation.apply at different times yields different poses.
 * Catches the “all frames identical” bake bug without a browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AtlasAttachmentLoader,
  MixBlend,
  MixDirection,
  Physics,
  Skeleton,
  SkeletonJson,
  TextureAtlas,
} from '@esotericsoftware/spine-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test-fixtures', 'spineboy');

function applyPose(skeleton, animation, time, skinName) {
  skeleton.setSkinByName(skinName);
  skeleton.setToSetupPose();
  const duration = Math.max(animation.duration, 0);
  const t = duration <= 0 ? 0 : Math.min(Math.max(time, 0), duration);
  animation.apply(skeleton, -1, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
  skeleton.updateWorldTransform(Physics.update);
}

function poseSignature(skeleton) {
  // Sample a few bones’ world transforms — enough to detect motion.
  const names = ['hip', 'torso', 'head', 'rear-upper-leg', 'front-upper-leg', 'root'];
  const parts = [];
  for (const name of names) {
    const bone = skeleton.findBone(name);
    if (!bone) continue;
    parts.push(
      `${name}:${bone.worldX.toFixed(3)},${bone.worldY.toFixed(3)},${bone.a.toFixed(3)},${bone.b.toFixed(3)}`,
    );
  }
  return parts.join('|');
}

function main() {
  const jsonText = fs.readFileSync(path.join(fixtures, 'spineboy-pro.json'), 'utf8');
  const atlasText = fs.readFileSync(path.join(fixtures, 'spineboy.atlas'), 'utf8');
  const atlas = new TextureAtlas(atlasText);
  const skeletonJson = new SkeletonJson(new AtlasAttachmentLoader(atlas));
  const skeletonData = skeletonJson.readSkeletonData(jsonText);
  const skeleton = new Skeleton(skeletonData);
  const skinName = skeletonData.skins[0]?.name || 'default';

  const animName =
    ['walk', 'run', 'idle', 'jump'].find((n) => skeletonData.findAnimation(n)) ||
    skeletonData.animations[0]?.name;
  const animation = skeletonData.findAnimation(animName);
  if (!animation) throw new Error('No animation found');

  console.log(
    `animation=${animName} duration=${animation.duration.toFixed(3)}s timelines=${animation.timelines.length}`,
  );

  const times = [0, animation.duration * 0.25, animation.duration * 0.5, animation.duration * 0.75];
  const sigs = times.map((t) => {
    applyPose(skeleton, animation, t, skinName);
    const sig = poseSignature(skeleton);
    console.log(`t=${t.toFixed(3)} → ${sig.slice(0, 120)}…`);
    return sig;
  });

  const unique = new Set(sigs);
  if (unique.size < 2) {
    throw new Error('Poses identical across times — animation.apply bake is broken');
  }
  console.log(`OK: ${unique.size}/${sigs.length} unique poses for ${animName}`);
}

main();
