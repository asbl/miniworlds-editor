import miniworlds as mw


class Muenze(mw.Circle):
    def __init__(self, position=(0, 0)):
        super().__init__(position, 9)
        self.fill_color = (240, 200, 40)
