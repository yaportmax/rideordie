import sys, json, struct
p = sys.argv[1]
d = open(p,'rb').read()
ln = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20+ln])
if len(sys.argv) > 2 and sys.argv[2] == 'full':
    print(json.dumps(j, indent=1)[:6000])
else:
    print("nodes:", [(n.get('name'), n.get('mesh')) for n in j['nodes']])
    for m in j['materials']:
        print(m['name'], json.dumps(m)[:400])
    print("images", len(j.get('images',[])), "textures", len(j.get('textures',[])))
    print("mesh0 attrs", j['meshes'][0]['primitives'][0]['attributes'])
    print("extensions", j.get('extensionsUsed'))
