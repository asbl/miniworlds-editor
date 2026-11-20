import miniworlds as mw


class Glied(mw.Rectangle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 18, 18)
        self.fill_color = (70, 160, 80)
