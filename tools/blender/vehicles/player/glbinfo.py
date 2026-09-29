import json, struct, sys
d = open(sys.argv[1],'rb').read()
l = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20+l])
if len(sys.argv)>2 and sys.argv[2]=='all': print(json.dumps(j, indent=1)[:6000])
else:
    for m in j['materials']:
        print(m['name'], json.dumps({k:v for k,v in m.items() if k!='name'})[:300])
    for me in j['meshes']:
        print(me['name'], [ (list(p['attributes'].keys()), p.get('material')) for p in me['primitives']][:3])
    print("nodes", [n.get('name') for n in j['nodes']])
    print("images", j.get('images'))
