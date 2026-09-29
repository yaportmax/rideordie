"""kits - tier specific add-ons.  kit_tN.py defines kit(T) which receives the Truck after the shared base is built
(before wheels + sockets), so it can add geometry to T.b (body) / T.part('panel_x', origin) and override
T.exh_tip / T.gunner_f."""
import importlib

KITS = {}
for _n in (1, 2, 3, 4):
    try:
        KITS[_n] = importlib.import_module('kit_t%d' % _n).kit
    except ImportError:
        pass
