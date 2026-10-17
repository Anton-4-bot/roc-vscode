## Adds one.
##
## Uses `Num.add` under the hood:
##
## ```roc
## expect add_one(1) == 2
## x = "string ${y}"
## ```
##
## ```
## plain block
## ```
add_one : I64 -> I64
add_one = |n| n + 1 # trailing comment

# ## not a doc comment
x = 1 ## also not a doc comment
