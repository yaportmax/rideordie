// ScenePass: renders the scene into an HDR (half-float) target and hands the result to the composer's ping-pong
// buffers. When MSAA is on, the scene goes into a PRIVATE multisampled target which is resolved (blit) into the
// composer's plain input buffer, so none of the fullscreen post passes ever renders into a multisampled target
// (pmndrs' `multisampling` option would make every ping-pong write MSAA). The resolved depth is blitted straight
// into the composer's stable depth texture that every depth-aware pass reads.
import { Pass } from 'postprocessing';
import { WebGLRenderTarget, DepthTexture, FloatType, HalfFloatType, LinearFilter, NoColorSpace } from 'three';

export class ScenePass extends Pass {
  /**
   * @param scene, camera
   * @param {{samples:number, type:number, getDepthTarget:()=>WebGLRenderTarget|null}} o
   */
  constructor(scene, camera, { samples = 0, type = HalfFloatType, getDepthTarget = () => null } = {}) {
    super('ScenePass', scene, camera);
    this.needsSwap = false;
    this.needsDepthBlit = true;
    this.samples = 0;
    this.type = type;
    this.getDepthTarget = getDepthTarget;
    this.rt = null;
    this.w = 1; this.h = 1;
    this.setSamples(samples);
  }

  set mainScene(v) { this.scene = v; }
  set mainCamera(v) { this.camera = v; }

  setSamples(n) {
    n = Math.max(0, n | 0);
    if (n === this.samples && (n === 0) === (this.rt === null)) return;
    this.samples = n;
    if (this.rt) { this.rt.dispose(); this.rt.depthTexture?.dispose(); this.rt = null; }
    if (n > 0) {
      const rt = new WebGLRenderTarget(this.w, this.h, {
        type: this.type, samples: n, depthBuffer: true, stencilBuffer: false,
        minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
      });
      rt.texture.colorSpace = NoColorSpace;
      rt.texture.name = 'ScenePass.Color';
      const dt = new DepthTexture(this.w, this.h);
      dt.type = FloatType; dt.name = 'ScenePass.Depth';
      rt.depthTexture = dt;
      this.rt = rt;
    }
  }

  setSize(w, h) {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    if (this.rt) this.rt.setSize(this.w, this.h);
  }

  render(renderer, inputBuffer) {
    const rt = this.rt;
    renderer.setRenderTarget(rt || inputBuffer);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
    if (!rt) { this.needsDepthBlit = true; return; }
    // resolve: multisampled -> composer input (colour) and stable depth target (depth)
    const gl = renderer.getContext();
    const props = renderer.properties;
    const src = props.get(rt).__webglFramebuffer;
    renderer.setRenderTarget(inputBuffer);
    const dstColor = props.get(inputBuffer).__webglFramebuffer;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstColor);
    gl.blitFramebuffer(0, 0, rt.width, rt.height, 0, 0, inputBuffer.width, inputBuffer.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    const depthRT = this.getDepthTarget();
    if (depthRT) {
      renderer.setRenderTarget(depthRT);
      const dstDepth = props.get(depthRT).__webglFramebuffer;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstDepth);
      gl.blitFramebuffer(0, 0, rt.width, rt.height, 0, 0, depthRT.width, depthRT.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    renderer.setRenderTarget(null);
    this.needsDepthBlit = false;
  }

  dispose() {
    if (this.rt) { this.rt.dispose(); this.rt.depthTexture?.dispose(); this.rt = null; }
  }
}
