from app.engineer.spoken import spoken


def test_positions_times_and_seconds_read_like_an_engineer():
    assert spoken("Largaste 3° y terminaste 1°.") == "Largaste tercero y terminaste primero."
    assert spoken("Tu mejor vuelta fue la 7, en 1:28,456.") == "Tu mejor vuelta fue la 7, en un minuto 28 con 456."
    assert spoken("la curva 6, 0,52 s.") == "la curva 6, 0,52 segundos."
    assert spoken("P3 a 1.2 s, 0,26 s/vuelta") == "tercero a 1,2 segundos, 0,26 segundos por vuelta"
    assert spoken("104 °C y 307 km/h") == "104 grados y 307 kilómetros por hora"
    assert spoken("$ 1.500") == "$ 1.500"
    assert spoken("Ibas 17° cuando") == "Ibas decimoséptimo cuando"
