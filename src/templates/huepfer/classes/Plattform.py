import miniworlds as mw


class Plattform(mw.Rectangle):
    def __init__(self, position=(0, 0), breite=100, hoehe=14):
        super().__init__(position, breite, hoehe)
        self.fill_color = (90, 70, 50)
