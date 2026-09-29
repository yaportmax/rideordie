import numpy as np, math, dsp
from dev_bands import bands
import g_guns as G
r=dsp.rng('dbg')
p=dict(G.W['smg'])
print('full', bands(G.shot(dsp.rng('dbg'), p)))
p2=dict(p); p2['tail']=dict(p['tail']); p2['tail']['wet']=1e-6
print('dry only', bands(G.shot(dsp.rng('dbg'), p2)))
p3=dict(p); p3['action']=(0.022,3800,0.0)
print('no action', bands(G.shot(dsp.rng('dbg'), p3)))
p4=dict(p); p4['mix']=dict(click=0.0,crack=0.0,blast=0.0,body=0.0,thump=1.0)
print('thump only', bands(G.shot(dsp.rng('dbg'), p4)))
p4['mix']=dict(click=0.0,crack=1.0,blast=0.0,body=0.0,thump=0.0)
print('crack only', bands(G.shot(dsp.rng('dbg'), p4)))
