import math
from Tarif_Vergleicher import lade_awattar_preise_24h_avg

def hole_uhrzeiten_liste(prompt_start, prompt_ende):
    """Gibt eine Liste [True/False]*24 zurück, in welchen Stunden das Objekt verfügbar ist."""
    start = int(input(prompt_start))
    ende = int(input(prompt_ende))
    if start == ende:
        return [True] * 24
    elif start < ende:
        return [start <= i < ende for i in range(24)]
    else:
        return [i >= start or i < ende for i in range(24)]

def generiere_lastenprofil():
    print("=================================================")
    print("      LASTENPROFIL - GENERATOR (24h KURVE)       ")
    print("=================================================")

    # --- 1. JAHRESVERBRAUCH ---
    print("\n--- 1. ALLGEMEINER JAHRESVERBRAUCH ---")
    jahresverbrauch = float(input("Jährlicher Gesamtstromverbrauch (inkl. E-Autos & Großgeräte) in kWh: "))

    # --- 2. GROSSVERBRAUCHER ---
    print("\n--- 2. GROSSVERBRAUCHER (> 4.2 kW) ---")
    gv_stunden_last = [0.0] * 24
    pauschal_rabatt_total = 0.0
    netzentgelt_reduktion_prozent = 0.0
    hat_dynamisches_netzentgelt = False

    if input("Gibt es separat geschaltete Großverbraucher (z.B. Wärmepumpe)? (j/n): ").strip().lower() == 'j':
        anzahl_gv = int(input("Wie viele Großverbraucher? "))
        for i in range(anzahl_gv):
            leistung = float(input(f"  -> Leistung des {i+1}. Großverbrauchers (in kW): "))
            print("  -> In welchen Stunden läuft das Gerät am Stück?")
            verfuegbar = hole_uhrzeiten_liste("     Start-Stunde (z.B. 10): ", "     End-Stunde (z.B. 14): ")
            for h in range(24):
                if verfuegbar[h]:
                    gv_stunden_last[h] += leistung

            if leistung > 4.2:
                alt = input(f"  -> Wurde der {i+1}. Großverbraucher VOR dem 01.01.2024 installiert? (j/n): ").strip().lower()
                if alt == 'n':
                    print(f"  -> Dieses Gerät ({leistung:.1f} kW) ist nach §14a EnWG REGELBAR.")
                    print("     Wählt eine Ersparnis-Option:\n"
                          "     1 - Pauschal: 167,55 €/Jahr Rabatt auf Netzentgelt\n"
                          "     2 - Prozentual: Netzentgelt-Arbeitspreis um ~60% gesenkt\n"
                          "     3 - Dynamisch: Variables Netzentgelt je nach Netzlast\n")
                    modul = input("     Wahl (1 / 2 / 3): ").strip()
                    if modul == '1':
                        pauschal_rabatt_total += 167.55
                        print("  -> Modul 1 (Pauschal): 167,55 €/Jahr Rabatt wird eingerechnet.")
                    elif modul == '2':
                        netzentgelt_reduktion_prozent = 60.0
                        print("  -> Modul 2 (Prozentual): Netzentgelt-Arbeitspreis wird um 60% reduziert.")
                    elif modul == '3':
                        hat_dynamisches_netzentgelt = True
                        print("  -> Modul 3 (Dynamisch): Variables Netzentgelt wird im Tarifvergleich berücksichtigt.")
                else:
                    print("  -> Gerät installiert vor 01.01.2024 → kein §14a Anspruch.")

    paragraph_14a = {
        'pauschal_rabatt': pauschal_rabatt_total,
        'netzentgelt_reduktion_prozent': netzentgelt_reduktion_prozent,
        'dynamisches_netzentgelt': hat_dynamisches_netzentgelt
    }

    # --- 3. SMART METER ---
    print("\n--- 3. SMART METER (§14a EnWG) ---")
    hat_smart_meter = input("Ist ein Smart Meter installiert? (j/n): ").strip().lower() == 'j'

    # --- 4. E-AUTOS / PLUG-INS ---
    print("\n--- 4. E-AUTOS / PLUG-INS ---")
    e_autos = []
    if input("Gibt es E-Autos oder Plug-In Hybride? (j/n): ").strip().lower() == 'j':
        anz = int(input("Wie viele Fahrzeuge? "))
        for i in range(anz):
            kap = float(input(f"  -> Kapazität des {i+1}. Autos (kWh): "))
            wall = float(input(f"  -> Ladeleistung Wallbox (kW): "))
            ladungen = float(input(f"  -> Vollen Ladungen (0-100%) pro Woche (z.B. 1.5): "))
            print("  -> Zeiten, in denen das Auto ZUHAUSE angesteckt ist:")
            verfuegbar = hole_uhrzeiten_liste("     Eingesteckt ab (z.B. 17): ", "     Ausgesteckt ab (z.B. 7): ")
            v2g = input("  -> Unterstützt es bidirektionales Laden (V2G)? (j/n): ").strip().lower() == 'j'
            e_autos.append({
                'kap': kap, 'wallbox': wall, 'ladungen_pro_woche': ladungen,
                'verfuegbar': verfuegbar, 'v2g': v2g
            })

    # --- Jahresverbrauch aufteilen (jetzt wo e_autos bekannt ist) ---
    gv_jahres_kwh = sum(gv_stunden_last) * 365.0
    eauto_jahres_kwh = sum(c['kap'] * c['ladungen_pro_woche'] * 52.0 for c in e_autos)
    haus_jahres_kwh = max(0.0, jahresverbrauch - gv_jahres_kwh - eauto_jahres_kwh)

    print(f"\n=> Jahresverbrauch-Aufteilung:")
    print(f"   Haus-Grundlast/-Peak:   {haus_jahres_kwh:.0f} kWh")
    print(f"   Großgeräte:             {gv_jahres_kwh:.0f} kWh")
    print(f"   E-Autos (gesamt):       {eauto_jahres_kwh:.0f} kWh")
    print(f"   SUMME (Kontrolle):      {haus_jahres_kwh + gv_jahres_kwh + eauto_jahres_kwh:.0f} kWh")

    # --- Haus-Peak ---
    print("\nGibt es typische Haus-Peak-Stunden (z.B. wenn abends viel gekocht/gewohnt wird)?")
    if input("  -> Peak-Stunden definieren? (j/n): ").strip().lower() == 'j':
        haus_peak_mask = hole_uhrzeiten_liste("     Ab (z.B. 17): ", "     Bis (z.B. 21): ")
    else:
        haus_peak_mask = [False] * 24

    tages_hausverbrauch = haus_jahres_kwh / 365.0
    haus_stunden_last = [0.0] * 24
    peak_count = sum(haus_peak_mask)
    if peak_count > 0:
        grundlast_pro_h = (0.5 * tages_hausverbrauch) / 24.0
        peak_pro_h = (0.5 * tages_hausverbrauch) / peak_count
    else:
        grundlast_pro_h = tages_hausverbrauch / 24.0
        peak_pro_h = 0.0

    for h in range(24):
        haus_stunden_last[h] = grundlast_pro_h
        if haus_peak_mask[h]:
            haus_stunden_last[h] += peak_pro_h

    # --- 5. HAUS-SPEICHER ---
    print("\n--- 5. HAUS-SPEICHER ---")
    speicher_list = []
    if input("Gibt es Hausspeicher-Module? (j/n): ").strip().lower() == 'j':
        anz = int(input("Wie viele Module? "))
        for i in range(anz):
            kap = float(input(f"  -> Kapazität des {i+1}. Speichers (kWh): "))
            lade_p = float(input(f"  -> Maximale Ladeleistung (kW): "))
            entlade_p = float(input(f"  -> Maximale Entladeleistung (kW): "))
            speicher_list.append({'kap': kap, 'lade_p': lade_p, 'entlade_p': entlade_p})

    #=========================================================
    # LOGIK & BERECHNUNG DER LASTENKURVE
    #=========================================================
    print("\n=> Lade aWATTar API Börsenpreise für Kosten-Optimierung...")
    preise = lade_awattar_preise_24h_avg()
    if not preise:
        preise = {h: 10.0 for h in range(24)}

    lastkurve_netz = [0.0] * 24

    # 1. Feste Verbraucher (Haus + Großgeräte)
    rohverbrauch_24h = [haus_stunden_last[h] + gv_stunden_last[h] for h in range(24)]

    # 2. E-Autos laden in den günstigsten Stunden ihres Zeitfensters
    temp_eauto_last = [0.0] * 24
    for c in e_autos:
        tagesbedarf = c['kap'] * (c['ladungen_pro_woche'] / 7.0)
        dauer = math.ceil(tagesbedarf / c['wallbox']) if c['wallbox'] > 0 else 0
        if dauer > 0:
            verf_stunden = [h for h in range(24) if c['verfuegbar'][h]]
            verf_preise = {h: preise[h] for h in verf_stunden}
            beste_stunden = sorted(verf_preise, key=verf_preise.get)[:dauer]
            if len(beste_stunden) > 0:
                p_stunde = tagesbedarf / len(beste_stunden)
                for h in beste_stunden:
                    temp_eauto_last[h] += p_stunde

    totaler_verbrauch_24h = [rohverbrauch_24h[h] + temp_eauto_last[h] for h in range(24)]

    # 3. Speicher-Simulation inkl. V2G
    guenstigste_stunden_total = sorted(preise, key=preise.get)[:5]
    speicher_stand = 0.0
    realer_verbrauch_liste = []
    speicher_stand_liste = []

    for h in range(24):
        akt_kap = sum(s['kap'] for s in speicher_list)
        akt_lade_p = sum(s['lade_p'] for s in speicher_list)
        akt_entlade_p = sum(s['entlade_p'] for s in speicher_list)

        for c in e_autos:
            if c['v2g'] and c['verfuegbar'][h]:
                akt_kap += c['kap']
                akt_lade_p += c['wallbox']
                akt_entlade_p += c['wallbox']

        if speicher_stand > akt_kap:
            speicher_stand = akt_kap

        aktueller_bedarf = totaler_verbrauch_24h[h]

        if h not in guenstigste_stunden_total:
            entnahme = min(aktueller_bedarf, speicher_stand, akt_entlade_p)
            aktueller_bedarf -= entnahme
            speicher_stand -= entnahme

        if h in guenstigste_stunden_total:
            platz = akt_kap - speicher_stand
            laden = min(platz, akt_lade_p)
            speicher_stand += laden
            aktueller_bedarf += laden

        lastkurve_netz[h] = aktueller_bedarf
        realer_verbrauch_liste.append(totaler_verbrauch_24h[h])
        speicher_stand_liste.append(speicher_stand)

    print("\n===========================================================================================================")
    print("                              BERECHNETE 24h LASTKURVE                                                   ")
    print("===========================================================================================================")
    print(f"{'Uhrzeit':<9} | {'Realer Verbrauch':>17} | {'Netzbezug':>12} | {'Speicherstand':>14}")
    print("-" * 65)
    for h in range(24):
        print(f"{h:02d}:00 Uhr | {realer_verbrauch_liste[h]:>12.2f} kWh  | {lastkurve_netz[h]:>8.2f} kWh | {speicher_stand_liste[h]:>10.2f} kWh")

    return lastkurve_netz, paragraph_14a

if __name__ == "__main__":
    kurve, p14a = generiere_lastenprofil()
