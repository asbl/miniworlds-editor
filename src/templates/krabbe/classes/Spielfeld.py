import miniworlds as mw


class Spielfeld(mw.World):
    def on_setup(self):
        self.add_background((226, 238, 214))
