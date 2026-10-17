platform ""
    requires {} { run! : Str => Str }
    exposes [Host]
    packages {}
    provides { "roc_run": run_for_host! }
    hosted {
        "roc_host_alloc_count": Host.alloc_count!,
    }
    targets: {
        x64mac: { inputs: ["libhost.a", app] },
    }

import Host

run_for_host! : Str => Str
run_for_host! = |input| run!(input)
