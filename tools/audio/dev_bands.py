import sys, numpy as np, math
import dsp
from dsp import SR
def bands(x):
    X=np.abs(np.fft.rfft(x*np.hanning(len(x))))**2; f=np.fft.rfftfreq(len(x),1/SR); tot=X.sum()+1e-20
    return [round(10*math.log10(X[(f>=lo)&(f<hi)].sum()/tot+1e-12),1) for lo,hi in [(0,150),(150,800),(800,4000),(4000,22050)]]
if __name__=="__main__":
    r=dsp.rng('x'); n=dsp.secs(0.5); t=dsp.tt(n)
    crack = dsp.bp(r.standard_normal(n), 2600, 8500, 2) * dsp.ar_env(n, 0.00005, 0.0032)
    print('crack',bands(crack))
    fc = 1300 + (6500 - 1300) * np.exp(-t / 0.018)
    blast = dsp.svf(r.standard_normal(n), fc, 0.8, "lp") * dsp.ar_env(n, 0.00015, 0.018)
    print('blast',bands(blast))
    exc = r.standard_normal(n) * np.exp(-t / 0.0022)
    body = dsp.svf(exc, 980*(1+0.25*np.exp(-t/0.02)), 6, "bp") * dsp.ar_env(n, 0.0002, 0.018)
    print('body',bands(body))
    th = dsp.sweep(n, 180, 95, 0.025) * dsp.ar_env(n, 0.0012, 0.028)
    print('thump',bands(th))
    click = dsp.hp(r.standard_normal(n), 3500, 1) * np.exp(-t / 0.00022)
    print('click',bands(click))
