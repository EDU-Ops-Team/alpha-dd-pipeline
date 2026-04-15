# Condition Assessment Scale

**Pipeline:** Alpha DD Pipeline  
**Used By:** WU-07 Vendor BI Extraction  
**Scope:** Maps inspector language to standard priority levels for the `priority` field in cost estimate rows. Also informs classification of inspection items across all 11 sections.

---

## Standard Priority Levels

### CRITICAL
**Definition:** Immediate safety hazard or code violation that **must be addressed before occupancy**. The site cannot receive students until this item is resolved.

**Characteristics:**
- Life-safety systems absent or failed (e.g., no working fire alarm, no sprinklers where required)
- Structural integrity in question
- Active hazardous materials (asbestos, lead, mold with confirmed health risk)
- Blocked or non-compliant egress paths
- Active electrical hazards (exposed wiring, overloaded panels, open disconnects)
- ADA barriers that deny access entirely

**Inspector Language → CRITICAL**

| Inspector Wrote | Map To |
|---|---|
| "Immediate hazard" | CRITICAL |
| "Unsafe — do not occupy" | CRITICAL |
| "Must resolve before opening" | CRITICAL |
| "Life safety violation" | CRITICAL |
| "Code requires correction prior to occupancy" | CRITICAL |
| "Fire marshal hold" | CRITICAL |
| "Active hazmat" | CRITICAL |
| "Structural failure risk" | CRITICAL |
| "No certificate of occupancy possible as-is" | CRITICAL |
| "Requires immediate remediation" | CRITICAL |
| "Emergency repair needed" | CRITICAL |
| "Priority 1" | CRITICAL |
| "P1" | CRITICAL |
| "Red tag" | CRITICAL |
| "Stop work / stop occupancy" | CRITICAL |

---

### IMPORTANT
**Definition:** Code deficiency or significant functional failure that **requires remediation and is timeline-impacting**. Must be resolved, but may allow a conditional occupancy timeline or phased opening depending on jurisdiction.

**Characteristics:**
- Code deficiencies not posing immediate life-safety risk but requiring correction
- Systems operating below required performance thresholds
- ADA barriers affecting partial access
- Plumbing/mechanical deficiencies affecting habitability
- Deferred maintenance that has degraded to code non-compliance
- Items flagged by the inspector as "required for opening" without urgent language

**Inspector Language → IMPORTANT**

| Inspector Wrote | Map To |
|---|---|
| "Code deficiency" | IMPORTANT |
| "Non-compliant — requires correction" | IMPORTANT |
| "Must be corrected before occupancy" (when not urgent) | IMPORTANT |
| "Needs repair prior to opening" | IMPORTANT |
| "Habitability concern" | IMPORTANT |
| "Below code" | IMPORTANT |
| "Functional failure" | IMPORTANT |
| "Timeline-impacting" | IMPORTANT |
| "Required repair" | IMPORTANT |
| "Necessary upgrade" | IMPORTANT |
| "Priority 2" | IMPORTANT |
| "P2" | IMPORTANT |
| "Conditional — needs repair" | IMPORTANT |
| "Out of service — requires restoration" | IMPORTANT |
| "ADA accessible route deficiency" | IMPORTANT |

---

### MINOR
**Definition:** Cosmetic deficiency, non-critical maintenance item, or low-urgency improvement that **can be addressed post-occupancy** without impacting safety or code compliance.

**Characteristics:**
- Surface-level damage (cracked tile, peeling paint, worn carpet)
- Non-life-safety maintenance deferred
- Improvements recommended but not required
- Informational items or "nice to have" upgrades
- Items within normal wear-and-tear tolerance

**Inspector Language → MINOR**

| Inspector Wrote | Map To |
|---|---|
| "Cosmetic" | MINOR |
| "Deferred maintenance" | MINOR |
| "Recommended — not required" | MINOR |
| "Monitor" | MINOR |
| "Low priority" | MINOR |
| "Can wait" | MINOR |
| "Post-occupancy" | MINOR |
| "Non-critical" | MINOR |
| "Surface wear" | MINOR |
| "Minor repair" | MINOR |
| "Aesthetic only" | MINOR |
| "Priority 3" | MINOR |
| "P3" | MINOR |
| "Informational" | MINOR |
| "No immediate action required" | MINOR |
| "Address within 12 months" | MINOR |

---

## Edge Cases and Ambiguous Language

### When Inspector Uses No Priority Language
If the cost estimate table row contains a description but no priority indicator, use the following inference hierarchy:

1. Does the description reference a life-safety system (fire alarm, egress, structural, hazmat)? → **CRITICAL**
2. Does the description reference a code requirement or mandatory correction? → **IMPORTANT**
3. Is the item described as maintenance, cosmetic, or recommendatory? → **MINOR**
4. Cannot determine → **flag in `vendor_notes`**, do not assign a value, require human review

### When Inspector Uses Numeric Scales
Some inspectors use numeric or letter grades. Standard mapping:

| Inspector Scale | CRITICAL | IMPORTANT | MINOR |
|---|---|---|---|
| 1–5 (1=worst) | 1 | 2–3 | 4–5 |
| A–F | F | D–C | B–A |
| High/Medium/Low | High | Medium | Low |
| Red/Yellow/Green | Red | Yellow | Green |

### Escalation Rule
When in doubt, assign the **higher** priority level (i.e., IMPORTANT over MINOR, CRITICAL over IMPORTANT). Record the ambiguity in `vendor_notes`. Never downgrade a priority based on your judgment — only the inspector's language drives classification.

---

## Notes on Use

- The condition scale applies **only** to the `priority` field in `cost_estimates` rows.
- Item-level `classification` in sections (confirmed / corrected / new_finding / unverified) is determined by delta logic, not this scale.
- Never use this scale to infer a priority for items that only appear in section tables — it applies exclusively to the cost estimate table where the inspector has explicitly chosen to assign a cost and priority.
- Inspector language in the **Notes** column of section tables is preserved verbatim and does **not** get mapped to this scale.
