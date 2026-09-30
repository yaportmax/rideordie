// Real cloned rigs and the built game's own renderer. Owned textures/materials/geometry;
// original Assets blueprints are covered separately by the real-asset CPU tests.
// ASSERT_CLEAN=0 preserves baseline leaks as evidence; =1 requires source cleanup.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.GAME_URL || 'http://localhost:5194';
const clean = process.env.ASSERT_CLEAN !== '0';
const cycles = Number(process.env.CYCLES || 4), cohortSize = Number(process.env.COHORT_SIZE || 4);
assert.ok(Number.isInteger(cycles) && cycles >= 2 && cycles <= 12);
assert.ok(Number.isInteger(cohortSize) && cohortSize >= 2 && cohortSize <= 8);
const output = process.env.QA_OUTPUT || `shots/skeleton-lifecycle/${clean ? 'candidate' : 'baseline'}`;
await mkdir(output, { recursive: true });
const report = { base, cleanRequired: clean, cycles, cohortSize, bundleAssets: [], errors: [], network: [], startedAt: new Date().toISOString() };
let browser, page;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--use-angle=d3d11', '--force_high_performance_gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', error => report.errors.push(error.stack || String(error)));
  page.on('response', response => {
    const url = response.url();
    if (response.status() >= 400 && !url.endsWith('/favicon.ico')) report.network.push({ url, status: response.status() });
    if (/\/assets\/index-[^/?]+\.js(?:\?|$)/.test(url) && !report.bundleAssets.includes(url)) report.bundleAssets.push(url);
  });
  await page.addInitScript(() => localStorage.setItem('rideordie.settings.v1', JSON.stringify({ quality: 0, resScale: 0.5, master: 0 })));
  await page.goto(`${base}/?solo&as=gunner&s=3000&seed=7&weapons=smg`);
  await page.waitForFunction(() => window.__run?.started && window.__run.gunner?.vm?.dedicatedArms && !window.__run.introOutside
    && [...window.__run.states.values()].some(state => state.kind === 'enemy'), null, { timeout: 180000 });
  if (process.env.QA_EXPECTED_BUNDLE) assert.ok(report.bundleAssets.some(url => url.endsWith(`/${process.env.QA_EXPECTED_BUNDLE}`)), 'entry bundle must match the frozen candidate');
  report.lifecycle = await page.evaluate(({ cycles, cohortSize, clean }) => {
    const game = window.__game, run = window.__run, renderer = game.renderer, gl = renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const result = { samples: [], uploads: [], removals: [], vmResourceUploads: [], vmResourceRemovals: [], isolation: [], errors: [], cleanupErrors: [],
      gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      scope: 'owned clone bone textures and runtime VM flash/reticle materials plus quad/shell geometry; shared cache/live siblings; no direct Assets blueprint access or total-GPU-memory claim' };
    const require = (condition, message) => { if (!condition) throw new Error(message); };
    const memory = () => ({ textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs.length });
    const sample = label => { const state = { label, ...memory() }; result.samples.push(state); return state; };
    const skeletons = root => { const found = new Set(); root?.traverse(mesh => { if (mesh.isSkinnedMesh) found.add(mesh.skeleton); }); return [...found]; };
    const signatures = skeleton => skeleton.boneInverses.map(matrix => matrix.elements.join(',')).join('|');
    const meshGeometry = root => { const found = new Set(); root?.traverse(mesh => { if (mesh.isMesh) found.add(mesh.geometry); }); return [...found]; };
    const liveCrew = run.wv.cars.get(1).crew;
    const liveVm = run.gunner.vm;
    const liveRoots = [liveCrew.driver.root, liveCrew.gunner.root, run.gunner.vm.root];
    const protectedLive = liveRoots.flatMap(skeletons).map(skeleton => ({ skeleton, texture: skeleton.boneTexture,
      handle: skeleton.boneTexture && renderer.properties.get(skeleton.boneTexture).__webglTexture, inverse: skeleton.boneInverses, signature: signatures(skeleton) }));
    const frameOwn = Object.hasOwn(game, 'frame'), savedFrame = game.frame;
    const previousTarget = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const savedAutoClear = renderer.autoClear, savedShadow = renderer.shadowMap.enabled;
    const Scene = game.scene.constructor, Camera = game.camera.constructor, Target = game.post.composer.inputBuffer.constructor;
    const scene = new Scene(), camera = new Camera(66, 1, 0.01, 300);
    camera.position.set(0, 3, 20); camera.lookAt(0, 1, 0); scene.add(camera);
    const target = new Target(16, 16), world = new run.wv.constructor({ scene, groundY: () => 0 });
    const states = new Map(), entries = [], tracked = new Set(), geometryListeners = [], vmResources = [], protectedResources = [];
    const uploadedBuffers = new Map(), bufferDataOwn = Object.hasOwn(gl, 'bufferData'), savedBufferData = gl.bufferData;
    const programsOf = material => [...(renderer.properties.get(material).programs?.values() || [])];
    const warmMaterials = game._warmMaterials ? [...game._warmMaterials] : [];
    const warmPrograms = warmMaterials.flatMap(programsOf);
    result.warmMaterials = { present: !!game._warmMaterials, count: game._warmMaterials?.size ?? null,
      materials: warmMaterials.map(material => ({ uuid: material.uuid, programs: programsOf(material).map(program => ({ id: program.id, resident: gl.isProgram(program.program) })) })) };
    const cacheMaterials = new Set(), cacheGeometries = new Set();
    for (const root of [...liveRoots, liveVm.shell]) root?.traverse(mesh => {
      if (!mesh.isMesh) return;
      cacheGeometries.add(mesh.geometry);
      for (const material of [].concat(mesh.material)) cacheMaterials.add(material);
    });
    for (const resource of [...cacheMaterials, ...cacheGeometries, ...warmMaterials]) {
      const record = { resource, events: 0 };
      record.listener = () => record.events++; resource.addEventListener('dispose', record.listener); protectedResources.push(record);
    }
    const livePrograms = [...cacheMaterials].flatMap(programsOf);
    let disposePhase = 'production', sibling, siblingProtected = [], siblingGeometry = [], cleanBeforeRestore, targetDisposed = false;
    const cloneState = (source, id, kind = source.kind) => ({ ...source, id, kind, pos: source.pos.clone().set(0, 0, 0), quat: source.quat.clone().identity(),
      vel: source.vel.clone().set(0, 0, 0), L: source.L.slice(), spin: source.spin.slice(), steer: 0, speed: 0, hp01: 1,
      exploded: false, driverAlive: true, gunnerAlive: true, gunner2Alive: true,
      gunner: { ...(source.gunner || {}), yaw: 0, pitch: 0, fire: false, ads: false, crouch: false, reloading: false },
      gunner2: { ...(source.gunner2 || {}), yaw: 0, pitch: 0, fire: false, ads: false, crouch: false, reloading: false } });
    const draw = () => {
      scene.traverse(mesh => { if (mesh.isMesh) mesh.frustumCulled = false; });
      renderer.setRenderTarget(target); renderer.render(scene, camera); gl.finish();
      require(gl.getError() === 0 && !gl.isContextLost(), 'real renderer failed during cohort draw');
    };
    const exposeVmResources = vm => {
      for (const mesh of [vm.flashStar, vm.flashCone, vm.flashStar2, vm.reticle]) {
        vm.root.add(mesh); mesh.visible = true; mesh.position.set(0, 0, -1);
        mesh.material.uniforms.uI.value = 1;
      }
      vm.root.add(vm.shell); vm.shell.visible = true; vm.shell.position.z = -1;
    };
    const trackVmResources = (vm, label) => {
      const meshes = [vm.flashStar, vm.flashCone, vm.flashStar2, vm.reticle];
      const materials = [...new Set(meshes.map(mesh => mesh.material))];
      const geometries = [...new Set([vm.flashStar.geometry, ...meshGeometry(vm.shell)])];
      require(materials.length === 4 && geometries.length === 3, `${label}: expected four unique flash/reticle materials, one shared quad and two shell geometries`);
      require(materials.every(material => !cacheMaterials.has(material)) && geometries.every(geometry => !cacheGeometries.has(geometry)), `${label}: per-instance VM allocations must not alias live resources`);
      const batch = [];
      for (const resource of [...materials, ...geometries]) {
        const material = resource.isMaterial, programs = material ? programsOf(resource) : [];
        const attributes = material ? [] : [resource.index, ...Object.values(resource.attributes)].filter(Boolean);
        const buffers = attributes.map(attribute => uploadedBuffers.get(attribute.array));
        require(material ? programs.length > 0 && programs.every(program => gl.isProgram(program.program)) : buffers.length > 0 && buffers.every(buffer => buffer && gl.isBuffer(buffer)), `${label}: real VM ${material ? 'material programs' : 'geometry buffers'} were not uploaded`);
        const entry = { resource, label, material, programs, buffers, productionEvents: 0, cleanupEvents: 0 };
        entry.listener = () => { if (disposePhase === 'production') entry.productionEvents++; else entry.cleanupEvents++; };
        resource.addEventListener('dispose', entry.listener); vmResources.push(entry); batch.push(entry);
      }
      result.vmResourceUploads.push({ label, materials: materials.map(material => ({ uuid: material.uuid, programs: programsOf(material).map(program => program.id) })),
        geometries: geometries.map(geometry => ({ uuid: geometry.uuid, buffers: [geometry.index, ...Object.values(geometry.attributes)].filter(Boolean).length })) });
      return batch;
    };
    const removedVmResources = (batch, label, before) => {
      const details = batch.map(entry => ({ uuid: entry.resource.uuid, kind: entry.material ? 'material' : 'geometry', disposeEvents: entry.productionEvents,
        released: entry.material ? !renderer.properties.get(entry.resource).programs : entry.buffers.every(buffer => !gl.isBuffer(buffer)) }));
      const after = sample(`${label}:vm-resources-after-remove`);
      result.vmResourceRemovals.push({ label, before, after, materials: details.filter(detail => detail.kind === 'material').length,
        geometries: details.filter(detail => detail.kind === 'geometry').length, details });
      if (clean) {
        require(details.every(detail => detail.disposeEvents === 1 && detail.released), `${label}: per-instance VM material or geometry survived source disposal`);
        require(after.geometries === before.geometries - 3, `${label}: renderer geometry count did not drop by quad and two shell geometries`);
      }
    };
    const track = (roots, label) => {
      const batch = [];
      for (const skeleton of roots.flatMap(skeletons)) {
        if (tracked.has(skeleton) || !skeleton.boneTexture) continue;
        tracked.add(skeleton);
        const texture = skeleton.boneTexture, handle = renderer.properties.get(texture).__webglTexture;
        require(!!handle && gl.isTexture(handle), `${label}: bone texture was not uploaded to the real GPU`);
        require(entries.every(entry => entry.texture !== texture) && [...protectedLive, ...siblingProtected].every(snapshot => snapshot.texture !== texture), `${label}: separate clones aliased an owned bone texture`);
        const entry = { skeleton, texture, handle, label, uuid: texture.uuid, productionEvents: 0, cleanupEvents: 0 };
        entry.listener = () => { if (disposePhase === 'production') entry.productionEvents++; else entry.cleanupEvents++; };
        texture.addEventListener('dispose', entry.listener); entries.push(entry); batch.push(entry);
        result.uploads.push({ label, skeleton: skeleton.uuid, texture: texture.uuid, width: texture.image.width, height: texture.image.height, resident: true });
      }
      return batch;
    };
    const removed = (batch, label, before) => {
      const details = batch.map(entry => ({ texture: entry.uuid, disposeEvents: entry.productionEvents,
        skeletonTextureCleared: entry.skeleton.boneTexture === null, resident: gl.isTexture(entry.handle) }));
      const after = sample(`${label}:after-remove`);
      result.removals.push({ label, before, after, uploaded: batch.length, released: details.filter(detail => !detail.resident).length, details });
      if (clean) {
        require(batch.length > 0, `${label}: fixture rendered no owned skeleton textures`);
        require(details.every(detail => detail.disposeEvents === 1 && detail.skeletonTextureCleared && !detail.resident), `${label}: owned bone texture survived source disposal`);
        require(after.textures === before.textures - batch.length, `${label}: renderer texture count did not drop by owned uploads`);
      }
    };
    const isolation = label => {
      for (const snapshot of [...protectedLive, ...siblingProtected]) {
        require(snapshot.skeleton.boneInverses === snapshot.inverse && signatures(snapshot.skeleton) === snapshot.signature, `${label}: shared inverse matrices changed`);
        require(snapshot.skeleton.boneTexture === snapshot.texture, `${label}: a live sibling's bone texture changed`);
        if (snapshot.handle) require(gl.isTexture(snapshot.handle), `${label}: a live sibling's GPU texture was freed`);
      }
      require(siblingGeometry.every(record => record.events === 0), `${label}: shared clone geometry was disposed`);
      require(protectedResources.every(record => record.events === 0), `${label}: live/cache material or geometry was disposed`);
      require([...livePrograms, ...warmPrograms].every(program => gl.isProgram(program.program)), `${label}: live/cache shader program was deleted`);
      result.isolation.push({ label, liveSkeletons: protectedLive.length, siblingSkeletons: siblingProtected.length, sharedGeometryIntact: true, sharedInversesIntact: true,
        liveTexturesIntact: true, liveCachedVmResourcesIntact: true, warmProgramsIntact: true });
    };
    try {
      game.frame = function(now) { this.last = now; }; // No normal wv.update can remove fixture IDs or render concurrently.
      gl.bufferData = function(...args) {
        const value = savedBufferData.apply(this, args), data = args[1];
        if (ArrayBuffer.isView(data)) uploadedBuffers.set(data, gl.getParameter(args[0] === gl.ARRAY_BUFFER ? gl.ARRAY_BUFFER_BINDING : gl.ELEMENT_ARRAY_BUFFER_BINDING));
        return value;
      };
      renderer.autoClear = true; renderer.shadowMap.enabled = false;
      if (clean) require(warmMaterials.length === 5 && warmMaterials.filter(material => programsOf(material).length > 0).length >= 4, 'candidate must retain five warm materials and at least four compiled material owners');
      draw(); sample('empty-target');
      const enemySource = [...run.states.values()].find(state => state.kind === 'enemy');
      const siblingState = cloneState(enemySource, 100000); states.set(siblingState.id, siblingState);
      sibling = world.ensure(siblingState); world.update(1 / 60, states, [], {}); draw();
      siblingProtected = skeletons(sibling.view.root).map(skeleton => ({ skeleton, texture: skeleton.boneTexture,
        handle: skeleton.boneTexture && renderer.properties.get(skeleton.boneTexture).__webglTexture, inverse: skeleton.boneInverses, signature: signatures(skeleton) }));
      siblingGeometry = meshGeometry(sibling.view.root).map(geometry => {
        const record = { geometry, events: 0 }; record.listener = () => record.events++;
        geometry.addEventListener('dispose', record.listener); geometryListeners.push(record); return record;
      });
      require(siblingProtected.some(snapshot => snapshot.handle), 'live sibling must upload at least one real skeleton texture');
      sample('persistent-sibling');
      for (let cycle = 0; cycle < cycles; cycle++) {
        const ids = [], roots = [];
        for (let index = 0; index < cohortSize; index++) {
          // Multiples of 64 preserve the deterministic raider type/variant bits.
          const id = 100000 + 64 * (1 + cycle * cohortSize + index), state = cloneState(enemySource, id);
          state.pos.x = (index - (cohortSize - 1) / 2) * 6; states.set(id, state); ids.push(id);
          const rec = world.ensure(state); roots.push(rec.view.root);
          for (const role of Object.keys(rec.crew)) {
            const a = skeletons(rec.crew[role].model), b = skeletons(sibling.crew[role]?.model);
            require(a.every(skeleton => !b.includes(skeleton)), 'separate actual raider clones shared a Skeleton');
            require(a.every(skeleton => b.some(other => other.boneInverses === skeleton.boneInverses)), 'fixture did not use the same original asset inverses');
          }
        }
        world.update(1 / 60, states, [], {}); draw();
        const label = `enemy-cycle-${cycle}`, batch = track(roots, label), before = sample(`${label}:uploaded`);
        require(batch.length >= cohortSize, 'enemy cohort did not upload skinned rigs');
        for (const id of ids) { world.remove(id, true); states.delete(id); }
        removed(batch, label, before); isolation(label); draw();
      }
      for (let cycle = 0; cycle < cycles; cycle++) {
        const state = cloneState(run.states.get(1), 1, 'player'); states.set(1, state);
        const controller = new run.gunner.constructor({ weapons: ['smg'], levels: {}, grenades: 0 }, {});
        const rec = world.ensure(state);
        const localGunner = { firstPerson: true, camera, gunner: controller, eye: camera.position, adsK: 0, bedX: 0, bedZ: 0,
          scoped: false, reloadT: 0, reloadLen: controller.weapon.reload };
        world.update(1 / 60, states, [], { localDriver: { firstPerson: true, cockpit: { active: true }, gear: 1 }, localGunner, playerWeaponId: 'smg' });
        require(rec.crew.driver.drvArms?.ok && rec.crew.gunner.vm?.dedicatedArms, 'actual cockpit arms and dedicated VM must be built');
        exposeVmResources(rec.crew.gunner.vm);
        draw();
        const label = `hero-cockpit-vm-cycle-${cycle}`, batch = track([rec.view.root, rec.crew.gunner.vm.root], label), before = sample(`${label}:uploaded`);
        const owned = trackVmResources(rec.crew.gunner.vm, label);
        require(batch.length >= 4, 'hero/cockpit/VM fixture did not upload all real rig owners');
        world.remove(1, true); rec.crew.gunner.vm.dispose(); states.delete(1);
        removed(batch, label, before); removedVmResources(owned, label, before); isolation(label); draw();
      }
      const ViewModel = run.gunner.vm.constructor, vm = new ViewModel();
      // Keep a disposer immediately, including if the replacement or upload check fails.
      result._vm = vm;
      camera.add(vm.root); vm.setVisible(true); exposeVmResources(vm); draw();
      require(vm.dedicatedArms, 'initial standalone VM must use the actual dedicated arms asset');
      const dedicated = track([vm.root], 'vm-dedicated-before-fallback'), beforeFallback = sample('vm-dedicated:uploaded');
      const ownVm = trackVmResources(vm, 'vm-dedicated-fallback');
      vm._buildArms();
      require(!vm.dedicatedArms && vm.rigged, 'actual hero_gunner fallback path must be exercised');
      removed(dedicated, 'vm-dedicated-to-fallback', beforeFallback);
      draw();
      const fallback = track([vm.root], 'vm-fallback'), beforeFallbackDispose = sample('vm-fallback:uploaded');
      vm.dispose(); vm.dispose(); removed(fallback, 'vm-fallback-dispose', beforeFallbackDispose);
      removedVmResources(ownVm, 'vm-fallback-dispose', beforeFallbackDispose); isolation('vm-fallback-dispose');
      delete result._vm;
      result.beforeFixtureCleanup = sample('complete-before-fixture-cleanup');
      result.sourceCleanupPassed = result.removals.every(removal => removal.details.every(detail => detail.disposeEvents === 1 && detail.skeletonTextureCleared && !detail.resident));
      result.vmResourceCleanupPassed = result.vmResourceRemovals.every(removal => removal.details.every(detail => detail.disposeEvents === 1 && detail.released));
      result.observedLeakedOwnedTextures = entries.filter(entry => gl.isTexture(entry.handle)).length;
      result.observedLeakedVmResources = vmResources.filter(entry => entry.productionEvents === 0).length;
      result.passed = true;
    } catch (error) { result.errors.push(error.stack || String(error)); result.passed = false; }
    finally {
      disposePhase = 'fixture-cleanup';
      try { result._vm?.dispose(); } catch (error) { result.cleanupErrors.push(`standalone VM: ${error}`); }
      delete result._vm;
      try { world.dispose(); } catch (error) { result.cleanupErrors.push(`cohorts: ${error}`); }
      // Baseline leaks are deliberately retained until all removal counts are recorded.
      for (const entry of entries) {
        try { if (gl.isTexture(entry.handle)) entry.skeleton.dispose(); entry.texture.removeEventListener('dispose', entry.listener); }
        catch (error) { result.cleanupErrors.push(`texture ${entry.uuid}: ${error}`); }
      }
      for (const snapshot of siblingProtected) {
        try { if (snapshot.handle && gl.isTexture(snapshot.handle)) snapshot.skeleton.dispose(); }
        catch (error) { result.cleanupErrors.push(`sibling: ${error}`); }
      }
      for (const entry of vmResources) {
        try { if (!entry.productionEvents) entry.resource.dispose(); entry.resource.removeEventListener('dispose', entry.listener); }
        catch (error) { result.cleanupErrors.push(`VM ${entry.resource.uuid}: ${error}`); }
      }
      for (const record of geometryListeners) record.geometry.removeEventListener('dispose', record.listener);
      for (const record of protectedResources) record.resource.removeEventListener('dispose', record.listener);
      try { renderer.setRenderTarget(previousTarget, face, mip); } catch (error) { result.cleanupErrors.push(`target restore: ${error}`); }
      try { target.dispose(); targetDisposed = true; } catch (error) { result.cleanupErrors.push(`target dispose: ${error}`); }
      renderer.autoClear = savedAutoClear; renderer.shadowMap.enabled = savedShadow;
      if (frameOwn) game.frame = savedFrame; else delete game.frame;
      if (bufferDataOwn) gl.bufferData = savedBufferData; else delete gl.bufferData;
      game.last = performance.now();
      cleanBeforeRestore = entries.every(entry => !gl.isTexture(entry.handle));
      result.fixtureCleanup = { cohortWorldDisposed: !!world.disposed, worldCars: world.cars.size, temporaryTargetDisposed: targetDisposed,
        ownedHandlesReleased: cleanBeforeRestore, frameRestored: game.frame === savedFrame, targetRestored: renderer.getRenderTarget() === previousTarget,
        glUploadHookRestored: gl.bufferData === savedBufferData, ownedVmBuffersReleased: vmResources.filter(entry => !entry.material).every(entry => entry.buffers.every(buffer => !gl.isBuffer(buffer))),
        ownedVmMaterialBindingsReleased: vmResources.filter(entry => entry.material).every(entry => !renderer.properties.get(entry.resource).programs),
        liveControllerUnmodified: run.gunner.vm === liveCrew.gunner.vm };
      result.passed = !!result.passed && Object.entries(result.fixtureCleanup).every(([key, value]) => key === 'worldCars' ? value === 0 : value === true) && !result.cleanupErrors.length;
    }
    return result;
  }, { cycles, cohortSize, clean });
  const lifecycle = report.lifecycle;
  console.log(JSON.stringify({ passed: lifecycle.passed, sourceCleanupPassed: lifecycle.sourceCleanupPassed, vmResourceCleanupPassed: lifecycle.vmResourceCleanupPassed,
    boneUploads: lifecycle.uploads.length, boneRemovalChecks: lifecycle.removals.length, leakedBoneTextures: lifecycle.observedLeakedOwnedTextures,
    vmResourceChecks: lifecycle.vmResourceRemovals.length, leakedVmResources: lifecycle.observedLeakedVmResources, warmMaterialCount: lifecycle.warmMaterials.count,
    isolationChecks: lifecycle.isolation.length, gpu: lifecycle.gpu, fixtureCleanup: lifecycle.fixtureCleanup, errors: lifecycle.errors, cleanupErrors: lifecycle.cleanupErrors }, null, 2));
  assert.equal(report.lifecycle.passed, true, 'skeleton lifecycle or fixture cleanup failed');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.network, []);
  report.passed = true;
} catch (error) { report.failure = error.stack || String(error); report.passed = false; throw error; }
finally {
  try { await browser?.close(); } catch (error) { report.cleanupError = error.stack || String(error); }
  report.browserClosed = !browser || !browser.isConnected(); report.pagesClosed = !page || page.isClosed();
  report.finishedAt = new Date().toISOString();
  report.passed = !!report.passed && report.browserClosed && report.pagesClosed && !report.cleanupError;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  assert.ok(report.browserClosed && report.pagesClosed && !report.cleanupError, 'browser/pages must close before final evidence');
}
