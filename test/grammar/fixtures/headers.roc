#!/usr/bin/env roc
app [main!] { pf: platform "https://github.com/roc-lang/basic-cli/releases/download/0.20.0/abc.tar.zst" }

import pf.Stdout
import pf.Stdin exposing [line!]
import Json exposing [Decoder, ..]
import "data.json" as data : List(U8)

main! = |_args| {
	Stdout.line!("Hi")
}
