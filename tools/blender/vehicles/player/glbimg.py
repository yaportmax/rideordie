import json, struct, sys, os
d = open(sys.argv[1],'rb').read()
l = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20+l])
off = 20+l
bl = struct.unpack('<I', d[off:off+4])[0]
bin_ = d[off+8:off+8+bl]
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
for i, im in enumerate(j.get('images', [])):
    bv = j['bufferViews'][im['bufferView']]
    data = bin_[bv.get('byteOffset',0): bv.get('byteOffset',0)+bv['byteLength']]
    ext = 'jpg' if im['mimeType']=='image/jpeg' else 'png'
    fn = os.path.join(out, "%02d_%s.%s" % (i, im.get('name','img'), ext))
    open(fn,'wb').write(data)
    print(fn, len(data))
