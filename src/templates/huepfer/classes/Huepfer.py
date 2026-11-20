import miniworlds as mw
from classes.Muenze import Muenze
from classes.Plattform import Plattform


class Huepfer(mw.Rectangle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 24, 30)
        self.fill_color = (230, 90, 90)
        self.tempo_y = 0
        self.am_boden = False

    def act(self):
        # Schwerkraft: die Fallgeschwindigkeit wächst jedes Bild
        self.tempo_y += 0.6
        fuss_vorher = self.y + self.height / 2
        self.y += self.tempo_y
        self.am_boden = False
        plattform = self.detect(Plattform)
        if plattform and self.tempo_y > 0:
            oberkante = plattform.y - plattform.height / 2
            # Nur landen, wenn die Füße vorher über der Plattform waren
            if fuss_vorher <= oberkante + 3:
                # 1 Pixel einsinken, damit die Plattform weiter berührt wird
                self.y = oberkante - self.height / 2 + 1
                self.tempo_y = 0
                self.am_boden = True
        for muenze in self.detect_all(Muenze):
            muenze.remove()
            self.world.punkt_dazu()

    def on_key_pressed(self, key):
        if "left" in key or "a" in key:
            self.x = max(12, self.x - 4)
        if "right" in key or "d" in key:
            self.x = min(self.world.width - 12, self.x + 4)

    def on_key_down(self, key):
        if ("up" in key or "w" in key or "space" in key) and self.am_boden:
            self.tempo_y = -11
