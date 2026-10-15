// Node prototype of the hero/person matte: u2netp.onnx (U^2-Net small, Apache-2.0, 4.6MB) via onnxruntime-node.
// Download: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx  (github releases work in the sandbox)
// usage in a script:  import { makeRunner } from './matte_node.mjs';  await SizyMatte.attach(img, elements, await makeRunner(path))
import * as ort from 'onnxruntime-node';
export async function makeRunner(modelPath) {
  const sess = await ort.InferenceSession.create(modelPath);
  return async t => {
    const r = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, 320, 320]) });
    return r[sess.outputNames[0]].data; // d0: fused side output, 320x320
  };
}
