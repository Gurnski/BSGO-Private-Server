"""
Measure hull mesh bounds for collider templates from the client's assetbundles.

The server's ColliderTemplate is what missiles and rams actually test against, and a sphere big
enough to cover a capital bow-to-stern reaches ~350 units past its broadside - which is where
"the missile hit me while it was still far out" comes from. Upstream's own two capital templates
(galactica, basestar) are tight AABB boxes; this measures the same thing for the hulls upstream
never shipped.

Method: enumerate every MeshFilter, read its Mesh's m_LocalAABB, push all 8 corners through the
composed local TRS chain up to - but excluding - the prefab root, and union per root. Excluding
the root's own transform matches extract-hardpoints.py and the client's instantiation (Spot
parents to the instantiated root), and is validated by reproducing upstream's own numbers:
galactica extents (200, 75, 600) and basestar (513.575, 146.508, 1042.167) both come back to
within a few units when FX nodes are excluded.

Every node is PRINTED with its own root-space box before any filtering, because the union is only
honest if the outliers are visible: engine glowballs and lens flares are quads that sit well off
the hull (galactica's glowball is at z=-703.5, outside upstream's own box), and a filter nobody
can see is a filter nobody can check. The union line excludes nodes matching FX_NAMES; the
"union ALL" line excludes nothing.

Usage:  py extract-bounds.py <bundle> [<bundle> ...]
        BSGO_ASSETBUNDLES must point at your client's assetbundles directory.
"""
import UnityPy, os, sys, re

BASE = os.environ.get("BSGO_ASSETBUNDLES") or sys.exit(
    "Set BSGO_ASSETBUNDLES to your client's assetbundles directory, e.g.\n"
    "  BSGO_ASSETBUNDLES=<client>/assetbundles py extract-bounds.py <bundle> ...")

# FX geometry that renders off the hull surface and must not size a collider. Checked against the
# node NAME, case-insensitive. 'lowres' LOD meshes are the same hull at lower detail and are kept
# (they never extend the union); FX quads are not hull.
FX_NAMES = re.compile(r'glow|flare|engine|thruster|trail|fx|light|halo|beam|smoke', re.I)


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


def chain_to_root(tr):
    """The transform chain from tr up to the prefab root, root last."""
    chain = [tr]
    while len(chain) < 24:
        f = father(chain[-1])
        if f is None:
            break
        chain.append(f)
    return chain


def corner_to_root(chain, corner):
    """
    A point in the LEAF NODE's mesh space -> the ROOT's local space. The leaf's own TRS applies
    first (mesh vertices live in the leaf's space), then every ancestor except the root - the same
    convention as extract-hardpoints.py, for the same reason.
    """
    v = corner
    for tr in chain[:-1]:                    # leaf first, every ancestor EXCEPT the root
        p, r, s = local(tr)
        v = (v[0]*s[0], v[1]*s[1], v[2]*s[2])
        v = qrot(r, v)
        v = (v[0]+p[0], v[1]+p[1], v[2]+p[2])
    return v


class Box:
    def __init__(self):
        self.lo = [float('inf')]*3
        self.hi = [float('-inf')]*3

    def add(self, v):
        for i in range(3):
            self.lo[i] = min(self.lo[i], v[i])
            self.hi[i] = max(self.hi[i], v[i])

    def valid(self):
        return self.lo[0] <= self.hi[0]

    def centre(self):
        return [(a+b)/2 for a, b in zip(self.lo, self.hi)]

    def extents(self):
        return [(b-a)/2 for a, b in zip(self.lo, self.hi)]

    def fmt(self):
        c, e = self.centre(), self.extents()
        return ("centre (%8.2f, %8.2f, %8.2f)  extents (%8.2f, %8.2f, %8.2f)"
                % (c[0], c[1], c[2], e[0], e[1], e[2]))


for b in sys.argv[1:]:
    p = os.path.join(BASE, b)
    if not os.path.isfile(p):
        print("skip (missing): " + b, file=sys.stderr)
        continue
    try:
        env = UnityPy.load(p)
        filters = [o.read() for o in env.objects if o.type.name == "MeshFilter"]
        # Transform lookup by the OWNING GameObject's path_id - a MeshFilter carries no transform
        # pointer of its own.
        tr_by_go = {}
        for o in env.objects:
            if o.type.name != "Transform":
                continue
            tr = o.read()
            tr_by_go[getattr(tr.m_GameObject, 'path_id', 0)] = tr
    except Exception as e:
        print("skip (load failed): %s  %s" % (b, e), file=sys.stderr)
        continue

    print("== bundle %s: %d MeshFilter(s)" % (b, len(filters)))
    unions = {}                              # root name -> (Box hull-only, Box everything)
    for mf in filters:
        tr = tr_by_go.get(getattr(mf.m_GameObject, 'path_id', 0))
        if tr is None:
            continue
        try:
            mesh = mf.m_Mesh.read()
            aabb = mesh.m_LocalAABB
            c = (aabb.m_Center.x, aabb.m_Center.y, aabb.m_Center.z)
            e = (aabb.m_Extent.x, aabb.m_Extent.y, aabb.m_Extent.z)
        except Exception as ex:
            print("   %-30s <mesh unreadable: %s>" % (name_of(tr), ex))
            continue

        chain = chain_to_root(tr)
        root = name_of(chain[-1]) or "?"
        node = Box()
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    node.add(corner_to_root(chain, (c[0]+sx*e[0], c[1]+sy*e[1], c[2]+sz*e[2])))

        nm = name_of(tr) or "?"
        fx = bool(FX_NAMES.search(nm))
        print("   %-30s %s%s" % (nm, node.fmt(), "   [FX - excluded]" if fx else ""))
        hull, everything = unions.setdefault(root, (Box(), Box()))
        everything.add(node.lo); everything.add(node.hi)
        if not fx:
            hull.add(node.lo); hull.add(node.hi)

    for root, (hull, everything) in sorted(unions.items()):
        print("  root %-24s union HULL  %s" % (root, hull.fmt() if hull.valid() else "<empty>"))
        print("       %-24s union ALL   %s" % ("", everything.fmt()))
