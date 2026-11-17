import miniworlds as mw


class Schlaeger(mw.Rectangle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 12, 70)
        self.fill_color = (80, 180, 240)

    def act(self):
        pass

    def on_key_pressed(self, key):
        if "up" in key or "w" in key:
            self.y = max(0, self.y - 5)
        if "down" in key or "s" in key:
            self.y = min(self.world.height - 70, self.y + 5)
