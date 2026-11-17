import random
import miniworlds as mw
from classes.Muenze import Muenze


class Spielfeld(mw.World):
    def on_setup(self):
        self.add_background((226, 238, 214))
        self.punkte = 0
        self.anzeige = mw.Text((70, 20), "Punkte: 0")
        for _ in range(6):
            Muenze((random.randint(20, 380), random.randint(40, 280)))

    def punkt_dazu(self):
        self.punkte += 1
        self.anzeige.text = "Punkte: " + str(self.punkte)
