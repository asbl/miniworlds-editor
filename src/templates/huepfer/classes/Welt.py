import miniworlds as mw


class Welt(mw.World):
    def on_setup(self):
        self.add_background((170, 210, 240))
        self.punkte = 0
        self.anzeige = mw.Text((70, 20), "Punkte: 0")

    def punkt_dazu(self):
        self.punkte += 1
        self.anzeige.text = "Punkte: " + str(self.punkte)
        if self.punkte == 3:
            mw.Text((240, 160), "Geschafft!")
