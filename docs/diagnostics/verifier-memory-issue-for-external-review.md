# Linux verifier memory issue — sanitized technical brief

Evidence date: October 4, 2026. This is a focused troubleshooting case, not a
source-code export or a claim that a new worker is already live. No credentials,
customer data, private repository information, custom configuration names or
private code symbols are included.

## The problem

A hosted Linux Node.js application queues code proposals for a TypeScript
compiler check. Compilation runs in a separate Node child, not in the web
process. The production safety gate deliberately defers compilation when it
cannot establish a finite aggregate memory limit and sufficient headroom.

The published VM currently exposes process cgroup membership information, but
the authenticated diagnostic found no usable cgroup controller mounts:

| Observation | Result | Meaning |
| --- | --- | --- |
| Usable cgroup v2 mounts | 0; unresolved | The process cannot read authoritative v2 memory accounting |
| Usable cgroup v1 memory mounts | 0; missing | No accessible v1 accounting source was found by the mount-aware probe |
| Aggregate memory admission | unavailable | Compiler work is retained in the queue rather than started |
| Host RAM estimates in logs | roughly 7.8 GiB total, 6.6 GiB available | These describe host visibility, not an authoritative per-application budget |
| Development workspace probe | readable finite 8 GiB limit | A different execution environment can expose usable accounting |

The host estimates are point-in-time rounded observations. The development
result does **not** establish production parity. Membership without a readable
controller may reflect mount/namespace restrictions; the exact hosting cause
has not been established. No parser defect has been demonstrated.

## Why simply raising the Node heap is unsafe

The V8 heap ceiling is not a cap on resident memory. Native allocations,
compiler buffers, libraries, memory-mapped files, the web process and sibling
processes can all consume memory outside that heap.

An earlier staged compile with a 2 GiB heap increased aggregate cgroup usage by
about 2.38 GiB. That observation motivated a 3 GiB startup headroom requirement,
including reserve/burst allowance. It is not a universal maximum-growth proof.

Current safeguards:

- Compiler heap: normally 2 GiB; 3 GiB only with a finite limit of at least
  8 GiB and at least 4.5 GiB of available aggregate headroom.
- Parent resident-memory admission ceiling: 1,200 MiB.
- In-flight aggregate reserve: 512 MiB, checked approximately every 250 ms.
- Child wall-clock ceiling: 210 seconds, shortened to leave queue-lease margin.
- Cross-process heavy-work serialization and fenced queue completion.
- Production refuses missing, malformed or unreadable accounting.

The poller is a protective margin, not a substitute for kernel enforcement.
It cannot prevent every abrupt allocation spike or prove a universal RSS bound.

## What cannot safely stand in for missing controller accounting

1. Host free RAM: the host may be shared or have a tighter invisible limit.
2. Node's constrained-memory estimate: it overstated a readable cap in a
   development comparison; it does not supply ancestor/sibling usage.
3. A fixed V8 heap ceiling: it does not bound total process or VM memory.
4. A visible child controller alone when relevant ancestors are hidden:
   a parent may have less headroom because siblings consume its budget.
5. Setting a guessed machine-size value: configuration is not measurement.
6. Disabling the production admission gate: this restores activity by accepting
   an unmeasured OOM risk, not by solving the accounting problem.

## Workaround being built

A standalone, serial compiler worker consumes only verification jobs. It does
not start web routes, email delivery, payments, research generation or general
agent execution. It uses the existing queue/tenant/attempt fences and guarded
compiler child.

The worker checks finite memory authority before claiming work and checks again
during execution. A source mismatch defers rather than requesting an LLM rebase.
Moving compilation only helps if the **worker's actual host** exposes complete
usable accounting and has measured headroom. A second process in the same
unobservable memory domain is not sufficient isolation.

The local workspace offers a place to test this design. A supported production
execution location, matching source/dependencies and credential provisioning
still need verification before switching production routing. No new paid host,
production secret transfer or publication is authorized by this brief.

## Questions for an independent model

Please separate documented Linux guarantees from hosting assumptions.

1. Given visible membership but no usable controller mounts, which read-only
   evidence would distinguish a mount restriction, a namespace mapping issue,
   a genuinely absent controller, or an incomplete parser?
2. Is there another kernel-backed interface that supplies both the effective
   finite limit and relevant aggregate usage, including all applicable ancestor
   constraints? Explain exactly what it guarantees and what it cannot observe.
3. If the hosting platform exposes no such interface, what is the smallest
   maintainable execution design that gives the compiler a real enforced memory
   domain without endangering the web application?
4. Can a bounded worker use existing infrastructure without increasing paid RAM?
   State required permissions and hosting support; do not assume privileged
   cgroup mounts, containers or administrator access are available.
5. How should shutdown, source-version parity, tenant identity, lease loss,
   indeterminate crashes and late verdicts be handled?
6. What measurements would establish startup headroom, peak aggregate growth,
   OOM counters and web availability before calling the workaround successful?

## Requested answer format

- Likely explanation, with confidence and competing explanations.
- One recommended implementation and one lower-complexity alternative.
- Required capabilities and any cost assumptions.
- Read-only investigation steps using standard Linux interfaces.
- Deterministic acceptance tests, failure cases and rollback plan.
- Reasons to reject unsafe substitutions.

Do not recommend treating an unavailable measurement as zero usage, interpreting
an unbounded controller as a finite budget, or certifying the whole application
from a successful isolated compile.