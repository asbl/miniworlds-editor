import random
import miniworlds as mw
from classes.Asteroid import Asteroid


class Weltraum(mw.World):
    def on_setup(self):
        self.add_background((10, 12, 30))
        self.punkte = 0
        self.zu_ende = False
        self.anzeige = mw.Text((60, 20), "Punkte: 0")

    def act(self):
        if not self.zu_ende and self.frame % 40 == 0:
            Asteroid((random.randint(20, self.width - 20), -20))

    def punkt_dazu(self):
        self.punkte += 1
        self.anzeige.text = "Punkte: " + str(self.punkte)

    def spiel_vorbei(self):
        if not self.zu_ende:
            self.zu_ende = True
            mw.Text((200, 250), "Game Over")
            self.stop()
