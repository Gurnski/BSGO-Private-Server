"""
Extract weapon/sticker hardpoints for hull prefabs from the client's assetbundles.

ObjectPointName is matched by the client against TRANSFORM NAMES on the instantiated model, by
exact equality, and misses are dropped SILENTLY (Spot.FindSpots). So these must come out of the
prefabs themselves - there is no guessing a name.

Method: enumerate every Transform in the file, then for each hardpoint-named one walk UP its
m_Father chain to the root, composing the local TRS as it goes. Walking up needs exactly one
pointer per node, which is deterministic; walking DOWN through m_Children gave three different
answers for HumanT1Fighter across three runs because child-pointer resolution fails silently and
intermittently once a bundle's sub-files are lazily loaded.

Positions come out in ROOT space, which is what the client wants: it parents the spot to the
instantiated root, and applies the card's localPosition/localRotation there.

Usage:  py spots.py <bundle> [<bundle> ...]      (one bundle per process - see spots_all.js)
"""
import UnityPy, os, json, sys, re

# Your client's assetbundles directory. The client is not part of this repo.
BASE = os.environ.get("BSGO_ASSETBUNDLES") or sys.exit(
    "Set BSGO_ASSETBUNDLES to your client's assetbundles directory, e.g.\n"
    "  BSGO_ASSETBUNDLES=<client>/assetbundles py extract-hardpoints.py <bundle> ...")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spots.json")

# Capitals suffix their mounts with the weapon class they are meant to carry
# (bullet01_cannon, bullet11_launcher, bullet07_defensive); strike hulls do not. The suffix is
# part of the transform name, so it is part of the ObjectPointName the client matches on.
WANT = re.compile(r'^(bullet\d+(_cannon|_launcher|_defensive)?|elitebullet\d+|sticker\d*)$', re.I)


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by,
            aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw,
            aw*bw - ax*bx - ay*by - az*bz)


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    tx = 2*(y*vz - z*vy)
    ty = 2*(z*vx - x*vz)
    tz = 2*(x*vy - y*vx)
    return (vx + w*tx + (y*tz - z*ty),
            vy + w*ty + (z*tx - x*tz),
            vz + w*tz + (x*ty - y*tx))


def name_of(tr):
    try:
        return tr.m_GameObject.read().m_Name
    except Exception:
        return None


def local(tr):
    p, r, s = tr.m_LocalPosition, tr.m_LocalRotation, tr.m_LocalScale
    return (p.x, p.y, p.z), (r.x, r.y, r.z, r.w), (s.x, s.y, s.z)


def father(tr):
    try:
        f = tr.m_Father
        if f is None or getattr(f, 'path_id', 0) == 0:
            return None
        return f.read()
    except Exception:
        return None


def to_root(tr):
    """
    Express tr in the ROOT's LOCAL space. Returns (pos, rot, rootName, depth).

    The root's OWN transform is deliberately excluded. It is the prefab's authoring transform, not
    part of the model, and the client never applies it: Spot parents to the instantiated root and
    uses the card's localPosition/localRotation from there. Composing it in negates x and z on
    every Colonial hull (their roots carry a 180-degree Y rotation) - which is exactly how a ship
    ends up firing backwards.
    """
    chain = [tr]
    while len(chain) < 24:
        f = father(chain[-1])
        if f is None:
            break
        chain.append(f)

    root = chain[-1]
    pos, rot, _ = local(tr)
    for anc in chain[1:-1]:                 # every ancestor EXCEPT the root
        ap, ar, asc = local(anc)
        # Scale MUST be composed. Several tier-2+ hulls hang their bullet container off a scaled
        # parent; ignoring it reported a 45-unit reach for a fighter whose real mounts are ~3
        # units out, which would have put every muzzle flash far off the hull.
        scaled = (pos[0] * asc[0], pos[1] * asc[1], pos[2] * asc[2])
        pos = tuple(a + b for a, b in zip(ap, qrot(ar, scaled)))
        rot = qmul(ar, rot)
    return pos, rot, name_of(root), len(chain) - 1


result = {}
for b in sys.argv[1:]:
    p = os.path.join(BASE, b)
    if not os.path.isfile(p):
        print("skip (missing): " + b, file=sys.stderr)
        continue
    try:
        env = UnityPy.load(p)
        transforms = [o.read() for o in env.objects if o.type.name == "Transform"]
    except Exception as e:
        print("skip (load failed): %s  %s" % (b, e), file=sys.stderr)
        continue

    for tr in transforms:
        n = name_of(tr)
        if not n or not WANT.match(n):
            continue
        pos, rot, root, depth = to_root(tr)
        if not root:
            continue
        result.setdefault(root, {})
        prev = result[root].get(n)
        # Keep the shallowest: the real mount point, not a nested muzzle-flash child.
        if prev is None or depth < prev["depth"]:
            result[root][n] = {"name": n, "pos": [round(c, 6) for c in pos],
                               "rot": [round(c, 6) for c in rot], "depth": depth}

out = {k: sorted(v.values(), key=lambda s: s["name"]) for k, v in result.items()}
for k in sorted(out):
    print("%-26s %s" % (k, " ".join(s["name"] for s in out[k])))
with open(OUT, "w") as f:
    json.dump(out, f, indent=1)
