# Checklist Section Map

**Pipeline:** Alpha DD Pipeline  
**Used By:** WU-07 Vendor BI Extraction  
**Scope:** Maps the 11 template sections (as they appear in the returned Worksmith checklist) to their corresponding `inspection_vendor.sections` schema keys. Handles header text variations, alternate names, and standard vs. site-specific items within each section.

---

## How to Use This Map

1. Locate each section header in the returned checklist document
2. Match the header text (or a close variation) to the **Schema Key** column below
3. Parse all table rows under that header as items belonging to that section
4. A section ends when the next recognized section header appears, or when a non-table block begins (e.g., "Site-Specific Tasks")
5. If an inspector adds a header that does not match any entry in this map, treat those rows as site-specific tasks and flag in `vendor_notes`

---

## Section Header → Schema Key Mapping

### Section 1 — `exterior_site`

| Canonical Header (WU-04 template) | Accepted Alternate Headers |
|---|---|
| `1. Exterior / Site Assessment` | `Exterior Site`, `Exterior and Site`, `Site & Exterior`, `Exterior Conditions`, `Site Assessment`, `1. Exterior/Site` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Roof condition | Roof, Roofing, Roof system |
| Exterior walls | Walls (exterior), Building envelope, Cladding |
| Windows and glazing | Windows, Glazing, Window condition |
| Site drainage | Drainage, Storm drainage, Grading and drainage |
| Landscaping / grounds | Grounds, Landscaping, Site conditions |
| Fencing / perimeter security | Fencing, Perimeter, Site security, Security fencing |
| Exterior lighting | Lighting (exterior), Site lighting, Exterior lights |
| Signage | Building signage, Site signage |
| Loading / service areas | Service areas, Loading dock |

---

### Section 2 — `parking_dropoff`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `2. Parking / Drop-off` | `Parking and Drop-off`, `Parking/Drop-off`, `Drop-off / Parking`, `Parking Area`, `2. Parking/Dropoff` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Parking lot surface condition | Parking surface, Asphalt condition, Lot condition |
| Parking stall count | Parking spaces, Number of stalls |
| ADA parking spaces | Accessible parking, Handicap parking, ADA stalls |
| Drop-off zone location | Drop-off area, Student drop-off, Kiss-and-ride |
| Drop-off zone safety | Safe drop-off, Drop-off safety, Separation from traffic |
| Traffic flow pattern | Circulation, Vehicular flow, Driveway layout |
| Bus loading zone | Bus zone, School bus area |
| Striping / markings | Pavement markings, Lot striping, Lane markings |
| Curb cuts / ramps | Curb ramps, Accessible routes from parking |

---

### Section 3 — `entry_egress`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `3. Entry / Egress` | `Entry and Egress`, `Egress / Entry`, `Egress`, `Exits and Entry`, `3. Entry/Egress`, `Means of Egress` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Main entry door hardware | Entry door hardware, Main entrance hardware |
| Main entry door width | Entry door width, Door width (main) |
| Secondary exit count | Number of exits, Exit count, Emergency exits |
| Exit door hardware (panic/crash bars) | Panic hardware, Crash bars, Exit hardware |
| Exit door swing direction | Door swing, Egress door swing |
| Exit corridor width | Corridor width, Egress path width |
| Exit signage | Exit signs, Illuminated exit signs |
| Emergency lighting at exits | Emergency lighting, Egress lighting |
| Stairwell condition | Stairs, Stairwells, Stair egress |
| Exit discharge to public way | Discharge path, Exit to exterior |

---

### Section 4 — `fire_alarm`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `4. Fire Alarm` | `Fire Alarm System`, `Fire Detection`, `Fire Alarm / Detection`, `4. Fire Alarm System` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| System type (addressable vs. conventional) | Fire alarm type, Panel type |
| Panel location and condition | Control panel, Fire alarm panel |
| Last inspection date | Inspection tag, Service date |
| Smoke detectors — coverage | Smoke detector coverage, Detector placement |
| Heat detectors — coverage | Heat detector coverage |
| Pull stations | Manual pull stations, Pull station locations |
| Audible/visual notification devices | Strobes, Horns, Horn/strobes, Notification appliances |
| Connection to monitoring station | Monitoring, Central station connection |
| Battery backup | Panel battery, Backup power |

---

### Section 5 — `sprinkler`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `5. Sprinkler` | `Sprinkler System`, `Fire Suppression`, `Fire Sprinkler`, `5. Fire Sprinkler System` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| System present | Sprinkler present, Sprinkler system exists |
| System type (wet/dry/pre-action) | Sprinkler type |
| Last inspection date | Sprinkler inspection tag, Service date |
| Coverage area / occupancy coverage | Coverage, Full/partial coverage |
| Riser location and condition | Sprinkler riser, Riser room |
| Control valves | Shut-off valves, Control valve status |
| Inspector test connection | Inspector's test valve, Test connection |
| Spare sprinklers and wrench on hand | Spare heads, Spare sprinkler cabinet |

---

### Section 6 — `emergency_systems`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `6. Emergency Systems` | `Emergency & Life Safety`, `Life Safety Systems`, `Emergency Lighting / Life Safety`, `6. Emergency/Life Safety` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Emergency lighting — units present | Emergency lights, Battery-backed lighting |
| Emergency lighting — coverage | Emergency lighting coverage |
| Exit lighting tested | Exit light test, Emergency light test |
| Generator presence | Backup generator, Emergency generator |
| Generator last service date | Generator service, Generator maintenance |
| Carbon monoxide detectors | CO detectors, CO alarms |
| Intercom / public address system | PA system, Intercom, Mass notification |
| AED presence and location | Defibrillator, AED |
| First aid station | First aid kit, First aid cabinet |

---

### Section 7 — `restrooms_plumbing`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `7. Restrooms / Plumbing` | `Plumbing / Restrooms`, `Restrooms and Plumbing`, `Plumbing`, `Restroom Facilities`, `7. Plumbing/Restrooms` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Restroom count (male/female/all-gender) | Number of restrooms, Restroom facilities |
| Fixture count — toilets | Toilet count, WC count |
| Fixture count — lavatories | Sink count, Lavatory count |
| Water pressure and flow | Water pressure, Flow rate |
| Hot water availability | Hot water, Water heater |
| Water heater condition | Water heater age, HW heater |
| Visible leaks / water damage | Leaks, Active leaks, Water staining |
| Floor drains / drainage | Floor drains |
| Drinking fountains | Water fountains, Bubblers |
| Janitor sink / utility sink | Mop sink, Utility sink |

---

### Section 8 — `ada`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `8. ADA` | `ADA Compliance`, `Accessibility`, `Americans with Disabilities Act`, `8. ADA / Accessibility` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Accessible route from parking | Accessible path from parking, Route from ADA stalls |
| Accessible route from drop-off | Accessible route, Drop-off accessible path |
| Main entrance accessibility | Accessible main entry, Entry accessible |
| Door hardware (lever vs. knob) | Door hardware type, Lever hardware |
| Doorway clear widths | Door widths, Clear width |
| Accessible restroom — male | Men's accessible restroom, Male ADA restroom |
| Accessible restroom — female | Women's accessible restroom, Female ADA restroom |
| Grab bars | Restroom grab bars, Handrails in restroom |
| Accessible drinking fountain | ADA fountain, Accessible water fountain |
| Signage (braille, tactile) | ADA signage, Braille signage, Tactile signage |
| Elevator / lift (if multi-story) | Elevator, Platform lift, Vertical lift |
| Ramp slopes | Ramp grade, Accessible ramp |

---

### Section 9 — `structural`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `9. Structural` | `Structural Assessment`, `Structure`, `Building Structure`, `9. Structural Integrity` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Foundation condition | Foundation, Foundation walls |
| Load-bearing walls | Bearing walls, Structural walls |
| Floor structure condition | Floor framing, Floor system |
| Roof structure condition | Roof framing, Roof structure |
| Visible cracks (interior) | Interior cracks, Wall cracks |
| Visible cracks (exterior) | Exterior cracks, Foundation cracks |
| Evidence of settlement | Settlement, Differential settlement |
| Ceiling condition | Ceilings, Ceiling tiles, Suspended ceiling |
| Structural modifications noted | Modifications, Alterations, Structural changes |

---

### Section 10 — `hvac_mechanical`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `10. HVAC / Mechanical` | `HVAC`, `Mechanical Systems`, `Heating and Cooling`, `HVAC/Mechanical`, `10. Mechanical` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Heating system type | Heating, Heat source, Boiler/furnace |
| Cooling system type | Cooling, A/C, Air conditioning |
| System age / approximate vintage | Equipment age, Unit age, HVAC vintage |
| Last service / maintenance date | Service date, Maintenance record |
| Ventilation — supply air | Supply air, Fresh air, Ventilation system |
| Ventilation — exhaust | Exhaust fans, Return air, Exhaust |
| Thermostat / controls | Controls, Thermostats, BAS/BMS |
| Air filter condition | Filters, Filter condition, Air filters |
| Ductwork condition | Ducts, Ductwork, Air distribution |
| Boiler / chiller condition | Boiler, Chiller, Central plant |
| Unit heaters / PTACs | Wall units, PTACs, Unit heaters |

---

### Section 11 — `electrical`

| Canonical Header | Accepted Alternate Headers |
|---|---|
| `11. Electrical` | `Electrical Systems`, `Electrical / Power`, `Power Systems`, `11. Electrical Systems` |

**Standard Items in this Section**

| Standard Item Name | Common Variants |
|---|---|
| Main service amperage | Service size, Main service, Electrical service |
| Panel brand and condition | Panel, Electrical panel, Distribution panel, Breaker panel |
| Panel — double-taps or unsafe wiring | Double taps, Panel deficiencies |
| GFCI protection (wet areas) | GFCI, Ground-fault protection |
| AFCI protection | AFCI breakers, Arc fault protection |
| Outlets — condition and coverage | Receptacles, Outlets, Electrical outlets |
| Lighting type and condition | Lighting, Light fixtures, Interior lighting |
| Exit / emergency lighting circuits | Emergency circuits, Exit light circuits |
| Ground bonding | Grounding, Bonding |
| Exposed wiring / open junction boxes | Open boxes, Exposed wires, Uncovered junction boxes |
| Transformer / switchgear | Transformer, Switchgear |

---

## Site-Specific Tasks Section

The Site-Specific Tasks section appears after Section 11 as a **numbered list**, not a table. It contains D-confidence items from the SIR that could not be mapped to standard template rows.

**Header variants:**
- `Site-Specific Tasks`
- `Additional Items for Field Verification`
- `Custom Inspection Tasks`
- `SIR-Specific Tasks`
- `D-Confidence Items`

Tasks are formatted as:
```
**Task 1.** [Task description text]
Inspector finding: [free text]
Documentation: [free text or "See attached"]
```

Or may appear as a simple numbered list if the inspector filled in a plain-text format. The task number, task text, finding, and documentation fields are all extracted per the `site_specific_tasks` array schema.

---

## Occupant Load Verification Section

**Header variants:**
- `Occupant Load Verification`
- `Occupant Capacity`
- `Load Calculation`
- `Occupant Load Calculation`

This section contains 2 formula blocks. Extract the input and output values as integers. Do not compute — extract what the inspector wrote.

---

## Cost Estimate Table Section

**Header variants:**
- `Cost Estimate`
- `Cost Estimate Summary`
- `Remediation Cost Estimate`
- `Deficiency Cost Summary`

Table columns (exact or near-exact match required):
```
Item | Description | Priority | Low Est. | High Est. | Notes
```

Alternate column names:
- `Item` → `Category`, `System`
- `Low Est.` → `Low Estimate`, `Est. Low`, `Low ($)`
- `High Est.` → `High Estimate`, `Est. High`, `High ($)`

---

## Overall Assessment Section

**Header variants:**
- `Overall Assessment`
- `Inspector Assessment`
- `Final Assessment`
- `Overall Recommendation`
- `Summary Assessment`

This section contains a checked recommendation box and optional narrative. The checked option maps to `overall_recommendation`.

---

## Unrecognized Sections

If a section header appears in the document that does not match any entry in this map:

1. Do **not** silently discard it
2. Treat all rows under that header as part of `site_specific_tasks` (append with a note)
3. Record the unrecognized header text in `vendor_notes`
4. Flag for human review if any items under the header have claim-ids (they should have been in a standard section)
