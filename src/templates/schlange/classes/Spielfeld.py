import random
import miniworlds as mw
from classes.Apfel import Apfel


class Spielfeld(mw.World):
    def on_setup(self):
        self.add_background((235, 240, 220))
        self.punkte = 0
        self.zu_ende = False
        self.anzeige = mw.Text((70, 15), "Punkte: 0")

    def neuer_apfel(self):
        self.punkte += 1
        self.anzeige.text = "Punkte: " + str(self.punkte)
        Apfel((random.randint(1, 18) * 20, random.randint(2, 13) * 20))

    def spiel_vorbei(self):
        if not self.zu_ende:
            self.zu_ende = True
            mw.Text((200, 150), "Game Over")
            self.stop()
