import test from 'node:test';
import assert from 'node:assert/strict';
import { Post } from '../src/view/post.js';

function controller(ceiling = 1) {
  return Object.assign(Object.create(Post.prototype), { autoResolution:true, resolutionScale:ceiling, resolutionCeiling:ceiling,
    _resolutionAge:0, _resolutionMs:16.7, _applyInternalSize() {}, cut() {} });
}
test('sustained slow frames reduce resolution, transient stalls do not, and the manual ceiling is respected', () => {
  const post = controller();
  for (let i = 0; i < 120; i++) post.adaptResolution(33.3);
  assert.ok(post.resolutionScale < 1 && post.resolutionScale >= .65);
  const scale = post.resolutionScale;
  post.adaptResolution(2000);
  assert.equal(post.resolutionScale, scale);
  const low = controller(.5);
  for (let i = 0; i < 800; i++) low.adaptResolution(33.3);
  assert.equal(low.resolutionScale, .5);
  for (let i = 0; i < 1000; i++) low.adaptResolution(16.6);
  assert.equal(low.resolutionScale, .5);
});
test('automatic resolution can be disabled and recovery never exceeds the selected scale', () => {
  const post = controller(.8);
  post.autoResolution = false;
  for (let i = 0; i < 500; i++) post.adaptResolution(40);
  assert.equal(post.resolutionScale,.8);
  post.autoResolution = true; post.resolutionScale = .65;
  for (let i = 0; i < 2500; i++) post.adaptResolution(16.6);
  assert.ok(post.resolutionScale > .65 && post.resolutionScale <= .8);
});
