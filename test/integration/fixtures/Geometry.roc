## A point on an integer grid.
Geometry := { x : I64, y : I64 }.{
	origin : Geometry
	origin = { x: 0, y: 0 }

	## Doubles a number.
	double : I64 -> I64
	double = |n| n * 2

	quadruple : I64 -> I64
	quadruple = |n| double(double(n))

	shift : Geometry, I64 -> Geometry
	shift = |point, amount| { x: point.x + amount, y: point.y + amount }
}

expect Geometry.quadruple(2) == 8
