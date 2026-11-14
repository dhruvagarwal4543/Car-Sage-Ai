# Live provider check

Real CarDekho and CarWale pages, 15 models, Delhi ex-showroom, 2026-11-12. Reproduce: `python src/check_live_providers.py`.
Variants are taken from CarWale's own Delhi page; the question is whether CarDekho is matched to the same variant. Nothing below is edited by hand.

Probes: 28; with an exact quote from both providers in one basis group: 25.

| model | CarWale variant | groups (basis: providers) | CarDekho probable | failures |
|---|---|---|---|---|
| Maruti Suzuki Swift | LXi Petrol Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Maruti Suzuki Swift | VXi Petrol Automatic (AMT) | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Maruti Suzuki Dzire | LXi Petrol Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Maruti Suzuki Dzire | VXi Petrol Automatic (AMT) | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Maruti Suzuki Brezza | Lxi Petrol 1.0L Turbo Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Maruti Suzuki Brezza | Lxi CNG 1.5L Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 1 | 0 |
| Hyundai i20 | Era Petrol Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Hyundai i20 | Sportz Petrol Automatic | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Hyundai Creta | E Petrol 1.5L Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Hyundai Creta | E Diesel 1.5L Turbo Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Tata Tiago EV | Smart 19.2 kWh | DELHI_EX_SHOWROOM: CarWale | 0 | 0 |
| Tata Punch | Smart Petrol 5 Speed Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Tata Punch | Smart CNG 5 Speed Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Tata Nexon | Smart Petrol 1.2L Turbo 5 Speed Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Tata Nexon | Smart CNG 1.2L Turbo 6 Speed Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Honda City | SV Petrol Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Honda City | V Petrol Automatic (CVT) | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Mahindra Thar | LXT 4WD Petrol 2.0L Turbo Manual | DELHI_EX_SHOWROOM: CarWale | 0 | 0 |
| Mahindra Thar | AXT 2WD Diesel 1.5L Turbo Manual | DELHI_EX_SHOWROOM: CarWale | 0 | 0 |
| Kia Seltos | HTE Petrol 1.5L Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Kia Seltos | HTE Diesel 1.5L Turbo Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Toyota Innova Crysta | GX Diesel Turbo Manual 7 STR | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| MG Hector | Style Petrol Turbo Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| MG Hector | Smart Pro Petrol Turbo Automatic (CVT) | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Volkswagen Virtus | Comfortline Petrol 1.0L Turbo Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Volkswagen Virtus | Highline Petrol 1.0L Turbo Automatic (TC) | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Skoda Slavia | Classic Petrol 1.0L Turbo Manual | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
| Skoda Slavia | Classic Plus Petrol 1.0L Turbo Automatic (TC) | DELHI_EX_SHOWROOM: CarDekho+CarWale | 0 | 0 |
