from classes.Ball import Ball
from classes.Schlaeger import Schlaeger
from classes.Spielfeld import Spielfeld

welt = Spielfeld(400, 300)
ball = Ball((200, 150))
schlaeger = Schlaeger((14, 115))
welt.run()
