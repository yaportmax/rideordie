import argparse, sys
import render as R

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("group")
    ap.add_argument("only", nargs="*")
    ap.add_argument("-w", "--workers", type=int, default=None)
    a = ap.parse_args()
    groups = list(R.GROUP_MODULES) if a.group == "all" else [a.group]
    for g in groups:
        try:
            R.build(g, a.only or None, a.workers)
        except ModuleNotFoundError as e:
            print("skip", g, e)
