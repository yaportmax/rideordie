import numpy as np, math, dsp
from dev_bands import bands
import g_guns as G
from dsp import secs, tt
r=dsp.rng('dbg'); p=dict(G.W['smg'])
n=secs(p['dur']); t=tt(n)
_nz=lambda r,n:r.standard_normal(n)
click = dsp.hp(_nz(r, n), 3500, 1) * np.exp(-t / 0.00022)
crack = dsp.bp(_nz(r, n), 2600, 8500, 2) * dsp.ar_env(n, 0.00005, 0.0032)
fc = 1300 + (6500 - 1300) * np.exp(-t / 0.018)
blast = dsp.svf(_nz(r, n), fc, 0.8, "lp") * dsp.ar_env(n, 0.00015, 0.018)
exc = _nz(r, n) * np.exp(-t / 0.0022)
body = dsp.svf(exc, 980*(1+0.25*np.exp(-t/0.02)), 6, "bp") * dsp.ar_env(n, 0.0002, 0.018)
th = dsp.sweep(n, 180, 95, 0.025) * dsp.ar_env(n, 0.0012, 0.028)
en = lambda x: x / (math.sqrt(float(np.sum(x * x))) + 1e-12)
mixf=p['mix']
dry = (en(click) * math.sqrt(mixf["click"]) + en(crack) * math.sqrt(mixf["crack"]) + en(blast) * math.sqrt(mixf["blast"]) + en(body) * math.sqrt(mixf["body"]) + en(th) * math.sqrt(mixf["thump"]))
print('sum', bands(dry), 'peak idx', np.argmax(np.abs(dry)), 'E', np.sum(dry**2))
dry=dry/np.abs(dry).max()
d2=np.tanh(dry*3)/np.tanh(3)
print('tanh', bands(d2))
d3=dsp.compress(d2,-10,3,0.3,60,1.0)
print('comp', bands(d3))
for nm,c in [('click',click),('crack',crack),('blast',blast),('body',body),('th',th)]:
    print(nm, bands(en(c)), np.round(np.abs(en(c)).max(),3))
