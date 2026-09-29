import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f); const jl = buf.readUInt32LE(12); const j = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
  const mats = (j.materials || []).map((m) => { const p = m.pbrMetallicRoughness || {}; return `${m.name}[tex:${p.baseColorTexture ? p.baseColorTexture.index : '-'} orm:${p.metallicRoughnessTexture ? p.metallicRoughnessTexture.index : '-'} n:${m.normalTexture ? m.normalTexture.index : '-'} e:${m.emissiveTexture ? 'y' : '-'} a:${m.alphaMode || 'O'} ext:${Object.keys(m.extensions || {}).join('+') || '-'}]`; });
  console.log(f.split('/').pop(), 'materials', mats.length, 'meshes', j.meshes.length, 'prims', j.meshes.reduce((a, m) => a + m.primitives.length, 0)); console.log('  ' + mats.join(' '));
}
