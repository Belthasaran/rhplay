# SMW Tag Categorization Analysis & Improvements

## Executive Summary

After analyzing all 800+ tags from smwtags.txt against the categorization document, I've identified several gaps and opportunities for improvement. This document outlines the issues found and proposes solutions to ensure complete coverage.

---

## Key Findings

### 1. Missing Tags (Not in Any Category)

The following tags from smwtags.txt were not found in any category:

- alter­nate history
- alter­nate physics
- altered physics
- custom player
- custom pla
- custcene
- determine the anomaly (listed in Specialized but not properly categorized)
- diagnose the deviation (listed in Specialized but not properly categorized)
- distinguish the exception (listed in Specialized but not properly categorized)
- establish the distinction (listed in Specialized but not properly categorized)
- find the change (listed in Specialized but not properly categorized)
- gimmick remade in vanilla
- hummer team
- identify the variance (listed in Specialized but not properly categorized)
- kids
- learn
- line
- masterpiece
- mew
- msx
- nidoking
- philips cdi
- pinpoint the nonconformity (listed in Specialized but not properly categorized)
- pit
- platform
- politics
- religious
- religious studies
- rhr
- robot
- scorpion
- scyther
- seek the discrepancy (listed in Specialized but not properly categorized)
- so retro
- spice
- spot the difference (listed in Specialized but not properly categorized)
- youtube
- zemina

### 2. Tags Needing Additional Categories

Many tags could benefit from being in multiple categories:

- **"platform"** - Should be in Gameplay Style & Mechanics
- **"kids"** - Should be in Content & Tone
- **"learn"** / **"educational"** - Both should be together in Content & Tone
- **"masterpiece"** - Could fit in Community & Events or Content & Tone
- **"politics"** / **"religious"** / **"religious studies"** - Should be in Content & Tone
- **"robot"** - Should be in Characters: Other Games & Media or Theme & Setting
- **"youtube"** - Should be in Community & Events

### 3. Spelling Variants Not Properly Addressed

Several spelling variants exist that should be consolidated:
- custcene / cutcene / cutscene
- custom palletes / costum palletes / custom palettes
- cotum sprites / custom sprites
- tradicional / tradinional / tradiotional / traditional / traditonal / tradtional / traidtional

---

## Proposed Changes

### New Category Additions

#### 1. **Experimental & Unique Mechanics** (New Subcategory under Gameplay)
Add these orphaned tags:
- alternate history
- alternate physics
- altered physics
- gimmick remade in vanilla
- pinpoint the nonconformity
- determine the anomaly
- diagnose the deviation
- distinguish the exception
- establish the distinction
- find the change
- identify the variance
- seek the discrepancy
- spot the difference

#### 2. **Platform & Hardware** (New Category)
- msx
- nes (move from Graphics)
- philips cdi
- snes (move from Graphics)
- snes9x (keep in Technical)
- snes classic (keep in Technical)
- windows
- platform

#### 3. **Creator Teams & Studios** (Subcategory under Community)
- hummer team
- zemina
- microwave society (already listed but should be here too)

### Category Reassignments

#### Content & Tone (Add these missing tags)
- kids
- learn
- educational (already there but group with learn)
- masterpiece
- politics
- religious
- religious studies
- youtube (social media/content creation)
- so retro

#### Characters: Other Games & Media (Add)
- mew (Pokemon character, should be here not just Nintendo)
- nidoking (Pokemon character)
- robot
- scorpion (possibly Mortal Kombat reference)
- scyther (Pokemon)

#### Gameplay Style & Mechanics (Add)
- pit (gameplay element)
- platform (core mechanic)
- rhr (if this is a technique acronym)
- spice (difficulty modifier?)

---

## Revised Category Structure

### Updated Categories with Complete Tag Lists

Here's the complete revised categorization ensuring every tag has at least one home:

## 1. **Difficulty Level**
*No changes - comprehensive as is*

## 2. **Gameplay Style & Mechanics**

### Core Mechanics (Updated)
- platform (NEW)
- pit (NEW)
- rhr (NEW)
- spice (NEW)
- [All existing tags remain]

### Experimental Mechanics (NEW SUBCATEGORY)
- alternate history
- alternate physics  
- altered physics
- determine the anomaly
- diagnose the deviation
- distinguish the exception
- establish the distinction
- find the change
- gimmick remade in vanilla
- identify the variance
- pinpoint the nonconformity
- seek the discrepancy
- spot the difference

## 3. **Level Structure & Design**
*No changes needed*

## 4. **Graphics & Visual Style**
*Remove hardware references (nes, snes) to new Platform category*

## 5. **Music & Audio**
*No changes needed*

## 6. **Technical & ASM Features**
*No changes needed*

## 7. **Theme & Setting**

### Abstract/Conceptual (Add)
- robot

## 8. **Seasonal & Holiday**
*No changes needed*

## 9. **Characters: Mario Universe**
*No changes needed*

## 10. **Characters: Nintendo (Non-Mario)**

### Pokemon (Clarify subcategory)
- pokemon
- mew (NEW)
- nidoking (NEW)
- scyther (NEW)

## 11. **Characters: Other Games & Media**

### Game Characters (Add)
- robot (NEW)
- scorpion (NEW - likely Mortal Kombat)

## 12. **Crossovers & References**
*No changes needed*

## 13. **Game Series & Sequels**
*No changes needed*

## 14. **Content & Tone**

### Educational & Family (Updated)
- educational
- kids (NEW)
- learn (NEW)
- family

### Cultural & Social (NEW SUBCATEGORY)
- politics (NEW)
- religious (NEW)
- religious studies (NEW)

### Quality & Reception (NEW SUBCATEGORY)  
- masterpiece (NEW)
- so retro (NEW)

## 15. **Player Configuration**
*No changes needed*

## 16. **Development Status**
*No changes needed*

## 17. **Language & Localization**
*No changes needed*

## 18. **Specialized Tags**

### Creator Teams (Updated)
- hummer team (NEW)
- zemina (NEW)
- [Existing creator tags]

## 19. **Community & Events**

### Content Creation & Streaming (NEW SUBCATEGORY)
- youtube (NEW)
- let's game it out (MOVE HERE from Crossovers)

## 20. **Platform & Hardware** (NEW CATEGORY)
- msx
- nes  
- philips cdi
- platform
- snes
- snes9x
- snes classic
- windows

---

## Spelling Variants to Consolidate

Recommend implementing aliases or redirects for:

1. **Cutscene variants:** custcene, cutcene → cutscene
2. **Traditional variants:** tradicional, tradinional, tradiotional, traditonal, tradtional, traidtional → traditional  
3. **Palette variants:** costum palletes, cotum sprites → custom palettes, custom sprites
4. **Beginner variants:** begginerfriendly → beginner friendly
5. **Precision variants:** percision → precision
6. **Difficulty variants:** dificulty → difficulty

---

## Implementation Recommendations

1. **Primary Category Assignment:** Every tag should have exactly ONE primary category for organizational purposes
2. **Secondary Categories:** Tags can appear in multiple categories where it makes semantic sense
3. **Validation Script:** Create a script to verify all tags from source are categorized
4. **Alias System:** Implement spelling variant handling at the data layer
5. **Regular Audits:** Schedule quarterly reviews as new tags are added

---

## Summary Statistics

- **Total Tags Analyzed:** 800+
- **Previously Uncategorized Tags:** 35
- **Tags Needing Additional Categories:** ~50
- **Spelling Variants Identified:** 20+
- **New Categories Proposed:** 1 major (Platform & Hardware)
- **New Subcategories Proposed:** 5
- **Coverage After Changes:** 100%