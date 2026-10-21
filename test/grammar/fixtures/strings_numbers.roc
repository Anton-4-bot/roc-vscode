plain = "hello"
escapes = "tab\t newline\n quote\" dollar\$ unicode\u(1F600)"
nested = "outer ${inner("a ${b} c")} after ${ { x: 1 }.x }"
multi =
	\\first ${name}
	\\second "quoted"
char = 'a'
char_escape = '\n'
unterminated = "oops
after = 1
ints = [0, 42, 1_000_000, 0xFF_FF, 0o17, 0b1010]
floats = [1.5, 0.25e-3, 6.02e23]
typed = [5.U8, -12.34.Dec, 0x10.U16, 7.MyNum, 3u8, 2dec]
tuple_index = pair.0 + pair.1
range = 0..<10
inclusive = 1..=5
