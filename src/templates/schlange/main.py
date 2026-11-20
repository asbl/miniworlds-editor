from classes.Apfel import Apfel
from classes.Glied import Glied
from classes.Kopf import Kopf
from classes.Spielfeld import Spielfeld

welt = Spielfeld(400, 300)
kopf = Kopf((200, 160))
apfel = Apfel((100, 100))
welt.run()
