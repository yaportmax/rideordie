"""Skeleton nodes for the shared Mixamo-named rig.  Every bone has an IDENTITY rest rotation (its local axes are
the world axes in the rest pose: +X = character's left, +Y up, +Z forward), so animation clips are directly
shareable between characters of different proportions; only bone translations differ.
"""
import numpy as np

import mh

SOCKETS = {   # name: parent bone
    "socket_hand_R": "RightHand",
    "socket_hand_L": "LeftHand",
    "socket_back": "Spine2",
    "socket_head": "Head",
}


def final_heads(sk):
    """Bone head positions (B, 3) in game space (+Z forward), in mh.BONE_NAMES order."""
    return np.array([mh.to_final(sk["heads"][n]) for n in mh.BONE_NAMES])


def add_skeleton(glb, heads, socket_pos=None, socket_rot=None):
    """Create bone nodes (identity rest rotation) + socket nodes. Returns (bone_node_indices, socket_node_indices, root_bone)."""
    nodes = []
    for b, name in enumerate(mh.BONE_NAMES):
        p = mh.PARENTS[b]
        t = heads[b] if p < 0 else heads[b] - heads[p]
        nodes.append(glb.node(name, t=t))
    for b, p in enumerate(mh.PARENTS):
        if p >= 0:
            glb.g["nodes"][nodes[p]].setdefault("children", []).append(nodes[b])
    sock = {}
    for name, parent in SOCKETS.items():
        pi = mh.BONE_INDEX[parent]
        t = (socket_pos or {}).get(name, np.zeros(3))
        r = (socket_rot or {}).get(name)
        n = glb.node(name, t=t - heads[pi], r=r)
        glb.g["nodes"][nodes[pi]].setdefault("children", []).append(n)
        sock[name] = n
    return nodes, sock


def inverse_bind(heads):
    ibms = []
    for b in range(len(mh.BONE_NAMES)):
        M = np.eye(4)
        M[:3, 3] = heads[b]
        ibms.append(np.linalg.inv(M))
    return ibms
