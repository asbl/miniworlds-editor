from classes.Muenze import Muenze
from classes.Spieler import Spieler
from classes.Spielfeld import Spielfeld

welt = Spielfeld(400, 300)
spieler = Spieler((200, 150))
welt.run()
