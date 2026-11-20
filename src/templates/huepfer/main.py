from classes.Huepfer import Huepfer
from classes.Muenze import Muenze
from classes.Plattform import Plattform
from classes.Welt import Welt

welt = Welt(480, 320)
boden = Plattform((240, 310), 480, 20)
plattform_1 = Plattform((145, 230), 110, 14)
plattform_2 = Plattform((315, 170), 110, 14)
plattform_3 = Plattform((105, 110), 90, 14)
spieler = Huepfer((30, 280))
muenze_1 = Muenze((145, 205))
muenze_2 = Muenze((315, 145))
muenze_3 = Muenze((105, 85))
welt.run()
