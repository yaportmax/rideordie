// Contact sheet of the weapon set:  node tools/blender/weapons/preview.mjs   -> shots/weapons/weapons_preview.png
// Renders every model through the in-engine viewer (tools/test/shot.mjs) and tiles them with ffmpeg.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const items = [
  // name, az, el, dist
  ['pistol', -58, 12, 0.5], ['revolver', -58, 12, 0.5], ['smg', -58, 12, 1.0], ['shotgun', -58, 12, 1.55],
  ['rifle', -58, 12, 1.4], ['lmg', -58, 12, 1.7], ['sniper', -58, 12, 1.8], ['rpg', -58, 12, 1.6],
  ['grenade', -50, 14, 0.24], ['rocket', -58, 14, 1.3], ['shell_9mm', -50, 16, 0.075], ['shell_shotgun', -50, 16, 0.2],
  ['shell_rifle', -50, 16, 0.11],
];
const W = 800, H = 500;
const out = 'shots/weapons/_sheet';
fs.mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const files = [];
for (const [name, az, el, dist] of items) {
  const f = `${out}/${name}.png`;
  files.push(f);
  if (only.length && !only.includes(name)) continue;
  if (!fs.existsSync(`public/models/weapons/${name}.glb`)) { console.log('missing', name); continue; }
  const url = `tools/blender/weapons/qa_viewer.html?model=/models/weapons/${name}.glb&az=${az}&el=${el}&dist=${dist}&fov=25&bg=3a4048`;
  const r = spawnSync('node', ['tools/test/shot.mjs', url, f, '--quiet', `--w=${W}`, `--h=${H}`], { stdio: 'inherit' });
}
// tile 4 x 4 (the last row has 1 item)
const cols = 4, rows = Math.ceil(files.length / cols);
const inputs = files.flatMap(f => ['-i', fs.existsSync(f) ? f : 'shots/weapons/_sheet/_blank.png']);
if (!fs.existsSync('shots/weapons/_sheet/_blank.png')) spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=0x1a1d22:s=${W}x${H}`, '-frames:v', '1', 'shots/weapons/_sheet/_blank.png'], { stdio: 'ignore' });
const n = files.length;
const layout = files.map((_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join('|');
const fc = `xstack=inputs=${n}:layout=${layout}:fill=0x1a1d22,scale=2400:-1`;
const r = spawnSync('ffmpeg', ['-y', ...inputs, '-filter_complex', fc, '-frames:v', '1', 'shots/weapons/weapons_preview.png'], { stdio: 'inherit' });
console.log('sheet exit', r.status);
