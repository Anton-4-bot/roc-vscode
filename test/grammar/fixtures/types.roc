Point : { x : F64, y : F64 }
Shape := [Circle(F64), Rect({ w : F64, h : F64 }), ..others]
Counter :: { count : U64 }.{
	new : {} -> Counter
	new = |{}| { count: 0 }
}
Config := { port : U16 ?? 8080, host ?: Str }
Pair(a, b) : (a, b)

map_try : Try(a, e), (a -> b) -> Try(b, e)
to_str_all : List(a) -> List(Str) where [a.to_str : a -> Str]
read! : Str => Try(Str, [NotFound, ..])
value : _
