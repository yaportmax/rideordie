import sys, json, struct, os
p = sys.argv[1]; out = sys.argv[2]
os.makedirs(out, exist_ok=True)
d = open(p,'rb').read()
ln = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20+ln])
binoff = 20+ln+8
for i, im in enumerate(j['images']):
    bv = j['bufferViews'][im['bufferView']]
    b = d[binoff+bv.get('byteOffset',0): binoff+bv.get('byteOffset',0)+bv['byteLength']]
    ext = 'jpg' if im['mimeType']=='image/jpeg' else 'png'
    open(os.path.join(out, '%02d_%s.%s' % (i, im.get('name','x'), ext)),'wb').write(b)
print([ (t['source'], t.get('sampler')) for t in j['textures']][:6], j.get('samplers'))
print([ (i, im.get('name')) for i, im in enumerate(j['images'])])
